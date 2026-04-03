require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Prompts ───────────────────────────────────────────────────────────────────

const ROADMAP_PARSER = `You are a product roadmap parser. Return ONLY a JSON array of roadmap items. No markdown, no explanation.
Each item: { "id": number, "item": "string", "description": "string", "status": "planned"|"in-progress"|"shipped"|"unknown" }
Return ONLY the JSON array.`;

const RESEARCHER = `You are a senior user researcher. Your ONLY job is to faithfully represent what users said. You are strictly prohibited from suggesting solutions or features.

Given feedback and existing themes, return ONLY this JSON:
{
  "themes": [
    {
      "id": "slug",
      "title": "3-6 word problem statement (never a solution)",
      "description": "What users are experiencing, grounded in what was said",
      "sentiment": "positive|negative|mixed|frustrated|urgent",
      "strength": 1-10,
      "frequency": "number of distinct sources",
      "isNew": boolean,
      "quotes": ["verbatim quote 1", "verbatim quote 2"],
      "ambiguities": ["what is still unclear"]
    }
  ],
  "probingQuestions": ["sharp follow-up question"],
  "researchGaps": ["area with weak or conflicting signal"]
}

Rules: 3-8 themes. Merge with existing (isNew: false if existing, strengthen if repeated). Titles must describe PROBLEMS not solutions. 4-6 probing questions. 2-4 research gaps. ONLY valid JSON.`;

const PM = `You are an experienced product manager evaluating user research themes. You receive researcher output only — never raw transcripts.

Given themes, return ONLY this JSON:
{
  "recommendations": [
    {
      "id": "slug",
      "themeId": "researcher theme id",
      "title": "What we should do (solution framing)",
      "rationale": "Why this, why now",
      "roadmapPlacement": "now|next|later|cut|new",
      "roadmapItemId": null,
      "userValue": 1-10,
      "strategicFit": 1-10,
      "confidenceScore": 1-10,
      "risks": ["risk"],
      "successMetrics": ["metric"]
    }
  ]
}

Note: roadmapPlacement assumes no roadmap context. Use "new" for net-new opportunities. ONLY valid JSON.`;

const ENGINEER = `You are a pragmatic senior engineer evaluating PM recommendations for feasibility.

Given recommendations, return ONLY this JSON:
{
  "estimates": [
    {
      "recommendationId": "slug",
      "effort": "XS|S|M|L|XL",
      "effortWeeks": "e.g. 1-2 weeks",
      "complexity": "low|medium|high|very-high",
      "dependencies": ["dependency"],
      "technicalRisks": ["risk"],
      "incrementalPath": "How to ship this in smaller pieces",
      "redFlags": ["anything underscoped or naive"]
    }
  ],
  "globalFlags": ["cross-cutting concern"]
}

Be realistic. Err pessimistic on effort. ONLY valid JSON.`;

const DIRECTOR = `You are a commercially-minded product director stress-testing PM recommendations before they go to roadmap.

Given recommendations and engineer estimates, return ONLY this JSON:
{
  "challenges": [
    {
      "recommendationId": "slug",
      "type": "roi|timing|scope|strategy|evidence|effort|risk",
      "challenge": "The hard question to the PM",
      "severity": "blocker|major|minor",
      "directorStance": "approve-pending-response|needs-revision|reject"
    }
  ],
  "overallAssessment": "brief overall take",
  "topPriority": "strongest recommendation and why",
  "biggestConcern": "biggest worry about this plan"
}

Challenge every recommendation. Be direct. ONLY valid JSON.`;

const PM_REBUTTAL = `You are the PM responding to director challenges. Defend with evidence, revise if fair, or concede if wrong.

Given your recommendations and director challenges, return ONLY this JSON:
{
  "rebuttals": [
    {
      "challengeIndex": number,
      "recommendationId": "slug",
      "stance": "defend|revise|concede",
      "response": "Your response",
      "revisedRecommendation": "Updated text if revised, else null",
      "revisedPlacement": "now|next|later|cut or null",
      "revisedConfidence": number or null
    }
  ],
  "finalSummary": "One paragraph exec-ready summary of what you're standing behind and what changed"
}

Cite specific evidence when defending. ONLY valid JSON.`;

