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
app.use(express.json());

// ── Prompts ──────────────────────────────────────────────────────────────────

const ROADMAP_PARSER_PROMPT = `You are a product roadmap parser. Parse the input and return ONLY a JSON array of roadmap items. No markdown, no explanation.

Each item: { "id": number, "item": "string", "description": "string", "status": "planned"|"in-progress"|"shipped"|"unknown" }

Return ONLY the JSON array.`;

const THEME_EXTRACTOR_PROMPT = `You are an expert user researcher and product strategist. Analyze raw user feedback and return structured JSON only — no markdown, no explanation.

Return exactly:
{
  "themes": [{"id":"slug","title":"3-6 words","description":"1-2 sentences","sentiment":"positive|negative|mixed","strength":1-10,"isNew":true,"quote":"verbatim quote or empty string"}],
  "probingQuestions": ["question"],
  "roadmapAnalysis": [{"roadmapItemId":1,"coverage":"addresses|partial|gap|unrelated","rationale":"1 sentence"}],
  "newOpportunities": [{"title":"string","rationale":"1-2 sentences"}]
}

Rules: 3-6 themes, merge with existing (mark existing as isNew:false), 4-6 probing questions, analyze every roadmap item, 1-3 new opportunities, strength 7+ is a rising signal. ONLY valid JSON.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callClaude(system, userMessage, imageData) {
  const content = imageData
    ? [{ type: imageData.isImage ? 'image' : 'document', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } }, { type: 'text', text: userMessage }]
    : userMessage;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content }],
  });

  const raw = msg.content.map(b => b.text || '').join('');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Parse roadmap
app.post('/api/parse-roadmap', upload.single('file'), async (req, res) => {
  try {
    let userMessage = '';

    if (req.file) {
      const mediaType = req.file.mimetype || 'application/pdf';
      const isImage = mediaType.startsWith('image/');
      const isText = ['text/plain', 'text/csv', 'text/markdown'].includes(mediaType);

      if (isText) {
        userMessage = `Parse this roadmap:\n\n${req.file.buffer.toString('utf8')}`;
        const items = await callClaude(ROADMAP_PARSER_PROMPT, userMessage);
        return res.json(Array.isArray(items) ? items : []);
      }

      const base64 = req.file.buffer.toString('base64');
      const items = await callClaude(ROADMAP_PARSER_PROMPT, 'Parse this roadmap document into structured items.', { base64, mediaType, isImage });
      return res.json(Array.isArray(items) ? items : []);
    }

    if (req.body.text) {
      userMessage = `Parse this roadmap:\n\n${req.body.text}`;
      const items = await callClaude(ROADMAP_PARSER_PROMPT, userMessage);
      return res.json(Array.isArray(items) ? items : []);
    }

    res.status(400).json({ error: 'No file or text provided' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Roadmap parse failed' });
  }
});

// Analyze transcript
app.post('/api/analyze', async (req, res) => {
  try {
    const { transcript, roadmapItems = [], existingThemes = [] } = req.body;
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

    const userMessage = `Feedback:\n${transcript}\n\nRoadmap:\n${roadmapItems.map(r => `${r.id}. ${r.item}${r.description ? ` — ${r.description}` : ''}`).join('\n')}\n\nExisting themes:\n${existingThemes.length ? JSON.stringify(existingThemes.map(t => ({ id: t.id, title: t.title, strength: t.strength }))) : 'none'}`;

    const result = await callClaude(THEME_EXTRACTOR_PROMPT, userMessage);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Save session
app.post('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').insert([req.body]).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Save failed' });
  }
});

// Get all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sessions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Delete session
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('sessions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Insight Engine backend running on port ${PORT}`));
