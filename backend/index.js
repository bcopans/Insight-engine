require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const {
  ROADMAP_PARSER, RESEARCHER_SINGLE, MASTER_RESEARCHER,
  PM, ENGINEER, FINANCE_ANALYST, GTM_SPECIALIST,
  DIRECTOR, PM_REBUTTAL, ROADMAP_EVALUATOR, FINANCE_CONVERSATION
} = require('./prompts');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

async function callClaude(system, userMessage, maxTokens) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens || 3000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = msg.content.map(b => b.text || '').join('');
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch (e) {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON parse failed');
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
    model: 'claude-sonnet-4-20250514', max_tokens: 4000,
    messages: [{ role: 'user', content: [
      { type: isImage ? 'image' : 'document', source: { type: 'base64', media_type: file.mimetype || 'application/pdf', data: file.buffer.toString('base64') } },
      { type: 'text', text: 'Extract all text. Return raw text only.' }
    ]}]
  });
  return msg.content.map(b => b.text || '').join('');
}

const slim = {
  theme: t => ({ id: t.id, customerProblem: t.customerProblem, strength: t.strength, problemSize: t.problemSize }),
  rec: r => ({ id: r.id, stackRank: r.stackRank, title: r.title, rationale: r.rationale, projectType: r.projectType, userValue: r.userValue, strategicFit: r.strategicFit, mlp: r.mlp }),
  est: e => ({ recommendationId: e.recommendationId, effortWeeks: e.effortWeeks, effortSize: e.effortSize }),
  fin: m => ({ recommendationId: m.recommendationId, projectType: m.projectType, headline: m.headline }),
  gtm: g => ({ recommendationId: g.recommendationId, launchComplexity: g.launchComplexity, timeToMarket: g.timeToMarket }),
};

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const results = [];
  for (const file of req.files) {
    try {
      const text = await extractText(file);
      const out = await callClaude(RESEARCHER_SINGLE, `Document: ${file.originalname}\n\nContent:\n${text.slice(0, 5000)}`, 2000);
      const { data, error } = await supabase.from('documents').insert([{
        name: file.originalname, extracted_text: text.slice(0, 30000),
        themes: out.themes || [], document_summary: out.documentSummary || '',
        key_source: out.keySource || '', file_size: file.size, mime_type: file.mimetype,
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
  } catch (e) { res.status(500).json({ error: 'Fetch failed' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await supabase.from('documents').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Delete failed' }); }
});

// ── Synthesize ────────────────────────────────────────────────────────────────
app.post('/api/synthesize', async (req, res) => {
  try {
    const { data: docs, error } = await supabase.from('documents').select('name, themes, document_summary, key_source').order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Database error' });
    if (!docs?.length) return res.status(400).json({ error: 'No documents found. Please upload documents first.' });

    const input = docs.map(d => ({
      document: d.name, source: d.key_source || '', summary: d.document_summary || '',
      themes: (d.themes || []).map(t => ({
        customerProblem: t.customerProblem, description: t.description,
        sentiment: t.sentiment, strength: t.strength,
        amazonPositioned: t.amazonPositioned, amazonPositionedRationale: t.amazonPositionedRationale,
        certainty: t.certainty, followUpNeeded: t.followUpNeeded,
        sourceType: t.sourceType, quote: (t.quotes || [])[0] || '',
      })),
    }));

    const out = await callClaude(MASTER_RESEARCHER, `Synthesize themes from ${docs.length} documents:\n\n${JSON.stringify(input)}`, 4000);
    res.json(out);
  } catch (e) {
    console.error('Synthesize error:', e.message);
    res.status(500).json({ error: 'Synthesis failed: ' + e.message });
  }
});

// ── Full 6-agent analysis ─────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { themes, roadmapItems = [] } = req.body;
  if (!themes?.length) return res.status(400).json({ error: 'No themes' });

  const slimThemes = themes.map(slim.theme);

  try {
    console.log('PM...');
    const pmOut = await callClaude(PM, `Themes:\n${JSON.stringify(slimThemes)}\n\nRoadmap:\n${JSON.stringify(roadmapItems)}`, 3000);

    console.log('Engineer...');
    const slimRecs = (pmOut.recommendations || []).map(slim.rec);
    const engOut = await callClaude(ENGINEER, `Recommendations:\n${JSON.stringify(slimRecs)}`, 2000).catch(() => ({ estimates: [] }));

    console.log('Finance...');
    const slimEsts = (engOut.estimates || []).map(slim.est);
    const finOut = await callClaude(FINANCE_ANALYST, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nEffort:\n${JSON.stringify(slimEsts)}`, 3000).catch(() => ({ models: [] }));

    console.log('GTM...');
    const slimFin = (finOut.models || []).map(slim.fin);
    const gtmOut = await callClaude(GTM_SPECIALIST, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nFinance:\n${JSON.stringify(slimFin)}`, 2000).catch(() => ({ gtmPlans: [] }));

    console.log('Director...');
    const slimGtm = (gtmOut.gtmPlans || []).map(slim.gtm);
    const dirOut = await callClaude(DIRECTOR, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nEffort:\n${JSON.stringify(slimEsts)}\n\nFinance:\n${JSON.stringify(slimFin)}\n\nGTM:\n${JSON.stringify(slimGtm)}`, 2500).catch(() => ({ challenges: [], overallAssessment: '', topPriority: '', biggestConcern: '' }));

    console.log('Rebuttal...');
    const rebuttalOut = await callClaude(PM_REBUTTAL, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nThemes:\n${JSON.stringify(slimThemes)}\n\nChallenges:\n${JSON.stringify(dirOut.challenges || [])}`, 2000).catch(() => ({ rebuttals: [], finalSummary: '' }));

    // Compute priority + combine data
    const recommendations = (pmOut.recommendations || [])
      .sort((a, b) => (a.stackRank || 99) - (b.stackRank || 99))
      .map(r => {
        const eng = (engOut.estimates || []).find(e => e.recommendationId === r.id);
        const fin = (finOut.models || []).find(m => m.recommendationId === r.id);
        const gtm = (gtmOut.gtmPlans || []).find(g => g.recommendationId === r.id);
        const dirChallenge = (dirOut.challenges || []).find(c => c.recommendationId === r.id);

        // Combined priority
        const pmScore = ((r.userValue || 5) + (r.strategicFit || 5) + (r.confidenceScore || 5)) / 3;
        const effortPenalty = eng?.effortSize === 'XL' ? -1.5 : eng?.effortSize === 'L' ? -0.5 : 0;
        const combined = pmScore + effortPenalty;
        let priority = dirChallenge?.directorStance === 'reject' ? 'Cut' : combined >= 7.5 ? 'P0' : combined >= 6 ? 'P1' : 'P2';

        return { ...r, priority, eng, fin, gtm };
      });

    console.log('Done.');
    res.json({
      recommendations,
      directorChallenges: dirOut.challenges || [],
      directorAssessment: dirOut.overallAssessment || '',
      directorTopPriority: dirOut.topPriority || '',
      directorBiggestConcern: dirOut.biggestConcern || '',
      rebuttals: rebuttalOut.rebuttals || [],
      finalSummary: rebuttalOut.finalSummary || '',
      roadmapConflicts: pmOut.roadmapConflicts || [],
      strategicGaps: pmOut.strategicGaps || [],
    });
  } catch (e) {
    console.error('Analysis error:', e.message);
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

// ── Finance chat ──────────────────────────────────────────────────────────────
app.post('/api/finance/chat', async (req, res) => {
  const { messages, recommendation, financeModel } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });
  try {
    const context = `Recommendation: ${recommendation?.title}\nType: ${recommendation?.projectType}\nCurrent model:\n${JSON.stringify(financeModel, null, 2)}`;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: FINANCE_CONVERSATION + '\n\n' + context,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    res.json({ response: msg.content.map(b => b.text || '').join('') });
  } catch (e) { res.status(500).json({ error: 'Chat failed' }); }
});

// ── Finance recalculate ───────────────────────────────────────────────────────
app.post('/api/finance/recalculate', async (req, res) => {
  const { recommendation, assumptions } = req.body;
  try {
    const out = await callClaude(
      FINANCE_CONVERSATION,
      `Recalculate the financial model for: ${recommendation?.title}\nType: ${recommendation?.projectType}\n\nUpdated assumptions:\n${JSON.stringify(assumptions)}\n\nReturn a JSON object with: { "headline": "updated impact statement", "calculationLogic": "how you got there" }`,
      500
    );
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Recalculate failed' }); }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────
app.post('/api/parse-roadmap', upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) text = await extractText(req.file);
    const items = await callClaude(ROADMAP_PARSER, `Parse this roadmap:\n\n${text}`, 2000);
    res.json(Array.isArray(items) ? items : []);
  } catch (e) { res.status(500).json({ error: 'Parse failed' }); }
});

app.post('/api/evaluate-roadmap', async (req, res) => {
  const { themes, roadmapItems } = req.body;
  if (!themes?.length || !roadmapItems?.length) return res.status(400).json({ error: 'Missing data' });
  try {
    const result = await callClaude(ROADMAP_EVALUATOR, `Themes:\n${JSON.stringify(themes.map(slim.theme))}\n\nRoadmap:\n${JSON.stringify(roadmapItems)}`, 3000);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Evaluation failed' }); }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
app.post('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').insert([req.body]).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Save failed' }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: 'Fetch failed' }); }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await supabase.from('sessions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Delete failed' }); }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Insight Engine running on port ${PORT}`));
