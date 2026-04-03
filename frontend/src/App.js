import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  synthesizeThemes, runAnalysis, chatFinance,
  parseRoadmap, evaluateRoadmap,
  saveSession, getSessions, deleteSession
} from './api';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const SYNTH_MSGS = [
  'Loading documents from library...',
  'Researcher agent reading each document...',
  'Extracting customer problems and themes...',
  'Evaluating Amazon positioning for each theme...',
  'Synthesizing signals across all sources...',
  'Building master research model...',
  'Almost done...',
];

const PRIORITY_STYLE = {
  P0:  { cls: 'p0',   label: 'P0 — Critical' },
  P1:  { cls: 'p1',   label: 'P1 — High' },
  P2:  { cls: 'p2',   label: 'P2 — Medium' },
  Cut: { cls: 'pcut', label: 'Cut' },
};

const AMAZON_POS_BADGE = {
  yes:       { cls: 'b-green',  label: '✓ Uniquely Positioned' },
  partially: { cls: 'b-yellow', label: '~ Partially Positioned' },
  no:        { cls: 'b-gray',   label: '✗ Not Differentiated' },
};

const CERTAINTY_BADGE = {
  high:   { cls: 'b-green',  label: 'High Certainty' },
  medium: { cls: 'b-yellow', label: 'Medium Certainty' },
  low:    { cls: 'b-red',    label: 'Low Certainty' },
};

const SIZE_BADGE = {
  large:  { cls: 'b-red',    label: '🔴 Large Problem' },
  medium: { cls: 'b-yellow', label: '🟡 Medium Problem' },
  small:  { cls: 'b-gray',   label: '⚪ Small Problem' },
};

const COVERAGE_BADGE = {
  addresses: { cls: 'b-green',  label: '✓ Addresses' },
  partial:   { cls: 'b-yellow', label: '~ Partial' },
  gap:       { cls: 'b-red',    label: '✗ Gap' },
};

const STANCE_BADGE = {
  defend:  { cls: 'b-green',  label: '⚡ Defended' },
  revise:  { cls: 'b-yellow', label: '↻ Revised' },
  concede: { cls: 'b-red',    label: '✗ Conceded' },
};

const PROJECT_TYPE_BADGE = {
  revenue:    { cls: 'b-green',  label: '💰 Revenue Driver' },
  adoption:   { cls: 'b-blue',   label: '📈 Adoption Driver' },
  efficiency: { cls: 'b-purple', label: '⚡ Efficiency' },
  foundation: { cls: 'b-gray',   label: '🏗 Foundation' },
};

const GTM_DIFFICULTY = {
  easy:      { cls: 'b-green',  label: 'Easy Launch' },
  moderate:  { cls: 'b-yellow', label: 'Moderate Launch' },
  hard:      { cls: 'b-orange', label: 'Hard Launch' },
  'very-hard': { cls: 'b-red', label: 'Very Hard Launch' },
};

function Badge({ cls, label }) {
  return <span className={`badge ${cls}`}>{label}</span>;
}

function fileIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['docx', 'doc'].includes(ext)) return '📄';
  if (ext === 'pdf') return '📕';
  return '📃';
}

function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

