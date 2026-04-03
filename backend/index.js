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

// Slim helpers
const slim = {
  theme: t => ({ id: t.id, customerProblem: t.customerProblem, strength: t.strength, problemSize: t.problemSize, amazonPositioned: t.amazonPositioned }),
  rec: r => ({ id: r.id, title: r.title, rationale: r.rationale, projectType: r.projectType, userValue: r.userValue, strategicFit: r.strategicFit, mlp: r.mlp }),
  estimate: e => ({ recommendationId: e.recommendationId, effortWeeks: e.effortWeeks, effortSize: e.effortSize, complexity: e.complexity }),
  financeModel: m => ({ recommendationId: m.recommendationId, projectType: m.projectType, headline: m.headline, roi: m.roi, paybackPeriod: m.paybackPeriod }),
  gtm: g => ({ recommendationId: g.recommendationId, launchDifficulty: g.launchDifficulty, timeToMarket: g.timeToMarket, competitiveWindow: g.competitiveWindow }),
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
        2000
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
    const { data: docs, error } = await supabase.from('documents').select('name, themes, document_summary, key_source').order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    if (!docs?.length) return res.status(400).json({ error: 'No documents found. Please upload documents first.' });

    console.log(`Synthesizing ${docs.length} documents...`);

    const input = docs.map(d => ({
      document: d.name,
      source: d.key_source || '',
      summary: d.document_summary || '',
      themes: (d.themes || []).map(t => ({
        customerProblem: t.customerProblem,
        description: t.description,
        sentiment: t.sentiment,
        strength: t.strength,
        amazonPositioned: t.amazonPositioned,
        amazonPositionedRationale: t.amazonPositionedRationale,
        certainty: t.certainty,
        followUpNeeded: t.followUpNeeded,
        sourceType: t.sourceType,
        quote: (t.quotes || [])[0] || '',
      })),
    }));

    const out = await callClaude(
      MASTER_RESEARCHER,
      `Synthesize themes from ${docs.length} documents:\n\n${JSON.stringify(input)}`,
      4000
    );

    console.log('Synthesis complete:', out.themes?.length, 'themes');
    res.json(out);
  } catch (e) {
    console.error('Synthesize error:', e.message);
    res.status(500).json({ error: 'Synthesis failed: ' + e.message });
  }
});

