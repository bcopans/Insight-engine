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

// Service role client for admin ops (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error) return res.status(401).json({ error: 'Auth error: ' + error.message });
    if (!user) return res.status(401).json({ error: 'No user found for token' });
    req.userId = user.id;
    req.userEmail = user.email;
    req.db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    next();
  } catch (e) {
    console.error('Auth middleware error:', e.message);
    res.status(401).json({ error: 'Auth failed: ' + e.message });
  }
}

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
  try { return JSON.parse(cleaned); }
  catch { const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (m) return JSON.parse(m[0]); throw new Error('Parse failed'); }
}

async function extractText(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const r = await mammoth.extractRawText({ buffer: file.buffer }); return r.value;
  }
  if (['text/plain','text/csv','text/markdown'].includes(file.mimetype) || name.endsWith('.txt') || name.endsWith('.md'))
    return file.buffer.toString('utf8');
  const isImg = file.mimetype?.startsWith('image/');
  const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: [
    { type: isImg ? 'image' : 'document', source: { type: 'base64', media_type: file.mimetype || 'application/pdf', data: file.buffer.toString('base64') } },
    { type: 'text', text: 'Extract all text. Return raw text only.' }
  ]}]});
  return msg.content.map(b => b.text || '').join('');
}

async function writeLog(db, userId, action, detail, metadata = {}) {
  try {
    await db.from('logs').insert([{ user_id: userId, action, detail, metadata }]);
  } catch (e) { console.error('Log failed:', e.message); }
}

const slim = {
  theme: t => ({ id: t.id, customerProblem: t.customerProblem, strength: t.strength, problemSize: t.problemSize }),
  rec: r => ({ id: r.id, stackRank: r.stackRank, title: r.title, rationale: r.rationale, projectType: r.projectType, userValue: r.userValue, strategicFit: r.strategicFit, mlp: r.mlp }),
  est: e => ({ recommendationId: e.recommendationId, effortWeeks: e.effortWeeks, effortSize: e.effortSize }),
  fin: m => ({ recommendationId: m.recommendationId, projectType: m.projectType, headline: m.headline }),
  gtm: g => ({ recommendationId: g.recommendationId, launchComplexity: g.launchComplexity, timeToMarket: g.timeToMarket }),
};

// ── Documents ─────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const results = [];
  for (const file of req.files) {
    try {
      const text = await extractText(file);
      const out = await callClaude(RESEARCHER_SINGLE, `Document: ${file.originalname}\n\nContent:\n${text.slice(0, 5000)}`, 2000);
      const { data, error } = await req.db.from('documents').insert([{
        user_id: req.userId,
        name: file.originalname, extracted_text: text.slice(0, 30000),
        themes: out.themes || [], document_summary: out.documentSummary || '',
        key_source: out.keySource || '', file_size: file.size, mime_type: file.mimetype,
      }]).select().single();
      if (error) throw error;
      await writeLog(req.db, req.userId, 'upload', `Uploaded "${file.originalname}"`, { documentId: data.id });
      results.push({ id: data.id, name: data.name, themes: data.themes, documentSummary: data.document_summary, keySource: data.key_source, uploadedAt: data.created_at });
    } catch (e) {
      console.error('Upload error:', file.originalname, e.message);
      results.push({ name: file.originalname, error: e.message });
    }
  }
  res.json(results);
});

app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from('documents')
      .select('id, name, themes, document_summary, key_source, file_size, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'DB error: ' + error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: 'Fetch failed: ' + e.message }); }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const { data } = await req.db.from('documents').select('name').eq('id', req.params.id).eq('user_id', req.userId).single();
    await req.db.from('documents').delete().eq('id', req.params.id).eq('user_id', req.userId);
    await writeLog(req.db, req.userId, 'delete_document', `Removed "${data?.name}"`);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Delete failed' }); }
});