function DeleteModal({ doc, onConfirm, onCancel }) {
  if (!doc) return null;
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Remove document?</div>
        <div className="modal-body">"{doc.name}" will be removed from the library and excluded from future synthesis.</div>
        <div className="modal-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ── Finance Chat Component ────────────────────────────────────────────────────
function FinanceChat({ recommendation, financeModel }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `I've built an initial financial model for **${recommendation?.title}**. The headline: ${financeModel?.headline || 'model pending'}. Ask me to refine any assumption, provide more context about your business, or explore different scenarios.` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const { response } = await chatFinance(newMessages, recommendation, financeModel);
      setMessages(m => [...m, { role: 'assistant', content: response }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, I had trouble with that. Please try again.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>
        ))}
        {loading && <div className="chat-msg assistant"><span className="pulse">Analyzing...</span></div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about assumptions, scenarios, inputs..."
          rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={loading || !input.trim()}>Send</button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('documents');

  // Documents
  const [documents, setDocuments]         = useState([]);
  const [uploading, setUploading]         = useState(false);
  const [uploadStatus, setUploadStatus]   = useState([]);
  const [dragOver, setDragOver]           = useState(false);
  const [docsLoading, setDocsLoading]     = useState(false);
  const [expandedDocs, setExpandedDocs]   = useState({});
  const [deleteTarget, setDeleteTarget]   = useState(null);

  // Synthesis
  const [synthesizing, setSynthesizing]   = useState(false);
  const [synthMsgIdx, setSynthMsgIdx]     = useState(0);
  const [synthElapsed, setSynthElapsed]   = useState(0);
  const [synthError, setSynthError]       = useState('');
  const [themes, setThemes]               = useState([]);
  const [questions, setQuestions]         = useState([]);
  const [researchGaps, setResearchGaps]   = useState([]);

  // Analysis
  const [analyzing, setAnalyzing]         = useState(false);
  const [analysisStep, setAnalysisStep]   = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [financeModels, setFinanceModels] = useState([]);
  const [gtmPlans, setGtmPlans]           = useState([]);
  const [directorChallenges, setDirectorChallenges] = useState([]);
  const [rebuttals, setRebuttals]         = useState([]);
  const [finalSummary, setFinalSummary]   = useState('');
  const [roadmapConflicts, setRoadmapConflicts] = useState([]);
  const [strategicGaps, setStrategicGaps] = useState([]);

  // Roadmap
  const [showRoadmap, setShowRoadmap]     = useState(false);
  const [roadmapText, setRoadmapText]     = useState('');
  const [roadmapFile, setRoadmapFile]     = useState(null);
  const [roadmapItems, setRoadmapItems]   = useState([]);
  const [roadmapParsed, setRoadmapParsed] = useState(false);
  const [parsingRoadmap, setParsingRoadmap] = useState(false);

  // UI
  const [activeTab, setActiveTab]         = useState('themes');
  const [toast, setToast]                 = useState('');
  const [saveStatus, setSaveStatus]       = useState('');
  const [sessions, setSessions]           = useState([]);
  const [expandedModeling, setExpandedModeling] = useState({});

  const fileRef = useRef(null);
  const roadmapRef = useRef(null);
  const synthIntervalRef = useRef(null);
  const elapsedRef = useRef(null);

  const hasThemes = themes.length > 0;
  const hasAnalysis = recommendations.length > 0;
  const rising = themes.filter(t => t.strength >= 7);

  useEffect(() => { loadDocuments(); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadDocuments = async () => {
    setDocsLoading(true);
    try { setDocuments(await getDocuments()); } catch {}
    setDocsLoading(false);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    if (!files.length) return;
    setUploading(true);
    setUploadStatus(files.map(f => ({ name: f.name, status: 'processing' })));
    try {
      const results = await uploadFiles(files);
      setUploadStatus(results.map(r => ({ name: r.name, status: r.error ? 'error' : 'done' })));
      await loadDocuments();
      setTimeout(() => setUploadStatus([]), 4000);
      const ok = results.filter(r => !r.error).length;
      if (ok > 0) showToast(`✓ ${ok} document${ok > 1 ? 's' : ''} uploaded and analyzed`);
    } catch {
      setUploadStatus(files.map(f => ({ name: f.name, status: 'error' })));
    }
    setUploading(false);
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDocument(deleteTarget.id); setDocuments(d => d.filter(x => x.id !== deleteTarget.id)); showToast('Document removed'); } catch {}
    setDeleteTarget(null);
  };

  // ── Synthesize ─────────────────────────────────────────────────────────────
  const handleSynthesize = async () => {
    setSynthesizing(true); setSynthError(''); setSynthMsgIdx(0); setSynthElapsed(0);
    setRecommendations([]); setRebuttals([]); setFinalSummary('');

    synthIntervalRef.current = setInterval(() => setSynthMsgIdx(i => Math.min(i + 1, SYNTH_MSGS.length - 1)), 4000);
    elapsedRef.current = setInterval(() => setSynthElapsed(s => s + 1), 1000);

    try {
      const data = await synthesizeThemes();
      clearInterval(synthIntervalRef.current);
      clearInterval(elapsedRef.current);
      setThemes(data.themes || []);
      setQuestions(data.probingQuestions || []);
      setResearchGaps(data.researchGaps || []);
      setSynthesizing(false);
      setView('results');
      setActiveTab('themes');
      showToast(`✓ ${data.themes?.length || 0} themes synthesized across ${documents.length} documents`);
    } catch (e) {
      clearInterval(synthIntervalRef.current);
      clearInterval(elapsedRef.current);
      setSynthError(e.message?.includes('No documents') ? 'No documents found. Upload documents first.' : 'Synthesis failed. Please try again.');
      setSynthesizing(false);
    }
  };

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!themes.length) return;
    setAnalyzing(true); setAnalysisError('');

    const steps = ['PM agent forming recommendations...', 'Engineer estimating effort...', 'Finance Analyst modeling impact...', 'GTM Specialist planning launch...', 'Director challenging assumptions...', 'PM defending the plan...'];
    let stepIdx = 0;
    setAnalysisStep(steps[0]);
    const stepInterval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1);
      setAnalysisStep(steps[stepIdx]);
    }, 18000);

    try {
      const data = await runAnalysis(themes, roadmapItems);
      clearInterval(stepInterval);
      setRecommendations(data.recommendations || []);
      setFinanceModels(data.financeModels || []);
      setGtmPlans(data.gtmPlans || []);
      setDirectorChallenges(data.directorChallenges || []);
      setRebuttals(data.rebuttals || []);
      setFinalSummary(data.finalSummary || '');
      setRoadmapConflicts(data.roadmapConflicts || []);
      setStrategicGaps(data.strategicGaps || []);
      setAnalyzing(false);
      setActiveTab('recommendations');
      showToast(`✓ Analysis complete — ${data.recommendations?.length || 0} recommendations`);
    } catch (e) {
      clearInterval(stepInterval);
      setAnalysisError('Analysis failed. Please try again.');
      setAnalyzing(false);
    }
  };

  // ── Roadmap ────────────────────────────────────────────────────────────────
  const handleParseRoadmap = async () => {
    setParsingRoadmap(true);
    try {
      const items = await parseRoadmap(roadmapFile, roadmapText);
      setRoadmapItems(Array.isArray(items) ? items : []);
      setRoadmapParsed(true);
      showToast(`✓ ${items.length} roadmap items parsed`);
    } catch {}
    setParsingRoadmap(false);
  };

  // ── Sessions ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSession({ themes, questions, researchGaps, recommendations, financeModels, gtmPlans, directorChallenges, rebuttals, finalSummary, roadmapItems, roadmapConflicts, strategicGaps });
      setSaveStatus('saved'); showToast('✓ Session saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus(''), 2500); }
  };

  const loadSessions = async () => {
    setView('sessions');
    try { setSessions(await getSessions()); } catch {}
  };

  const loadSession = (s) => {
    setThemes(s.themes || []);
    setQuestions(s.questions || []);
    setResearchGaps(s.researchGaps || []);
    setRecommendations(s.recommendations || []);
    setFinanceModels(s.financeModels || []);
    setGtmPlans(s.gtmPlans || []);
    setDirectorChallenges(s.directorChallenges || []);
    setRebuttals(s.rebuttals || []);
    setFinalSummary(s.finalSummary || '');
    setRoadmapItems(s.roadmapItems || []);
    setRoadmapConflicts(s.roadmapConflicts || []);
    setStrategicGaps(s.strategicGaps || []);
    setRoadmapParsed((s.roadmapItems || []).length > 0);
    setView('results'); setActiveTab('themes');
    showToast('Session loaded');
  };

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabs = [
    { key: 'themes',          label: 'Themes',           count: themes.length },
    { key: 'questions',       label: 'Follow-up',        count: questions.length },
    ...(hasAnalysis ? [
      { key: 'recommendations', label: 'Recommendations', count: recommendations.length },
      { key: 'modeling',        label: 'Financial Model', count: null },
      { key: 'review',          label: 'Agent Review',   count: null },
      ...(roadmapConflicts.length > 0 || strategicGaps.length > 0 ? [{ key: 'roadmap', label: 'Roadmap', count: null }] : []),
    ] : []),
  ];

  const stepDone = (n) => n === 1 ? documents.length > 0 : n === 2 ? hasThemes : false;

  return (
    <div className="app">
      <Toast msg={toast} />
      <DeleteModal doc={deleteTarget} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />

      {/* Header */}
      <header className="header">
        <div className="logo-wrap">
          <div className="logo-mark">IE</div>
          <div>
            <div className="logo-text">Insight Engine</div>
            <div className="logo-sub">User Research Intelligence</div>
          </div>
        </div>

        <div className="stepper">
          <button className={`step-btn ${view === 'documents' ? 'active' : ''} ${stepDone(1) ? 'done' : ''}`} onClick={() => setView('documents')}>
            <span className="step-num">{stepDone(1) ? '✓' : '1'}</span>
            <span>Documents</span>
          </button>
          <span className="step-arrow">›</span>
          <button className={`step-btn ${view === 'results' ? 'active' : ''} ${stepDone(2) ? 'done' : ''}`} onClick={() => hasThemes && setView('results')} disabled={!hasThemes}>
            <span className="step-num">{stepDone(2) && hasAnalysis ? '✓' : '2'}</span>
            <span>Analysis</span>
          </button>
          <span className="step-arrow">›</span>
          <button className={`step-btn ${view === 'sessions' ? 'active' : ''}`} onClick={loadSessions}>
            <span className="step-num">3</span>
            <span>Sessions</span>
          </button>
        </div>

        <div className="header-right">
          {rising.length > 0 && <Badge cls="b-orange" label={`↑ ${rising.length} Rising`} />}
          {hasThemes && (
            <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : 'Save Session'}
            </button>
          )}
        </div>
      </header>

      {/* ── Documents View ── */}
      {view === 'documents' && (
        <div className="page fade-in">
          <div className="two-col">
            <div className="sidebar">
              {/* Upload */}
              <div className="panel">
                <div className="panel-hd"><span className="panel-title">Upload Documents</span></div>
                <div className={`drop-zone${dragOver ? ' over' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}>
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md" style={{ display: 'none' }} onChange={e => handleFiles(Array.from(e.target.files))} />
                  <div className="dz-icon">{uploading ? <span className="spin">⏳</span> : '📂'}</div>
                  <div className="dz-title">{uploading ? 'Processing...' : 'Drop files or click to browse'}</div>
                  <div className="dz-sub">Word, PDF, TXT · Multiple files</div>
                </div>
                {uploadStatus.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {uploadStatus.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <span>{fileIcon(f.name)}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{f.name}</span>
                        <span style={{ fontWeight: 600, color: f.status === 'done' ? 'var(--green)' : f.status === 'error' ? 'var(--red)' : 'var(--yellow)', flexShrink: 0 }}>
                          {f.status === 'processing' ? <span className="pulse">Analyzing...</span> : f.status === 'done' ? '✓ Ready' : '✗ Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roadmap */}
              <div className="panel">
                <div className="panel-hd" style={{ marginBottom: showRoadmap ? 14 : 0 }}>
                  <span className="panel-title">Roadmap <Badge cls="b-gray" label="Optional" /></span>
                  <button className="btn btn-secondary btn-xs" onClick={() => setShowRoadmap(s => !s)}>
                    {showRoadmap ? 'Hide' : roadmapParsed ? `✓ ${roadmapItems.length} items` : 'Add →'}
                  </button>
                </div>
                {!showRoadmap && !roadmapParsed && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>Add your product roadmap to identify gaps and conflicts with user research.</div>
                )}
                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div className="drop-zone" style={{ padding: 12 }} onClick={() => roadmapRef.current?.click()}>
                          <input ref={roadmapRef} type="file" accept=".docx,.pdf,.txt,.md" style={{ display: 'none' }} onChange={e => { setRoadmapFile(e.target.files[0]); setRoadmapText(''); }} />
                          <div style={{ fontSize: 13, color: roadmapFile ? 'var(--green)' : 'var(--text-2)', fontWeight: 600 }}>{roadmapFile ? `✓ ${roadmapFile.name}` : 'Upload roadmap file'}</div>
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', margin: '8px 0' }}>or paste text</div>
                        <textarea value={roadmapText} onChange={e => { setRoadmapText(e.target.value); setRoadmapFile(null); }} placeholder="Q3 Roadmap&#10;- Feature A&#10;- Feature B" style={{ minHeight: 70, fontSize: 12 }} />
                        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={handleParseRoadmap} disabled={parsingRoadmap || (!roadmapFile && !roadmapText.trim())}>
                          {parsingRoadmap ? <><span className="spin">⚙</span> Parsing...</> : 'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
                          {roadmapItems.map(r => (
                            <div key={r.id} style={{ padding: '5px 8px', marginBottom: 3, background: 'var(--surface-2)', borderRadius: 5, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-2)' }}>{r.item}</div>
                          ))}
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setRoadmapParsed(false); setRoadmapItems([]); }}>Change Roadmap</button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Synth progress */}
              {synthesizing && (
                <div className="progress-box fade-in">
                  <div className="progress-hd"><span className="spin">⚙</span> Synthesizing Research</div>
                  <div className="progress-msg">{SYNTH_MSGS[synthMsgIdx]}</div>
                  <div className="progress-elapsed">{synthElapsed}s elapsed</div>
                </div>
              )}
              {analyzing && (
                <div className="progress-box fade-in">
                  <div className="progress-hd"><span className="spin">⚙</span> Agent Deliberation</div>
                  <div className="progress-msg">{analysisStep}</div>
                  <div className="progress-elapsed">This takes 2-4 minutes — 6 agents running sequentially</div>
                </div>
              )}
              {synthError && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--red)' }}>✗ {synthError}</div>}
              {analysisError && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--red)' }}>✗ {analysisError}</div>}
            </div>

            {/* Document library */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{documents.length} Document{documents.length !== 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Each file is analyzed individually, then synthesized into a unified research model</div>
                </div>
                <button className="btn btn-primary" onClick={handleSynthesize} disabled={synthesizing || documents.length === 0}>
                  {synthesizing ? <><span className="spin">⚙</span> Synthesizing...</> : '🔬 Synthesize Themes'}
                </button>
              </div>

              {docsLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Loading...</div>}
              {!docsLoading && documents.length === 0 && (
                <div className="empty">
                  <div className="empty-icon">📋</div>
                  <div className="empty-title">No documents yet</div>
                  <div className="empty-sub">Upload interview transcripts, survey responses, support tickets, or any user feedback. Each document is analyzed individually before synthesis.</div>
                </div>
              )}

              {documents.map(doc => (
                <div key={doc.id} className="doc-row">
                  <div className="doc-icon">{fileIcon(doc.name)}</div>
                  <div className="doc-body">
                    <div className="doc-name" title={doc.name}>{doc.name}</div>
                    <div className="doc-meta">{new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length || 0} themes · {doc.key_source || 'Unknown source'}</div>
                    {doc.document_summary && <div className="doc-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id] && (doc.themes || []).map(t => (
                      <div key={t.id} className="doc-theme"><strong>{t.customerProblem || t.title || t.id}</strong> — {t.description}</div>
                    ))}
                  </div>
                  <div className="doc-actions">
                    <button className="btn-icon" onClick={() => setExpandedDocs(p => ({ ...p, [doc.id]: !p[doc.id] }))} title="Show themes">{expandedDocs[doc.id] ? '▲' : '▼'}</button>
                    <button className="btn-icon red" onClick={() => setDeleteTarget(doc)} title="Remove">✕</button>
                  </div>
                </div>
              ))}

              {hasThemes && !analyzing && !hasAnalysis && (
                <div className="info-banner banner-blue" style={{ marginTop: 16 }}>
                  <div>
                    <div className="banner-title">✓ {themes.length} themes ready — run the full 6-agent analysis</div>
                    <div className="banner-sub">PM · Engineer · Finance · GTM · Director · Rebuttal</div>
                  </div>
                  <button className="btn btn-primary" onClick={() => { setView('results'); handleAnalyze(); }}>Run Analysis →</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Results View ── */}
      {view === 'results' && (
        <div className="page fade-in">
          {analyzing && (
            <div className="info-banner banner-blue" style={{ marginBottom: 20 }}>
              <div>
                <div className="banner-title"><span className="spin">⚙</span> {analysisStep}</div>
                <div className="banner-sub">6 agents running sequentially — typically takes 2-4 minutes</div>
              </div>
            </div>
          )}

          {!hasAnalysis && !analyzing && hasThemes && (
            <div className="info-banner banner-blue" style={{ marginBottom: 20 }}>
              <div>
                <div className="banner-title">Themes ready — run the full analysis</div>
                <div className="banner-sub">PM · Engineer · Finance · GTM · Director · Rebuttal</div>
              </div>
              <button className="btn btn-primary" onClick={handleAnalyze}>Run Analysis →</button>
            </div>
          )}

          <div className="tabs">
            {tabs.map(t => (
              <button key={t.key} className={`tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
                {t.label}
                {t.count != null && t.count > 0 && <span className="tab-ct">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* ── Themes ── */}
          {activeTab === 'themes' && (
            <div>
              {themes.map(t => {
                const sizeB = SIZE_BADGE[t.problemSize] || SIZE_BADGE.medium;
                const posB = AMAZON_POS_BADGE[t.amazonPositioned] || AMAZON_POS_BADGE.partially;
                const cerB = CERTAINTY_BADGE[t.certainty] || CERTAINTY_BADGE.medium;
                const strengthColor = t.strength >= 7 ? '#f59e0b' : t.strength >= 5 ? 'var(--blue)' : 'var(--border-strong)';
                return (
                  <div key={t.id} className="theme-card fade-in">
                    <div className="theme-header">
                      <div className="theme-problem">{t.customerProblem}</div>
                      <div className="theme-badges">
                        <Badge cls={sizeB.cls} label={sizeB.label} />
                        <Badge cls={posB.cls} label={posB.label} />
                      </div>
                    </div>
                    <div className="theme-grid">
                      <div className="theme-cell">
                        <div className="theme-field-label">Problem Description</div>
                        <div className="theme-field-val">{t.description}</div>
                      </div>
                      <div className="theme-cell">
                        <div className="theme-field-label">Amazon Uniquely Positioned?</div>
                        <div className="theme-field-val">{t.amazonPositioned === 'yes' ? 'Yes' : t.amazonPositioned === 'partially' ? 'Partially' : 'No'}</div>
                        <div className="theme-field-sub">{t.amazonPositionedRationale}</div>
                      </div>
                      <div className="theme-cell">
                        <div className="theme-field-label">Sources</div>
                        <div className="theme-field-val">{t.sourceCount || '—'} total</div>
                        <div className="theme-field-sub">{t.sourceMix}</div>
                      </div>
                      <div className="theme-cell">
                        <div className="theme-field-label">Certainty & Follow-up</div>
                        <div style={{ marginBottom: 4 }}><Badge cls={cerB.cls} label={cerB.label} /></div>
                        {t.followUpNeeded && <div className="theme-field-sub">⚠ {t.followUpNeeded}</div>}
                        {!t.followUpNeeded && <div className="theme-field-sub" style={{ color: 'var(--green)' }}>✓ Well understood</div>}
                      </div>
                    </div>
                    {t.quotes?.length > 0 && (
                      <div className="theme-cell-full" style={{ borderTop: '1px solid var(--border)' }}>
                        <div className="theme-field-label" style={{ marginBottom: 6 }}>Key Quote</div>
                        {t.quotes.slice(0, 1).map((q, i) => <div key={i} className="quote-block">"{q}"</div>)}
                      </div>
                    )}
                    <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Signal Strength</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: strengthColor }}>{t.strength}/10</span>
                      </div>
                      <div className="theme-strength-bar"><div className="theme-strength-fill" style={{ width: `${t.strength * 10}%`, background: strengthColor }} /></div>
                    </div>
                  </div>
                );
              })}
              {researchGaps.length > 0 && (
                <div style={{ padding: '12px 14px', background: 'var(--yellow-bg)', border: '1px solid #fde68a', borderRadius: 'var(--r)', marginTop: 4 }}>
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8, fontSize: 13 }}>⚠ Research Gaps</div>
                  {researchGaps.map((g, i) => <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 3 }}>· {g}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ── Follow-up Questions ── */}
          {activeTab === 'questions' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>Ask these in your next research session to close gaps and strengthen weak signals.</p>
              {questions.map((q, i) => (
                <div key={i} className="card" style={{ display: 'flex', gap: 14 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--border-strong)', flexShrink: 0, lineHeight: 1.3, fontFamily: 'Georgia, serif' }}>{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>{q.question || q}</div>
                    {q.whyItMatters && (
                      <div style={{ fontSize: 12, color: 'var(--blue)', background: 'var(--blue-bg)', padding: '4px 8px', borderRadius: 4 }}>
                        <strong>Why it matters:</strong> {q.whyItMatters}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Recommendations ── */}
          {activeTab === 'recommendations' && (
            <div>
              {recommendations.map(r => {
                const ps = PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.P2;
                const ptB = PROJECT_TYPE_BADGE[r.projectType] || PROJECT_TYPE_BADGE.revenue;
                const eng = r.engineerData || {};
                const fin = r.financeData || {};
                const gtm = r.gtmData || {};
                const gtmB = GTM_DIFFICULTY[gtm.launchDifficulty];
                const challenges = directorChallenges.filter(c => c.recommendationId === r.id);
                const rebuttal = rebuttals.find(rb => rb.recommendationId === r.id);

                // Roadmap coverage
                const covered = (r.roadmapCoverage || []).filter(rc => rc.coverage !== 'gap');
                const gaps = (r.roadmapCoverage || []).filter(rc => rc.coverage === 'gap');

                return (
                  <div key={r.id} className="rec-card">
                    <div className="rec-header">
                      <span className={`rec-priority ${ps.cls}`}>{ps.label}</span>
                      <div style={{ flex: 1 }}>
                        <div className="rec-title">{r.title}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <Badge cls={ptB.cls} label={ptB.label} />
                          {gtmB && <Badge cls={gtmB.cls} label={gtmB.label} />}
                        </div>
                      </div>
                    </div>

                    <div className="rec-section">
                      <div className="rec-section-title">What to Build</div>
                      <div className="rec-rationale">{r.rationale}</div>
                    </div>

                    <div className="rec-section">
                      <div className="rec-section-title">Minimum Lovable Product (MLP)</div>
                      <div className="rec-mlp">{r.mlp}</div>
                    </div>

                    <div className="rec-section">
                      <div className="rec-section-title">Scores</div>
                      <div className="rec-scorecard">
                        <div className="score-item">
                          <div className="score-item-val" style={{ color: 'var(--blue)' }}>{r.userValue}/10</div>
                          <div className="score-item-label">User Value</div>
                        </div>
                        <div className="score-item">
                          <div className="score-item-val" style={{ color: 'var(--purple)' }}>{r.strategicFit}/10</div>
                          <div className="score-item-label">Strategic Fit</div>
                        </div>
                        <div className="score-item">
                          <div className="score-item-val" style={{ color: '#0891b2' }}>{r.confidenceScore}/10</div>
                          <div className="score-item-label">Certainty</div>
                        </div>
                      </div>
                    </div>

                    <div className="rec-section">
                      <div className="rec-section-title">Effort & Impact</div>
                      <div className="rec-metrics">
                        {eng.effortWeeks && <div className="rec-metric"><span className="rec-metric-label">Effort</span><span className="rec-metric-val">{eng.effortWeeks}</span></div>}
                        {eng.complexity && <div className="rec-metric"><span className="rec-metric-label">Complexity</span><span className="rec-metric-val" style={{ textTransform: 'capitalize' }}>{eng.complexity}</span></div>}
                        {fin.headline && <div className="rec-metric"><span className="rec-metric-label">Financial Impact</span><span className="rec-metric-val" style={{ color: 'var(--green)' }}>{fin.headline}</span></div>}
                        {fin.roi && <div className="rec-metric"><span className="rec-metric-label">ROI</span><span className="rec-metric-val">{fin.roi}</span></div>}
                        {fin.paybackPeriod && <div className="rec-metric"><span className="rec-metric-label">Payback</span><span className="rec-metric-val">{fin.paybackPeriod}</span></div>}
                        {gtm.timeToMarket && <div className="rec-metric"><span className="rec-metric-label">Time to Market</span><span className="rec-metric-val">{gtm.timeToMarket}</span></div>}
                      </div>
                      {eng.incrementalPath && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>→ Incremental path: {eng.incrementalPath}</div>}
                      {(eng.redFlags || []).map((f, i) => <div key={i} style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>⚑ {f}</div>)}
                    </div>

                    {(r.roadmapCoverage?.length > 0 || covered.length > 0 || gaps.length > 0) && (
                      <div className="rec-section">
                        <div className="rec-section-title">Covered in Roadmap</div>
                        {(r.roadmapCoverage || []).map((rc, i) => {
                          const item = roadmapItems.find(ri => ri.id === rc.roadmapItemId);
                          const cb = COVERAGE_BADGE[rc.coverage];
                          return (
                            <div key={i} className="rec-roadmap-item">
                              {cb && <Badge cls={cb.cls} label={cb.label} />}
                              <span>{item?.item || `Item ${rc.roadmapItemId}`}</span>
                            </div>
                          );
                        })}
                        {r.roadmapCoverage?.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Not currently on roadmap</div>}
                      </div>
                    )}

                    {challenges.length > 0 && (
                      <div className="rec-section">
                        <div className="rec-section-title">Director Feedback</div>
                        {challenges.map((c, i) => (
                          <div key={i} className="challenge">
                            <div className="challenge-meta">
                              <Badge cls={c.isBlocker ? 'b-red' : 'b-yellow'} label={c.isBlocker ? 'Blocker' : 'Non-blocker'} />
                              <Badge cls="b-gray" label={c.category} />
                            </div>
                            <div className="challenge-text">{c.feedback}</div>
                            {rebuttals.find(rb => rb.recommendationId === r.id && rb.challengeIndex === i) && (() => {
                              const rb = rebuttals.find(x => x.recommendationId === r.id && x.challengeIndex === i);
                              const stB = STANCE_BADGE[rb.stance];
                              return (
                                <div className="rebuttal">
                                  {stB && <Badge cls={stB.cls} label={stB.label} />}
                                  <div className="rebuttal-text">{rb.response}</div>
                                  {rb.revisedTitle && <div style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 4, fontStyle: 'italic' }}>→ Revised: {rb.revisedTitle}</div>}
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}

                    {rebuttal && !challenges.length && (
                      <div className="rec-section">
                        <div className="rebuttal">
                          <Badge cls={STANCE_BADGE[rebuttal.stance]?.cls} label={STANCE_BADGE[rebuttal.stance]?.label} />
                          <div className="rebuttal-text">{rebuttal.response}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Financial Modeling ── */}
          {activeTab === 'modeling' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>
                Review the Finance Analyst's model for each recommendation. Ask questions, provide better inputs, or explore scenarios using the conversation interface.
              </p>
              {financeModels.map(m => {
                const rec = recommendations.find(r => r.id === m.recommendationId);
                const isExpanded = expandedModeling[m.recommendationId];
                return (
                  <div key={m.recommendationId} className="model-card">
                    <div className="model-header">
                      <div>
                        <div className="model-title">{rec?.title || m.recommendationId}</div>
                        <div className="model-headline">{m.headline}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Badge cls={m.projectType === 'revenue' ? 'b-green' : 'b-blue'} label={m.projectType === 'revenue' ? '💰 Revenue' : '📈 Adoption'} />
                        <button className="btn btn-secondary btn-xs" onClick={() => setExpandedModeling(p => ({ ...p, [m.recommendationId]: !p[m.recommendationId] }))}>
                          {isExpanded ? 'Collapse' : 'Expand & Discuss'}
                        </button>
                      </div>
                    </div>
                    <div className="model-body">
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                        {m.roi && <div className="rec-metric"><span className="rec-metric-label">ROI</span><span className="rec-metric-val">{m.roi}</span></div>}
                        {m.paybackPeriod && <div className="rec-metric"><span className="rec-metric-label">Payback</span><span className="rec-metric-val">{m.paybackPeriod}</span></div>}
                        {m.costToDeliver && <div className="rec-metric"><span className="rec-metric-label">Cost to Build</span><span className="rec-metric-val">{m.costToDeliver}</span></div>}
                        {m.revenueModel?.incrementalAnnualRevenue && <div className="rec-metric"><span className="rec-metric-label">Annual Revenue</span><span className="rec-metric-val" style={{ color: 'var(--green)' }}>{m.revenueModel.incrementalAnnualRevenue}</span></div>}
                        {m.adoptionModel?.projectedLift && <div className="rec-metric"><span className="rec-metric-label">Adoption Lift</span><span className="rec-metric-val">{m.adoptionModel.projectedLift}</span></div>}
                      </div>
                      {isExpanded && (
                        <>
                          <div className="divider" />
                          <div className="rec-section-title" style={{ marginBottom: 8 }}>Assumptions</div>
                          {(m.assumptions || []).map((a, i) => (
                            <div key={i} className="assumption-row">
                              <span className="assumption-label">{a.label}</span>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className="assumption-val">{a.value}</span>
                                <Badge cls={a.confidence === 'high' ? 'b-green' : a.confidence === 'medium' ? 'b-yellow' : 'b-red'} label={a.confidence} />
                              </div>
                            </div>
                          ))}
                          {m.inputsNeeded?.length > 0 && (
                            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--yellow-bg)', borderRadius: 'var(--r)', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                              <strong>Inputs that would sharpen this model:</strong> {m.inputsNeeded.join(', ')}
                            </div>
                          )}
                          <div className="divider" />
                          <div className="rec-section-title" style={{ marginBottom: 8 }}>Discuss with Finance Analyst</div>
                          <FinanceChat recommendation={rec} financeModel={m} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Agent Review ── */}
          {activeTab === 'review' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>
                The Director reviews every recommendation after PM, Engineer, Finance, and GTM agents have weighed in. Below are the challenges raised and how the PM responded.
              </p>
              {finalSummary && (
                <div className="card" style={{ background: 'var(--green-bg)', borderColor: 'var(--green-border)', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8, fontSize: 13 }}>PM Final Statement</div>
                  <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.7 }}>{finalSummary}</div>
                </div>
              )}
              <div className="section-hd">Director Challenges</div>
              {directorChallenges.map((c, i) => {
                const rec = recommendations.find(r => r.id === c.recommendationId);
                const rb = rebuttals.find(r => r.challengeIndex === i);
                return (
                  <div key={i} className="card">
                    {rec && <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Re: {rec.title}</div>}
                    <div className="challenge-meta">
                      <Badge cls={c.isBlocker ? 'b-red' : 'b-yellow'} label={c.isBlocker ? '🚫 Blocker' : '⚠ Non-blocker'} />
                      <Badge cls="b-gray" label={c.category} />
                      <Badge cls={c.directorStance === 'approve' ? 'b-green' : c.directorStance === 'reject' ? 'b-red' : 'b-yellow'} label={c.directorStance} />
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, fontWeight: 500, marginBottom: 8 }}>{c.feedback}</div>
                    {rb && (
                      <div className="rebuttal">
                        <Badge cls={STANCE_BADGE[rb.stance]?.cls} label={STANCE_BADGE[rb.stance]?.label} />
                        <div className="rebuttal-text">{rb.response}</div>
                        {rb.revisedTitle && <div style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 4, fontStyle: 'italic' }}>→ Revised to: {rb.revisedTitle}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Roadmap ── */}
          {activeTab === 'roadmap' && (
            <div>
              {strategicGaps.length > 0 && (
                <>
                  <div className="section-hd">Strategic Gaps — Not on your roadmap</div>
                  {strategicGaps.map((g, i) => (
                    <div key={i} className="card" style={{ borderLeft: '3px solid var(--purple)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ fontWeight: 600 }}>◈ {g.title}</div>
                        <Badge cls={g.urgency === 'high' ? 'b-red' : g.urgency === 'medium' ? 'b-yellow' : 'b-gray'} label={g.urgency + ' urgency'} />
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{g.evidence}</div>
                    </div>
                  ))}
                  <div className="divider" />
                </>
              )}
              {roadmapConflicts.length > 0 && (
                <>
                  <div className="section-hd">Roadmap Conflicts</div>
                  {roadmapConflicts.map((c, i) => {
                    const item = roadmapItems.find(r => r.id === c.roadmapItemId);
                    return (
                      <div key={i} className="card" style={{ borderLeft: '3px solid var(--red)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <div style={{ fontWeight: 600 }}>{item?.item || `Item ${c.roadmapItemId}`}</div>
                          <Badge cls="b-red" label={c.recommendation} />
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.issue}</div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Sessions View ── */}
      {view === 'sessions' && (
        <div className="page fade-in" style={{ maxWidth: 800 }}>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text-1)', marginBottom: 4 }}>Saved Sessions</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24 }}>Load a previous session to continue building on it.</div>
          {sessions.length === 0 && (
            <div className="empty">
              <div className="empty-icon">💾</div>
              <div className="empty-title">No saved sessions yet</div>
              <div className="empty-sub">Run an analysis and save it to store your work here.</div>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{s.themes?.length || 0} themes · {s.recommendations?.length || 0} recommendations</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => loadSession(s)}>Load</button>
                <button className="btn-ghost" style={{ color: 'var(--red)' }} onClick={() => deleteSession(s.id).then(() => setSessions(ss => ss.filter(x => x.id !== s.id)))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