const ROADMAP_EVALUATOR = `You are a senior product strategist evaluating accumulated user research themes against a product roadmap.

Given themes and roadmap items, return ONLY this JSON:
{
  "roadmapAnalysis": [
    {
      "roadmapItemId": number,
      "coverage": "addresses|partial|gap|unrelated",
      "rationale": "1 sentence"
    }
  ],
  "roadmapConflicts": [
    {
      "roadmapItemId": number,
      "issue": "What feedback suggests is wrong about this item's scope or priority",
      "recommendation": "Cut|Rescope|Reprioritize|Validate further"
    }
  ],
  "strategicGaps": [
    {
      "title": "Missing opportunity",
      "evidence": "Which themes support this",
      "urgency": "high|medium|low"
    }
  ]
}

Analyze every roadmap item. Be specific. ONLY valid JSON.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callClaude(system, userMessage, fileData) {
  const content = fileData
    ? [
        { type: fileData.isImage ? 'image' : 'document', source: { type: 'base64', media_type: fileData.mediaType, data: fileData.base64 } },
        { type: 'text', text: userMessage }
      ]
    : userMessage;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content }],
  });

  const raw = msg.content.map(b => b.text || '').join('');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function extractText(file) {
  const textTypes = ['text/plain', 'text/csv', 'text/markdown'];
  if (textTypes.includes(file.mimetype)) return file.buffer.toString('utf8');
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: file.mimetype.startsWith('image/') ? 'image' : 'document', source: { type: 'base64', media_type: file.mimetype || 'application/pdf', data: file.buffer.toString('base64') } },
        { type: 'text', text: 'Extract all text from this document. Return only raw text.' }
      ]
    }]
  });
  return msg.content.map(b => b.text || '').join('');
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Parse roadmap file/text → structured items
app.post('/api/parse-roadmap', upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) text = await extractText(req.file);
    const items = await callClaude(ROADMAP_PARSER, `Parse this roadmap:\n\n${text}`);
    res.json(Array.isArray(items) ? items : []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Roadmap parse failed' });
  }
});

// Main analysis pipeline: Researcher → PM → Engineer → Director → PM Rebuttal
app.post('/api/analyze', async (req, res) => {
  const { transcript, existingThemes = [] } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript' });

  try {
    // 1. Researcher
    const researcherOut = await callClaude(
      RESEARCHER,
      `Feedback:\n${transcript}\n\nExisting themes:\n${existingThemes.length ? JSON.stringify(existingThemes) : 'none'}`
    );

    // 2. PM
    const pmOut = await callClaude(
      PM,
      `Research themes:\n${JSON.stringify(researcherOut.themes)}`
    );

    // 3. Engineer
    const engineerOut = await callClaude(
      ENGINEER,
      `PM Recommendations:\n${JSON.stringify(pmOut.recommendations)}`
    );

    // 4. Director
    const directorOut = await callClaude(
      DIRECTOR,
      `PM Recommendations:\n${JSON.stringify(pmOut.recommendations)}\n\nEngineer Estimates:\n${JSON.stringify(engineerOut.estimates)}`
    );

    // 5. PM Rebuttal
    const rebuttalOut = await callClaude(
      PM_REBUTTAL,
      `Original recommendations:\n${JSON.stringify(pmOut.recommendations)}\n\nResearch themes (evidence):\n${JSON.stringify(researcherOut.themes)}\n\nDirector challenges:\n${JSON.stringify(directorOut.challenges)}`
    );

    res.json({
      themes: researcherOut.themes,
      probingQuestions: researcherOut.probingQuestions,
      researchGaps: researcherOut.researchGaps,
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

// Separate roadmap evaluation — runs on demand against accumulated themes
app.post('/api/evaluate-roadmap', async (req, res) => {
  const { themes, roadmapItems } = req.body;
  if (!themes?.length || !roadmapItems?.length) return res.status(400).json({ error: 'Missing themes or roadmap' });

  try {
    const result = await callClaude(
      ROADMAP_EVALUATOR,
      `User research themes:\n${JSON.stringify(themes)}\n\nRoadmap items:\n${JSON.stringify(roadmapItems)}`
    );
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

// Sessions
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
