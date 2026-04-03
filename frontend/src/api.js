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

export async function synthesize() {
  const res = await fetch(`${BASE}/api/synthesize`, { method: 'POST' });
  if (!res.ok) throw new Error('Synthesis failed');
  return res.json();
}

export async function runAnalysis(themes) {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themes }),
  });
  if (!res.ok) throw new Error('Analysis failed');
  return res.json();
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
