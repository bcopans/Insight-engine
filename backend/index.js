require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const {
  RESEARCHER_SINGLE, MASTER_RESEARCHER, PM, ENGINEER,
  DIRECTOR, PM_REBUTTAL, ROADMAP_EVALUATOR, ROADMAP_PARSER
} = require('./prompts');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Core helpers ──────────────────────────────────────────────────────────────

async function callClaude(system, userMessage) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = msg.content.map(b => b.text || '').join('');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function callClaudeWithFile(system, userMessage, base64, mediaType, isImage) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: isImage ? 'image' : 'document', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: userMessage }
      ]
    }],
  });
  const raw = msg.content.map(b => b.text || '').join('');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function extractText(file) {
  const name = file.originalname?.toLowerCase() || '';

  // Word documents — use mammoth
  if (name.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  // Plain text
  if (['text/plain', 'text/csv', 'text/markdown'].includes(file.mimetype) || name.endsWith('.txt') || name.endsWith('.md')) {
    return file.buffer.toString('utf8');
  }

  // PDF or image — send to Claude vision
  const isImage = file.mimetype?.startsWith('image/');
  const mediaType = file.mimetype || 'application/pdf';
  const base64 = file.buffer.toString('base64');
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: isImage ? 'image' : 'document', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Extract all text from this document. Return only raw text, no commentary.' }
      ]
    }]
  });
  return msg.content.map(b => b.text || '').join('');
}

// ── File upload & per-file research ──────────────────────────────────────────

app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

  const results = [];

  for (const file of req.files) {
    try {
      // 1. Extract text
      const text = await extractText(file);

      // 2. Run Researcher agent on this document
      const researcherOut = await callClaude(
        RESEARCHER_SINGLE,
        `Document name: ${file.originalname}\n\nDocument content:\n${text.slice(0, 8000)}`
      );

      // 3. Save to Supabase
      const { data, error } = await supabase.from('documents').insert([{
        name: file.originalname,
        extracted_text: text.slice(0, 50000), // cap storage
        themes: researcherOut.themes,
        document_summary: researcherOut.documentSummary,
        key_source: researcherOut.keySource,
        file_size: file.size,
        mime_type: file.mimetype,
      }]).select().single();

      if (error) throw error;

      results.push({
        id: data.id,
        name: data.name,
        themes: data.themes,
        documentSummary: data.document_summary,
        keySource: data.key_source,
        uploadedAt: data.created_at,
      });
    } catch (e) {
      console.error(`Failed processing ${file.originalname}:`, e);
      results.push({ name: file.originalname, error: e.message });
    }
  }

  res.json(results);
});

// Get all uploaded documents
app.get('/api/documents', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, themes, document_summary, key_source, file_size, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Delete a document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    await supabase.from('documents').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── Synthesize all document themes → master theme model ───────────────────────

app.post('/api/synthesize', async (req, res) => {
  try {
    // Load all documents with themes
    const { data: docs, error } = await supabase
      .from('documents')
      .select('name, themes, document_summary, key_source')
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!docs?.length) return res.status(400).json({ error: 'No documents uploaded yet' });

    const perDocSummary = docs.map(d => ({
      document: d.name,
      source: d.key_source,
      summary: d.document_summary,
      themes: d.themes,
    }));

    const masterOut = await callClaude(
      MASTER_RESEARCHER,
      `Per-document theme sets from ${docs.length} documents:\n\n${JSON.stringify(perDocSummary, null, 2)}`
    );

    res.json(masterOut);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Synthesis failed' });
  }
});

// ── Full analysis pipeline ────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { themes } = req.body;
  if (!themes?.length) return res.status(400).json({ error: 'No themes provided' });

  try {
    // PM
    const pmOut = await callClaude(PM, `Research themes:\n${JSON.stringify(themes)}`);

    // Engineer
    const engineerOut = await callClaude(ENGINEER, `PM Recommendations:\n${JSON.stringify(pmOut.recommendations)}`);

    // Director
    const directorOut = await callClaude(
      DIRECTOR,
      `PM Recommendations:\n${JSON.stringify(pmOut.recommendations)}\n\nEngineer Estimates:\n${JSON.stringify(engineerOut.estimates)}`
    );

    // PM Rebuttal
    const rebuttalOut = await callClaude(
      PM_REBUTTAL,
      `Original recommendations:\n${JSON.stringify(pmOut.recommendations)}\n\nResearch themes (evidence):\n${JSON.stringify(themes)}\n\nDirector challenges:\n${JSON.stringify(directorOut.challenges)}`
    );

    res.json({
      recommendations: pmOut.recommendations,
      engineerEstimates: engineerOut.estimates,
      globalFlags: engineerOut.globalFlags,
      directorChallenges: directorOut.challenges,
      directorAssessment: directorOut.overallAssessment,
      directorTopPriority: directorOut.topPriority,
      directorBiggestConcern: directorOut.biggestConcern,
      rebuttals: rebuttalOut.rebuttals,
      finalSummary: rebuttalOut.finalSummary,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────

app.post('/api/parse-roadmap', upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) text = await extractText(req.file);
    const items = await callClaude(ROADMAP_PARSER, `Parse this roadmap:\n\n${text}`);
    res.json(Array.isArray(items) ? items : []);
  } catch (e) {
    res.status(500).json({ error: 'Roadmap parse failed' });
  }
});

app.post('/api/evaluate-roadmap', async (req, res) => {
  const { themes, roadmapItems } = req.body;
  if (!themes?.length || !roadmapItems?.length) return res.status(400).json({ error: 'Missing data' });
  try {
    const result = await callClaude(
      ROADMAP_EVALUATOR,
      `Themes:\n${JSON.stringify(themes)}\n\nRoadmap:\n${JSON.stringify(roadmapItems)}`
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

app.post('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').insert([req.body]).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Save failed' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await supabase.from('sessions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Insight Engine v4 running on port ${PORT}`));