// ── Synthesize ────────────────────────────────────────────────────────────────
app.post('/api/synthesize', requireAuth, async (req, res) => {
  try {
    const { data: docs, error } = await req.db.from('documents')
      .select('name, themes, document_summary, key_source')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Database error' });
    if (!docs?.length) return res.status(400).json({ error: 'No documents found. Please upload documents first.' });

    const input = docs.map(d => ({
      document: d.name, source: d.key_source || '', summary: d.document_summary || '',
      themes: (d.themes || []).map(t => ({
        customerProblem: t.customerProblem, description: t.description,
        sentiment: t.sentiment, strength: t.strength,
        amazonPositioned: t.amazonPositioned, amazonPositionedRationale: t.amazonPositionedRationale,
        certainty: t.certainty, followUpNeeded: t.followUpNeeded,
        sourceType: t.sourceType, customerType: t.customerType,
        quote: (t.quotes || [])[0] || '',
      })),
    }));

    const out = await callClaude(MASTER_RESEARCHER, `Synthesize themes from ${docs.length} documents:\n\n${JSON.stringify(input)}`, 4000);
    await writeLog(req.db, req.userId, 'synthesize', `Synthesized ${docs.length} documents → ${out.themes?.length || 0} themes`);
    res.json(out);
  } catch (e) {
    console.error('Synthesize error:', e.message);
    res.status(500).json({ error: 'Synthesis failed: ' + e.message });
  }
});

