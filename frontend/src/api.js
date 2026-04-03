const BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export async function uploadFiles(files) {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function getDocuments() {
  const res = await fetch(`${BASE}/api/documents`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function deleteDocument(id) {
  const res = await fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

// SSE-based streaming synthesize
export function streamSynthesize(handlers) {
  const { onStatus, onComplete, onError } = handlers;
  fetch(`${BASE}/api/synthesize`, { method: 'POST' })
    .then(res => readSSE(res, { onStatus, onComplete, onError }))
    .catch(e => onError(e.message));
}

// SSE-based streaming analyze
export function streamAnalyze(themes, handlers) {
  const { onAgent, onComplete, onError } = handlers;
  fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themes }),
  })
    .then(res => readSSE(res, { onAgent, onComplete, onError }))
    .catch(e => onError(e.message));
}

// Generic SSE reader
function readSSE(res, handlers) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const pump = () => reader.read().then(({ done, value }) => {
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    let event = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
      if (line.startsWith('data: ') && event) {
        try {
          const data = JSON.parse(line.slice(6));
          if (event === 'status' && handlers.onStatus) handlers.onStatus(data);
          if (event === 'agent' && handlers.onAgent) handlers.onAgent(data);
          if (event === 'complete' && handlers.onComplete) handlers.onComplete(data);
          if (event === 'error' && handlers.onError) handlers.onError(data.message);
        } catch {}
        event = null;
      }
    }
    pump();
  }).catch(e => handlers.onError && handlers.onError(e.message));

  pump();
}

export async function parseRoadmap(file, text) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (text) form.append('text', text);
  const res = await fetch(`${BASE}/api/parse-roadmap`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Parse failed');
  return res.json();
}

export async function evaluateRoadmap(themes, roadmapItems) {
  const res = await fetch(`${BASE}/api/evaluate-roadmap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themes, roadmapItems }),
  });
  if (!res.ok) throw new Error('Evaluation failed');
  return res.json();
}

export async function saveSession(session) {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error('Save failed');
  return res.json();
}

export async function getSessions() {
  const res = await fetch(`${BASE}/api/sessions`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export async function deleteSession(id) {
  const res = await fetch(`${BASE}/api/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}
