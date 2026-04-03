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

export async function streamSynthesize(handlers) {
  const { onStatus, onComplete, onError } = handlers;
  try {
    onStatus({ message: 'Master Researcher synthesizing themes across all documents...' });
    const res = await fetch(`${BASE}/api/synthesize`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Synthesis failed');
    }
    const data = await res.json();
    onComplete(data);
  } catch (e) {
    onError(e.message);
  }
}

export async function streamAnalyze(themes, handlers) {
  const { onAgent, onComplete, onError } = handlers;
  try {
    onAgent({ agent: 'pm', status: 'running', message: 'PM forming recommendations...' });
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themes }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Analysis failed');
    }
    onAgent({ agent: 'engineer', status: 'running', message: 'Engineer estimating effort...' });
    const data = await res.json();
    onAgent({ agent: 'rebuttal', status: 'done' });
    onComplete(data);
  } catch (e) {
    onError(e.message);
  }
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