// ── Full 6-agent analysis pipeline ───────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { themes, roadmapItems = [] } = req.body;
  if (!themes?.length) return res.status(400).json({ error: 'No themes provided' });

  const slimThemes = themes.map(slim.theme);

  try {
    // 1. PM
    console.log('PM agent...');
    const pmOut = await callClaude(
      PM,
      `Research themes:\n${JSON.stringify(slimThemes)}\n\nRoadmap items:\n${JSON.stringify(roadmapItems)}`,
      3000
    );

    // 2. Engineer
    console.log('Engineer agent...');
    const slimRecs = (pmOut.recommendations || []).map(slim.rec);
    const engineerOut = await callClaude(ENGINEER, `PM Recommendations:\n${JSON.stringify(slimRecs)}`, 2000)
      .catch(() => ({ estimates: [], globalFlags: [] }));

    // 3. Finance Analyst
    console.log('Finance Analyst agent...');
    const slimEsts = (engineerOut.estimates || []).map(slim.estimate);
    const financeOut = await callClaude(
      FINANCE_ANALYST,
      `PM Recommendations:\n${JSON.stringify(slimRecs)}\n\nEngineer Estimates:\n${JSON.stringify(slimEsts)}`,
      3000
    ).catch(() => ({ models: [] }));

    // 4. GTM Specialist
    console.log('GTM Specialist agent...');
    const slimFinance = (financeOut.models || []).map(slim.financeModel);
    const gtmOut = await callClaude(
      GTM_SPECIALIST,
      `PM Recommendations:\n${JSON.stringify(slimRecs)}\n\nFinance Models:\n${JSON.stringify(slimFinance)}\n\nEngineer Estimates:\n${JSON.stringify(slimEsts)}`,
      2000
    ).catch(() => ({ gtmPlans: [] }));

    // 5. Director
    console.log('Director agent...');
    const slimGtm = (gtmOut.gtmPlans || []).map(slim.gtm);
    const directorOut = await callClaude(
      DIRECTOR,
      `PM Recommendations:\n${JSON.stringify(slimRecs)}\n\nEngineer Estimates:\n${JSON.stringify(slimEsts)}\n\nFinance Models:\n${JSON.stringify(slimFinance)}\n\nGTM Plans:\n${JSON.stringify(slimGtm)}`,
      2000
    ).catch(() => ({ challenges: [], overallAssessment: '', topPriority: '', biggestConcern: '' }));

    // 6. PM Rebuttal
    console.log('PM Rebuttal agent...');
    const rebuttalOut = await callClaude(
      PM_REBUTTAL,
      `Original recommendations:\n${JSON.stringify(slimRecs)}\n\nThemes (evidence):\n${JSON.stringify(slimThemes)}\n\nDirector challenges:\n${JSON.stringify(directorOut.challenges || [])}`,
      2000
    ).catch(() => ({ rebuttals: [], finalSummary: '' }));

    // Calculate priority (P0/P1/P2/Cut) from combined PM + Finance scores
    const recommendations = (pmOut.recommendations || []).map(r => {
      const eng = (engineerOut.estimates || []).find(e => e.recommendationId === r.id);
      const fin = (financeOut.models || []).find(m => m.recommendationId === r.id);
      const gtm = (gtmOut.gtmPlans || []).find(g => g.recommendationId === r.id);
      const dirChallenge = (directorOut.challenges || []).find(c => c.recommendationId === r.id);

      // Priority scoring
      const pmScore = ((r.userValue || 5) + (r.strategicFit || 5) + (r.confidenceScore || 5)) / 3;
      const finScore = fin?.roi ? (fin.roi.includes('6x') || fin.roi.includes('8x') || fin.roi.includes('10x') ? 9 : fin.roi.includes('4x') || fin.roi.includes('5x') ? 7 : 5) : 5;
      const gtmScore = gtm?.launchDifficulty === 'easy' ? 9 : gtm?.launchDifficulty === 'moderate' ? 7 : gtm?.launchDifficulty === 'hard' ? 4 : 3;
      const combinedScore = (pmScore * 0.4) + (finScore * 0.4) + (gtmScore * 0.2);

      let priority = 'P2';
      if (dirChallenge?.directorStance === 'reject') priority = 'Cut';
      else if (combinedScore >= 7.5) priority = 'P0';
      else if (combinedScore >= 6) priority = 'P1';
      else priority = 'P2';

      return { ...r, priority, engineerData: eng, financeData: fin, gtmData: gtm };
    });

    console.log('Analysis complete.');
    res.json({
      recommendations,
      engineerEstimates: engineerOut.estimates || [],
      globalFlags: engineerOut.globalFlags || [],
      financeModels: financeOut.models || [],
      gtmPlans: gtmOut.gtmPlans || [],
      directorChallenges: directorOut.challenges || [],
      directorAssessment: directorOut.overallAssessment || '',
      directorTopPriority: directorOut.topPriority || '',
      directorBiggestConcern: directorOut.biggestConcern || '',
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

// ── Finance conversation ──────────────────────────────────────────────────────

app.post('/api/finance/chat', async (req, res) => {
  const { messages, recommendation, financeModel } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });

  try {
    const context = `You are analyzing the financial model for this recommendation:
Title: ${recommendation?.title}
Type: ${recommendation?.projectType}
Current model: ${JSON.stringify(financeModel)}

Engage with the PM's questions. Update assumptions when they provide new inputs. Show revised numbers clearly.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: FINANCE_CONVERSATION + '\n\n' + context,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    res.json({ response: msg.content.map(b => b.text || '').join('') });
  } catch (e) {
    res.status(500).json({ error: 'Chat failed' });
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