// ── Full analysis ─────────────────────────────────────────────────────────────
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { themes, roadmapItems = [] } = req.body;
  if (!themes?.length) return res.status(400).json({ error: 'No themes' });
  const slimThemes = themes.map(slim.theme);
  try {
    const pmOut = await callClaude(PM, `Themes:\n${JSON.stringify(slimThemes)}\n\nRoadmap:\n${JSON.stringify(roadmapItems)}`, 3000);
    const slimRecs = (pmOut.recommendations || []).map(slim.rec);
    const engOut = await callClaude(ENGINEER, `Recommendations:\n${JSON.stringify(slimRecs)}`, 2000).catch(() => ({ estimates: [] }));
    const slimEsts = (engOut.estimates || []).map(slim.est);
    const finOut = await callClaude(FINANCE_ANALYST, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nEffort:\n${JSON.stringify(slimEsts)}`, 3000).catch(() => ({ models: [] }));
    const slimFin = (finOut.models || []).map(slim.fin);
    const gtmOut = await callClaude(GTM_SPECIALIST, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nFinance:\n${JSON.stringify(slimFin)}`, 2000).catch(() => ({ gtmPlans: [] }));
    const slimGtm = (gtmOut.gtmPlans || []).map(slim.gtm);
    const dirOut = await callClaude(DIRECTOR, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nEffort:\n${JSON.stringify(slimEsts)}\n\nFinance:\n${JSON.stringify(slimFin)}\n\nGTM:\n${JSON.stringify(slimGtm)}`, 2500).catch(() => ({ challenges: [] }));
    const rebuttalOut = await callClaude(PM_REBUTTAL, `Recommendations:\n${JSON.stringify(slimRecs)}\n\nThemes:\n${JSON.stringify(slimThemes)}\n\nChallenges:\n${JSON.stringify(dirOut.challenges || [])}`, 2000).catch(() => ({ rebuttals: [], finalSummary: '' }));

    const recommendations = (pmOut.recommendations || [])
      .sort((a, b) => (a.stackRank || 99) - (b.stackRank || 99))
      .map(r => {
        const eng = (engOut.estimates || []).find(e => e.recommendationId === r.id);
        const fin = (finOut.models || []).find(m => m.recommendationId === r.id);
        const gtm = (gtmOut.gtmPlans || []).find(g => g.recommendationId === r.id);
        const dc = (dirOut.challenges || []).find(c => c.recommendationId === r.id);
        const pmScore = ((r.userValue || 5) + (r.strategicFit || 5) + (r.confidenceScore || 5)) / 3;
        const penalty = eng?.effortSize === 'XL' ? -1.5 : eng?.effortSize === 'L' ? -0.5 : 0;
        const priority = dc?.directorStance === 'reject' ? 'Cut' : (pmScore + penalty) >= 7.5 ? 'P0' : (pmScore + penalty) >= 6 ? 'P1' : 'P2';
        return { ...r, priority, eng, fin, gtm };
      });

    await writeLog(req.db, req.userId, 'analyze', `Analysis complete — ${recommendations.length} recommendations`);
    res.json({
      recommendations, directorChallenges: dirOut.challenges || [],
      directorAssessment: dirOut.overallAssessment || '', directorTopPriority: dirOut.topPriority || '',
      directorBiggestConcern: dirOut.biggestConcern || '',
      rebuttals: rebuttalOut.rebuttals || [], finalSummary: rebuttalOut.finalSummary || '',
      roadmapConflicts: pmOut.roadmapConflicts || [], strategicGaps: pmOut.strategicGaps || [],
    });
  } catch (e) {
    console.error('Analysis error:', e.message);
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

// ── Finance ───────────────────────────────────────────────────────────────────
app.post('/api/finance/chat', requireAuth, async (req, res) => {
  const { messages, recommendation, financeModel } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });
  try {
    const ctx = `Recommendation: ${recommendation?.title}\nType: ${recommendation?.projectType}\nModel:\n${JSON.stringify(financeModel, null, 2)}`;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: FINANCE_CONVERSATION + '\n\n' + ctx,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const response = msg.content.map(b => b.text || '').join('');
    await writeLog(req.db, req.userId, 'finance_chat', `Finance chat on "${recommendation?.title}"`);
    res.json({ response });
  } catch { res.status(500).json({ error: 'Chat failed' }); }
});

app.post('/api/finance/recalculate', requireAuth, async (req, res) => {
  const { recommendation, assumptions } = req.body;
  try {
    const out = await callClaude(FINANCE_CONVERSATION,
      `Recalculate financial impact for: ${recommendation?.title}\nType: ${recommendation?.projectType}\nUpdated assumptions:\n${JSON.stringify(assumptions)}\nReturn JSON: { "headline": "updated impact", "calculationLogic": "how you got there" }`, 500);
    await writeLog(req.db, req.userId, 'finance_recalculate', `Recalculated model for "${recommendation?.title}"`);
    res.json(out);
  } catch { res.status(500).json({ error: 'Recalculate failed' }); }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────
app.post('/api/parse-roadmap', requireAuth, upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) text = await extractText(req.file);
    if (!text.trim()) return res.status(400).json({ error: 'No text provided' });
    const truncated = text.slice(0, 8000);
    const items = await callClaude(ROADMAP_PARSER, `Parse this roadmap into a JSON array:\n\n${truncated}`, 3000);
    const arr = Array.isArray(items) ? items : (items?.items || []);
    await writeLog(req.db, req.userId, 'parse_roadmap', `Parsed roadmap — ${arr.length} items`);
    res.json(arr);
  } catch (e) {
    console.error('Roadmap parse error:', e.message);
    res.status(500).json({ error: 'Parse failed: ' + e.message });
  }
});

// ── Decisions ─────────────────────────────────────────────────────────────────
app.post('/api/decisions', requireAuth, async (req, res) => {
  const { recommendationId, title, decision, reason } = req.body;
  try {
    const { data, error } = await req.db.from('decisions').insert([{
      user_id: req.userId, recommendation_id: recommendationId, title, decision, reason
    }]).select().single();
    if (error) throw error;
    await writeLog(req.db, req.userId, 'decision', `${decision === 'accept' ? '✓ Accepted' : '✗ Rejected'} "${title}"`, { reason });
    res.json(data);
  } catch { res.status(500).json({ error: 'Save failed' }); }
});

app.get('/api/decisions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from('decisions')
      .select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch { res.status(500).json({ error: 'Fetch failed' }); }
});

// ── Logs ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from('logs')
      .select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch { res.status(500).json({ error: 'Fetch failed' }); }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
app.post('/api/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from('sessions').insert([{ ...req.body, user_id: req.userId }]).select().single();
    if (error) throw error;
    await writeLog(req.db, req.userId, 'save_session', 'Session saved');
    res.json(data);
  } catch { res.status(500).json({ error: 'Save failed' }); }
});

app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.db.from('sessions')
      .select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch { res.status(500).json({ error: 'Fetch failed' }); }
});

app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    await req.db.from('sessions').delete().eq('id', req.params.id).eq('user_id', req.userId);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Delete failed' }); }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Insight Engine running on port ${PORT}`));
