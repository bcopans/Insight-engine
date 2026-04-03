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

// ── Claude helper ─────────────────────────────────────────────────────────────

async function callClaude(system, userMessage, maxTokens) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens || 3000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = msg.content.map(b => b.text || '').join('');
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON parse failed: ' + cleaned.slice(0, 200));
  }
}

async function extractText(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  if (['text/plain', 'text/csv', 'text/markdown'].includes(file.mimetype) || name.endsWith('.txt') || name.endsWith('.md')) {
    return file.buffer.toString('utf8');
  }
  const isImage = file.mimetype?.startsWith('image/');
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: isImage ? 'image' : 'document', source: { type: 'base64', media_type: file.mimetype || 'application/pdf', data: file.buffer.toString('base64') } },
        { type: 'text', text: 'Extract all text. Return raw text only.' }
      ]
    }]
  });
  return msg.content.map(b => b.text || '').join('');
}

// Slim helpers — only pass what each agent needs
const slim = {
  theme: t => ({ id: t.id, title: t.title, description: t.description, strength: t.strength, sentiment: t.sentiment }),
  rec: r => ({ id: r.id, title: r.title, rationale: r.rationale, roadmapPlacement: r.roadmapPlacement, userValue: r.userValue, strategicFit: r.strategicFit, confidenceScore: r.confidenceScore }),
  estimate: e => ({ recommendationId: e.recommendationId, effort: e.effort, effortWeeks: e.effortWeeks, complexity: e.complexity }),
};

// ── Upload ────────────────────────────────────────────────────────────────────

app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const results = [];
  for (const file of req.files) {
    try {
      const text = await extractText(file);
      const out = await callClaude(
        RESEARCHER_SINGLE,
        `Document: ${file.originalname}\n\nContent:\n${text.slice(0, 5000)}`,
        1500
      );
      const { data, error } = await supabase.from('documents').insert([{
        name: file.originalname,
        extracted_text: text.slice(0, 30000),
        themes: out.themes || [],
        document_summary: out.documentSummary || '',
        key_source: out.keySource || '',
        file_size: file.size,
        mime_type: file.mimetype,
      }]).select().single();
      if (error) throw error;
      results.push({ id: data.id, name: data.name, themes: data.themes, documentSummary: data.document_summary, keySource: data.key_source, uploadedAt: data.created_at });
    } catch (e) {
      console.error('Upload error:', file.originalname, e.message);
      results.push({ name: file.originalname, error: e.message });
    }
  }
  res.json(results);
});

app.get('/api/documents', async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents').select('id, name, themes, document_summary, key_source, file_size, created_at').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await supabase.from('documents').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── Synthesize ────────────────────────────────────────────────────────────────

app.post('/api/synthesize', async (req, res) => {
  try {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('name, themes, document_summary, key_source')
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    if (!docs?.length) return res.status(400).json({ error: 'No documents found. Please upload documents first.' });

    console.log(`Synthesizing ${docs.length} documents...`);

    const input = docs.map(d => ({
      document: d.name,
      source: d.key_source || '',
      summary: d.document_summary || '',
      themes: (d.themes || []).map(t => ({
        title: t.title,
        description: t.description,
        sentiment: t.sentiment,
        strength: t.strength,
        quote: (t.quotes || [])[0] || '',
      })),
    }));

    const out = await callClaude(
      MASTER_RESEARCHER,
      `Synthesize themes from ${docs.length} documents:\n\n${JSON.stringify(input)}`,
      3500
    );

    console.log('Synthesis complete:', out.themes?.length, 'themes');
    res.json(out);
  } catch (e) {
    console.error('Synthesize error:', e.message);
    res.status(500).json({ error: 'Synthesis failed: ' + e.message });
  }
});

// ── Full analysis pipeline ────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { themes } = req.body;
  if (!themes?.length) return res.status(400).json({ error: 'No themes provided' });

  const slimThemes = themes.map(slim.theme);

  try {
    console.log('PM agent running...');
    const pmOut = await callClaude(PM, `Research themes:\n${JSON.stringify(slimThemes)}`, 3000);

    console.log('Engineer agent running...');
    const slimRecs = (pmOut.recommendations || []).map(slim.rec);
    const engineerOut = await callClaude(ENGINEER, `PM Recommendations:\n${JSON.stringify(slimRecs)}`, 2000).catch(() => ({ estimates: [], globalFlags: [] }));

    console.log('Director agent running...');
    const slimEsts = (engineerOut.estimates || []).map(slim.estimate);
    const directorOut = await callClaude(
      DIRECTOR,
      `PM Recommendations:\n${JSON.stringify(slimRecs)}\n\nEngineer Estimates:\n${JSON.stringify(slimEsts)}`,
      2000
    ).catch(() => ({ challenges: [], overallAssessment: '', topPriority: '', biggestConcern: '' }));

    console.log('PM Rebuttal running...');
    const rebuttalOut = await callClaude(
      PM_REBUTTAL,
      `Recommendations:\n${JSON.stringify(slimRecs)}\n\nThemes:\n${JSON.stringify(slimThemes)}\n\nChallenges:\n${JSON.stringify(directorOut.challenges || [])}`,
      2000
    ).catch(() => ({ rebuttals: [], finalSummary: '' }));

    console.log('Analysis complete.');
    res.json({
      recommendations: pmOut.recommendations || [],
      engineerEstimates: engineerOut.estimates || [],
      globalFlags: engineerOut.globalFlags || [],
      directorChallenges: directorOut.challenges || [],
      directorAssessment: directorOut.overallAssessment || '',
      directorTopPriority: directorOut.topPriority || '',
      directorBiggestConcern: directorOut.biggestConcern || '',
      rebuttals: rebuttalOut.rebuttals || [],
      finalSummary: rebuttalOut.finalSummary || '',
    });
  } catch (e) {
    console.error('Analysis error:', e.message);
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────

app.post('/api/parse-roadmap', upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) text = await extractText(req.file);
    const items = await callClaude(ROADMAP_PARSER, `Parse this roadmap:\n\n${text}`, 2000);
    res.json(Array.isArray(items) ? items : []);
  } catch (e) {
    res.status(500).json({ error: 'Parse failed' });
  }
});

app.post('/api/evaluate-roadmap', async (req, res) => {
  const { themes, roadmapItems } = req.body;
  if (!themes?.length || !roadmapItems?.length) return res.status(400).json({ error: 'Missing data' });
  try {
    const result = await callClaude(
      ROADMAP_EVALUATOR,
      `Themes:\n${JSON.stringify(themes.map(slim.theme))}\n\nRoadmap:\n${JSON.stringify(roadmapItems)}`,
      3000
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
app.listen(PORT, () => console.log(`Insight Engine running on port ${PORT}`));
