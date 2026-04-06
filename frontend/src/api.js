import { supabase } from './supabase';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

// Get current auth token
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

// Authenticated fetch helpers
async function authFetch(url, options = {}) {
  const token = await getToken();
  const headers = { ...options.headers, Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function authFetchForm(url, formData) {
  const token = await getToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signOut() {
  await supabase.auth.signOut();
}

// ── Documents ─────────────────────────────────────────────────────────────────
export async function uploadFiles(files) {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  return authFetchForm(`${BASE}/api/upload`, form);
}

export async function getDocuments() {
  return authFetch(`${BASE}/api/documents`);
}

export async function deleteDocument(id) {
  return authFetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' });
}

// ── Synthesis & Analysis ──────────────────────────────────────────────────────
export async function synthesizeThemes() {
  return authFetch(`${BASE}/api/synthesize`, { method: 'POST' });
}

export async function runAnalysis(themes, roadmapItems = []) {
  return authFetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themes, roadmapItems }),
  });
}

// ── Finance ───────────────────────────────────────────────────────────────────
export async function chatFinance(messages, recommendation, financeModel) {
  return authFetch(`${BASE}/api/finance/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, recommendation, financeModel }),
  });
}

export async function recalculateFinance(recommendation, assumptions) {
  return authFetch(`${BASE}/api/finance/recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendation, assumptions }),
  });
}

// ── Roadmap ───────────────────────────────────────────────────────────────────
export async function parseRoadmap(file, text) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (text) form.append('text', text);
  return authFetchForm(`${BASE}/api/parse-roadmap`, form);
}

// ── Decisions ─────────────────────────────────────────────────────────────────
export async function saveDecision(recommendationId, title, decision, reason = '') {
  return authFetch(`${BASE}/api/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendationId, title, decision, reason }),
  });
}

export async function getDecisions() {
  return authFetch(`${BASE}/api/decisions`);
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export async function getLogs() {
  return authFetch(`${BASE}/api/logs`);
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export async function saveSession(session) {
  return authFetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

export async function getSessions() {
  return authFetch(`${BASE}/api/sessions`);
}

export async function deleteSession(id) {
  return authFetch(`${BASE}/api/sessions/${id}`, { method: 'DELETE' });
}
