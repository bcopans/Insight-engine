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

// SSE setup
function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Slim helpers — only pass what each agent actually needs
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

// ── Synthesize — SSE ──────────────────────────────────────────────────────────

app.post('/api/synthesize', async (req, res) => {
  const send = sse(res);
  try {
    send('status', { message: 'Loading documents...' });

    const { data: docs, error } = await supabase
      .from('documents')
      .select('name, themes, document_summary, key_source')
      .order('created_at', { ascending: true });

    if (error) { send('error', { message: 'Database error: ' + error.message }); return res.end(); }
    if (!docs?.length) { send('error', { message: 'No documents found. Please upload documents first.' }); return res.end(); }

    send('status', { message: `Master Researcher synthesizing ${docs.length} document${docs.length > 1 ? 's' : ''}...` });

    // Only send titles, summaries, and slim themes to reduce token usage
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

    send('complete', out);
    res.end();
  } catch (e) {
    console.error('Synthesize error:', e.message);
    send('error', { message: 'Synthesis failed: ' + e.message });
    res.end();
  }
});

// ── Full analysis pipeline — SSE ──────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const send = sse(res);
  const { themes } = req.body;
  if (!themes?.length) { send('error', { message: 'No themes provided' }); return res.end(); }

  const slimThemes = themes.map(slim.theme);

  try {
    // PM
    send('agent', { agent: 'pm', status: 'running', message: 'Reviewing themes and forming recommendations...' });
    let pmOut;
    try {
      pmOut = await callClaude(PM, `Research themes:\n${JSON.stringify(slimThemes)}`, 3000);
      send('agent', { agent: 'pm', status: 'done', output: pmOut });
    } catch (e) {
      send('agent', { agent: 'pm', status: 'error', message: e.message });
      send('error', { message: 'PM agent failed: ' + e.message });
      return res.end();
    }

    // Engineer
    send('agent', { agent: 'engineer', status: 'running', message: 'Estimating effort and flagging risks...' });
    let engineerOut;
    try {
      const slimRecs = (pmOut.recommendations || []).map(slim.rec);
      engineerOut = await callClaude(ENGINEER, `PM Recommendations:\n${JSON.stringify(slimRecs)}`, 2000);
      send('agent', { agent: 'engineer', status: 'done', output: engineerOut });
    } catch (e) {
      send('agent', { agent: 'engineer', status: 'error', message: e.message });
      engineerOut = { estimates: [], globalFlags: [] };
    }

    // Director
    send('agent', { agent: 'director', status: 'running', message: 'Challenging assumptions and stress-testing...' });
    let directorOut;
    try {
      const slimRecs = (pmOut.recommendations || []).map(slim.rec);
      const slimEsts = (engineerOut.estimates || []).map(slim.estimate);
      directorOut = await callClaude(
        DIRECTOR,
        `PM Recommendations:\n${JSON.stringify(slimRecs)}\n\nEngineer Estimates:\n${JSON.stringify(slimEsts)}`,
        2000
      );
      send('agent', { agent: 'director', status: 'done', output: directorOut });
    } catch (e) {
      send('agent', { agent: 'director', status: 'error', message: e.message });
      directorOut = { challenges: [], overallAssessment: '', topPriority: '', biggestConcern: '' };
    }

    // PM Rebuttal
    send('agent', { agent: 'rebuttal', status: 'running', message: 'Defending, revising, or conceding each challenge...' });
    let rebuttalOut;
    try {
      const slimRecs = (pmOut.recommendations || []).map(slim.rec);
      rebuttalOut = await callClaude(
        PM_REBUTTAL,
        `Recommendations:\n${JSON.stringify(slimRecs)}\n\nThemes (evidence):\n${JSON.stringify(slimThemes)}\n\nChallenges:\n${JSON.stringify(directorOut.challenges || [])}`,
        2000
      );
      send('agent', { agent: 'rebuttal', status: 'done', output: rebuttalOut });
    } catch (e) {
      send('agent', { agent: 'rebuttal', status: 'error', message: e.message });
      rebuttalOut = { rebuttals: [], finalSummary: '' };
    }

    send('complete', {
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
    res.end();
  } catch (e) {
    console.error('Analysis error:', e.message);
    send('error', { message: 'Analysis failed: ' + e.message });
    res.end();
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
