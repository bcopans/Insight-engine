import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  streamSynthesize, streamAnalyze,
  parseRoadmap, evaluateRoadmap,
  saveSession, getSessions, deleteSession
} from './api';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 'pm',       icon: '🎯', name: 'PM Agent',        desc: 'Forming recommendations & roadmap placement' },
  { id: 'engineer', icon: '⚙️', name: 'Engineer Agent',  desc: 'Estimating effort & flagging technical risks' },
  { id: 'director', icon: '🔍', name: 'Director Agent',  desc: 'Challenging every assumption' },
  { id: 'rebuttal', icon: '💬', name: 'PM Rebuttal',     desc: 'Defending, revising, or conceding each challenge' },
];

const SYNTH_MESSAGES = [
  'Connecting to document library...',
  'Loading uploaded documents...',
  'Researcher agent reading documents...',
  'Extracting themes and patterns...',
  'Synthesizing signals across sources...',
  'Identifying cross-cutting insights...',
  'Building master theme model...',
  'Almost done...',
];

const SENTIMENT_BADGE = {
  positive:   { cls: 'badge-green',  label: 'Positive' },
  negative:   { cls: 'badge-red',    label: 'Negative' },
  mixed:      { cls: 'badge-yellow', label: 'Mixed' },
  frustrated: { cls: 'badge-orange', label: 'Frustrated' },
  urgent:     { cls: 'badge-red',    label: 'Urgent' },
};
const PLACEMENT_BADGE = {
  now:   { cls: 'badge-green',  label: 'Ship Now' },
  next:  { cls: 'badge-yellow', label: 'Next Quarter' },
  later: { cls: 'badge-gray',   label: 'Later' },
  cut:   { cls: 'badge-red',    label: 'Cut' },
  new:   { cls: 'badge-purple', label: 'New Opportunity' },
};
const EFFORT_BADGE = {
  XS: 'badge-green', S: 'badge-green', M: 'badge-yellow', L: 'badge-orange', XL: 'badge-red'
};
const COVERAGE_BADGE = {
  addresses: { cls: 'badge-green',  label: '✓ Addressed' },
  partial:   { cls: 'badge-yellow', label: '~ Partial' },
  gap:       { cls: 'badge-red',    label: '✗ Gap' },
  unrelated: { cls: 'badge-gray',   label: '— Unrelated' },
};
const STANCE_BADGE = {
  defend:  { cls: 'badge-green',  label: '⚡ Defended' },
  revise:  { cls: 'badge-yellow', label: '↻ Revised' },
  concede: { cls: 'badge-red',    label: '✗ Conceded' },
};
const SEVERITY_BADGE = {
  blocker: { cls: 'badge-red', label: 'Blocker' },
  major:   { cls: 'badge-orange', label: 'Major' },
  minor:   { cls: 'badge-yellow', label: 'Minor' },
};

// ── Small Components ──────────────────────────────────────────────────────────

function Badge({ type, map, label }) {
  const cfg = map?.[type] || { cls: 'badge-gray', label: type };
  return <span className={`badge ${cfg.cls}`}>{label || cfg.label}</span>;
}

function ScoreBar({ label, value, color }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-track"><div className="score-fill" style={{ width: `${value * 10}%`, background: color }} /></div>
      <span className="score-val">{value}</span>
    </div>
  );
}

function fileIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['docx','doc'].includes(ext)) return '📄';
  if (ext === 'pdf') return '📕';
  if (['png','jpg','jpeg'].includes(ext)) return '🖼️';
  return '📃';
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

function DeleteModal({ doc, onConfirm, onCancel }) {
  if (!doc) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Remove document?</div>
        <div className="modal-body">
          <span className="modal-filename">"{doc.name}"</span> will be removed from the library and excluded from future synthesis runs.
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm" style={{ background: '#dc2626', color: 'white' }} onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function AgentProgress({ agentStatuses, agentMessages, isSynthesizing, synthMessage, elapsed }) {
  if (!isSynthesizing && !Object.keys(agentStatuses).length) return null;
  return (
    <div className="progress-panel fade-in">
      <div className="progress-title">
        <span className="spin">⚙</span>
        {isSynthesizing ? 'Synthesizing Research' : 'Agent Deliberation'}
      </div>
      {isSynthesizing && (
        <>
          <div className="progress-message">{synthMessage}</div>
          <div className="progress-elapsed">{elapsed}s elapsed</div>
        </>
      )}
      {!isSynthesizing && AGENTS.map(a => {
        const status = agentStatuses[a.id] || 'idle';
        const msg = agentMessages[a.id] || a.desc;
        return (
          <div key={a.id} className={`agent-item ${status}`}>
            <span className="agent-icon">{a.icon}</span>
            <div className="agent-info">
              <div className="agent-name">{a.name}</div>
              <div className="agent-desc">{msg}</div>
            </div>
            <div className="agent-status">
              {status === 'running' && <span className="pulse">Running...</span>}
              {status === 'done' && '✓'}
              {status === 'error' && '✗'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('documents'); // documents | results | sessions

  // Documents
  const [documents, setDocuments]           = useState([]);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [dragOver, setDragOver]             = useState(false);
  const [docsLoading, setDocsLoading]       = useState(false);
  const [expandedDocs, setExpandedDocs]     = useState({});
  const [deleteTarget, setDeleteTarget]     = useState(null);

  // Synthesis
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthMsgIdx, setSynthMsgIdx]       = useState(0);
  const [synthElapsed, setSynthElapsed]     = useState(0);
  const [synthError, setSynthError]         = useState('');
  const [masterThemes, setMasterThemes]     = useState([]);
  const [probingQuestions, setProbingQuestions] = useState([]);
  const [researchGaps, setResearchGaps]     = useState([]);
  const [crossCuttingInsights, setCrossCuttingInsights] = useState([]);

  // Analysis
  const [isAnalyzing, setIsAnalyzing]       = useState(false);
  const [agentStatuses, setAgentStatuses]   = useState({});
  const [agentMessages, setAgentMessages]   = useState({});
  const [analysisError, setAnalysisError]   = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [engineerEstimates, setEngineerEstimates] = useState([]);
  const [directorChallenges, setDirectorChallenges] = useState([]);
  const [rebuttals, setRebuttals]           = useState([]);
  const [finalSummary, setFinalSummary]     = useState('');

  // Roadmap
  const [showRoadmap, setShowRoadmap]       = useState(false);
  const [roadmapText, setRoadmapText]       = useState('');
  const [roadmapFile, setRoadmapFile]       = useState(null);
  const [roadmapItems, setRoadmapItems]     = useState([]);
  const [roadmapParsed, setRoadmapParsed]   = useState(false);
  const [parsingRoadmap, setParsingRoadmap] = useState(false);
  const [evaluating, setEvaluating]         = useState(false);
  const [evaluated, setEvaluated]           = useState(false);
  const [roadmapAnalysis, setRoadmapAnalysis] = useState([]);
  const [roadmapConflicts, setRoadmapConflicts] = useState([]);
  const [strategicGaps, setStrategicGaps]   = useState([]);

  // UI
  const [activeTab, setActiveTab]           = useState('themes');
  const [toast, setToast]                   = useState('');
  const [saveStatus, setSaveStatus]         = useState('');
  const [sessions, setSessions]             = useState([]);

  const fileRef = useRef(null);
  const roadmapFileRef = useRef(null);
  const synthInterval = useRef(null);
  const elapsedInterval = useRef(null);

  const hasResults = masterThemes.length > 0;
  const hasAnalysis = recommendations.length > 0;
  const rising = masterThemes.filter(t => t.strength >= 7);

  useEffect(() => { loadDocuments(); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Document load ──────────────────────────────────────────────────────────
  const loadDocuments = async () => {
    setDocsLoading(true);
    try { setDocuments(await getDocuments()); } catch {}
    setDocsLoading(false);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(files.map(f => ({ name: f.name, status: 'processing' })));
    try {
      const results = await uploadFiles(files);
      const hasErrors = results.some(r => r.error);
      setUploadProgress(results.map(r => ({ name: r.name, status: r.error ? 'error' : 'done' })));
      await loadDocuments();
      setTimeout(() => setUploadProgress([]), 4000);
      if (!hasErrors) showToast(`✓ ${files.length} document${files.length > 1 ? 's' : ''} uploaded and analyzed`);
    } catch {
      setUploadProgress(files.map(f => ({ name: f.name, status: 'error' })));
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); };

  // ── Delete with confirmation ───────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDocument(deleteTarget.id);
      setDocuments(d => d.filter(x => x.id !== deleteTarget.id));
      showToast('Document removed');
    } catch {}
    setDeleteTarget(null);
  };

  // ── Synthesis with progress messages ──────────────────────────────────────
  const handleSynthesize = () => {
    setIsSynthesizing(true); setSynthError(''); setSynthMsgIdx(0); setSynthElapsed(0);
    setRecommendations([]); setRebuttals([]); setFinalSummary(''); setEvaluated(false);
    setAgentStatuses({}); setAgentMessages({});

    // Cycle status messages
    synthInterval.current = setInterval(() => {
      setSynthMsgIdx(i => Math.min(i + 1, SYNTH_MESSAGES.length - 1));
    }, 4000);

    // Elapsed counter
    elapsedInterval.current = setInterval(() => {
      setSynthElapsed(s => s + 1);
    }, 1000);

    streamSynthesize({
      onStatus: () => {},
      onComplete: (data) => {
        clearInterval(synthInterval.current);
        clearInterval(elapsedInterval.current);
        setMasterThemes(data.themes || []);
        setProbingQuestions(data.probingQuestions || []);
        setResearchGaps(data.researchGaps || []);
        setCrossCuttingInsights(data.crossCuttingInsights || []);
        setIsSynthesizing(false);
        setView('results');
        setActiveTab('themes');
        showToast(`✓ ${data.themes?.length || 0} themes synthesized across ${documents.length} documents`);
      },
      onError: (msg) => {
        clearInterval(synthInterval.current);
        clearInterval(elapsedInterval.current);
        setSynthError(msg?.includes('No documents') ? 'No documents found. Please upload at least one document first.' : 'Synthesis failed. Please try again.');
        setIsSynthesizing(false);
      }
    });
  };

  // ── Analysis ───────────────────────────────────────────────────────────────
  const handleRunAnalysis = () => {
    if (!masterThemes.length) return;
    setIsAnalyzing(true); setAnalysisError('');
    setAgentStatuses({ pm: 'running', engineer: 'idle', director: 'idle', rebuttal: 'idle' });
    setAgentMessages({ pm: 'Reviewing research themes and forming recommendations...' });

    streamAnalyze(masterThemes, {
      onAgent: ({ agent, status, message }) => {
        setAgentStatuses(p => ({ ...p, [agent]: status }));
        if (message) setAgentMessages(p => ({ ...p, [agent]: message }));
        // Simulate progression
        if (agent === 'pm' && status === 'done') setAgentStatuses(p => ({ ...p, engineer: 'running' }));
        if (agent === 'engineer' && status === 'done') setAgentStatuses(p => ({ ...p, director: 'running' }));
        if (agent === 'director' && status === 'done') setAgentStatuses(p => ({ ...p, rebuttal: 'running' }));
      },
      onComplete: (data) => {
        setAgentStatuses({ pm: 'done', engineer: 'done', director: 'done', rebuttal: 'done' });
        setRecommendations(data.recommendations || []);
        setEngineerEstimates(data.engineerEstimates || []);
        setDirectorChallenges(data.directorChallenges || []);
        setRebuttals(data.rebuttals || []);
        setFinalSummary(data.finalSummary || '');
        setIsAnalyzing(false);
        setView('results');
        setActiveTab('recommendations');
        showToast(`✓ Analysis complete — ${data.recommendations?.length || 0} recommendations generated`);
      },
      onError: (msg) => {
        setAgentStatuses({ pm: 'error', engineer: 'error', director: 'error', rebuttal: 'error' });
        setAnalysisError('Analysis failed. Please try again in a moment.');
        setIsAnalyzing(false);
      }
    });
  };

  // ── Roadmap ────────────────────────────────────────────────────────────────
  const handleParseRoadmap = async () => {
    setParsingRoadmap(true);
    try {
      const items = await parseRoadmap(roadmapFile, roadmapText);
      setRoadmapItems(Array.isArray(items) ? items : []);
      setRoadmapParsed(true);
      showToast(`✓ ${items.length} roadmap items parsed`);
    } catch { }
    setParsingRoadmap(false);
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const result = await evaluateRoadmap(masterThemes, roadmapItems);
      setRoadmapAnalysis(result.roadmapAnalysis || []);
      setRoadmapConflicts(result.roadmapConflicts || []);
      setStrategicGaps(result.strategicGaps || []);
      setEvaluated(true);
      setActiveTab('roadmap');
      showToast(`✓ Roadmap evaluated — ${result.roadmapConflicts?.length || 0} conflicts, ${result.strategicGaps?.length || 0} gaps`);
    } catch {}
    setEvaluating(false);
  };

  // ── Sessions ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSession({ masterThemes, probingQuestions, researchGaps, crossCuttingInsights, recommendations, engineerEstimates, directorChallenges, rebuttals, finalSummary, roadmapItems, roadmapAnalysis, roadmapConflicts, strategicGaps });
      setSaveStatus('saved'); showToast('✓ Session saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus(''), 2500); }
  };

  const handleLoadSessions = async () => {
    setView('sessions');
    try { setSessions(await getSessions()); } catch {}
  };

  const handleLoadSession = (s) => {
    setMasterThemes(s.masterThemes || []);
    setProbingQuestions(s.probingQuestions || []);
    setResearchGaps(s.researchGaps || []);
    setCrossCuttingInsights(s.crossCuttingInsights || []);
    setRecommendations(s.recommendations || []);
    setEngineerEstimates(s.engineerEstimates || []);
    setDirectorChallenges(s.directorChallenges || []);
    setRebuttals(s.rebuttals || []);
    setFinalSummary(s.finalSummary || '');
    setRoadmapItems(s.roadmapItems || []);
    setRoadmapAnalysis(s.roadmapAnalysis || []);
    setRoadmapConflicts(s.roadmapConflicts || []);
    setStrategicGaps(s.strategicGaps || []);
    setEvaluated((s.roadmapAnalysis || []).length > 0);
    setRoadmapParsed((s.roadmapItems || []).length > 0);
    setView('results'); setActiveTab('themes');
    showToast('Session loaded');
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const stepStatus = (step) => {
    if (step === 1) return documents.length > 0 ? 'completed' : view === 'documents' ? 'active' : 'idle';
    if (step === 2) return hasResults ? 'completed' : view === 'results' ? 'active' : 'idle';
    if (step === 3) return view === 'sessions' ? 'active' : 'idle';
    return 'idle';
  };

  const tabs = [
    { key: 'themes',          label: 'Themes',          count: masterThemes.length, primary: true },
    { key: 'questions',       label: 'Follow-up',       count: probingQuestions.length },
    ...(hasAnalysis ? [
      { key: 'recommendations', label: 'Recommendations', count: recommendations.length, primary: true },
      { key: 'deliberation',    label: 'Agent Review',    count: null },
    ] : []),
    ...(evaluated ? [{ key: 'roadmap', label: 'Roadmap Gaps', count: null, primary: true }] : []),
  ];

  return (
    <div className="app">
      <Toast message={toast} />
      <DeleteModal doc={deleteTarget} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />

      {/* ── Header ── */}
      <header className="header">
        <div className="logo-wrap">
          <div className="logo-icon">IE</div>
          <div>
            <div className="logo">Insight Engine</div>
            <div className="logo-sub">User Research Intelligence</div>
          </div>
        </div>

        {/* Workflow nav — shows sequence clearly */}
        <div className="workflow-nav">
          <button className={`workflow-step ${stepStatus(1) === 'completed' ? 'completed' : ''} ${view === 'documents' ? 'active' : ''}`} onClick={() => setView('documents')}>
            <span className="workflow-step-num">{stepStatus(1) === 'completed' ? '✓' : '1'}</span>
            <span>Documents</span>
          </button>
          <span className="step-divider">›</span>
          <button
            className={`workflow-step ${stepStatus(2) === 'completed' ? 'completed' : ''} ${view === 'results' ? 'active' : ''}`}
            onClick={() => hasResults && setView('results')}
            disabled={!hasResults}
            title={!hasResults ? 'Upload and synthesize documents first' : ''}
          >
            <span className="workflow-step-num">{hasResults ? (hasAnalysis ? '✓' : '2') : '2'}</span>
            <span>Analysis</span>
          </button>
          <span className="step-divider">›</span>
          <button className={`workflow-step ${view === 'sessions' ? 'active' : ''}`} onClick={handleLoadSessions}>
            <span className="workflow-step-num">3</span>
            <span>Sessions</span>
          </button>
        </div>

        <div className="header-right">
          {rising.length > 0 && <span className="badge badge-orange"><span className="pulse">↑</span> {rising.length} Rising</span>}
          {hasResults && (
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

            {/* Left — Upload + Roadmap */}
            <div className="left-col">
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Upload Feedback</span>
                </div>
                <div
                  className={`drop-zone${dragOver ? ' drag-over' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md,.png,.jpg" style={{ display: 'none' }} onChange={e => handleFiles(Array.from(e.target.files))} />
                  <div className="drop-zone-icon">{uploading ? <span className="spin">⏳</span> : '📂'}</div>
                  <div className="drop-zone-title">{uploading ? 'Processing documents...' : 'Drop files here or click to browse'}</div>
                  <div className="drop-zone-sub">Word, PDF, TXT · Multiple files supported</div>
                </div>

                {uploadProgress.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {uploadProgress.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <span>{fileIcon(f.name)}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{f.name}</span>
                        <span style={{ fontWeight: 600, color: f.status === 'done' ? 'var(--green)' : f.status === 'error' ? 'var(--red)' : 'var(--yellow)', flexShrink: 0 }}>
                          {f.status === 'processing' ? <span className="pulse">Analyzing...</span> : f.status === 'done' ? '✓ Ready' : '✗ Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roadmap — visible but collapsed by default */}
              <div className="panel">
                <div className="panel-header" style={{ marginBottom: showRoadmap ? 14 : 0 }}>
                  <span className="panel-title">Roadmap <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10, fontWeight: 600 }}>Optional</span></span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowRoadmap(s => !s)}>
                    {showRoadmap ? 'Hide' : roadmapParsed ? `✓ ${roadmapItems.length} items` : 'Add Roadmap →'}
                  </button>
                </div>
                {!showRoadmap && !roadmapParsed && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    Add your product roadmap to identify gaps and conflicts with user feedback.
                  </div>
                )}
                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div className="drop-zone" style={{ padding: 14 }} onClick={() => roadmapFileRef.current?.click()}>
                          <input ref={roadmapFileRef} type="file" accept=".docx,.pdf,.txt,.md" style={{ display: 'none' }} onChange={e => { setRoadmapFile(e.target.files[0]); setRoadmapText(''); }} />
                          {roadmapFile ? <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>✓ {roadmapFile.name}</div> : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Upload roadmap file</div>}
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', margin: '8px 0' }}>or paste text below</div>
                        <textarea value={roadmapText} onChange={e => { setRoadmapText(e.target.value); setRoadmapFile(null); }} placeholder={'Q3 Roadmap\n- Self-serve campaign builder\n- Real-time attribution...'} style={{ minHeight: 80, fontSize: 12 }} />
                        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={handleParseRoadmap} disabled={parsingRoadmap || (!roadmapFile && !roadmapText.trim())}>
                          {parsingRoadmap ? <><span className="spin">⚙</span> Parsing...</> : 'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
                          {roadmapItems.map(r => {
                            const ev = roadmapAnalysis.find(a => a.roadmapItemId === r.id);
                            return (
                              <div key={r.id} style={{ padding: '5px 8px', marginBottom: 3, background: 'var(--surface-2)', borderRadius: 5, border: '1px solid var(--border)', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{r.item}</span>
                                {ev && <Badge type={ev.coverage} map={COVERAGE_BADGE} />}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {hasResults && (
                            <button className="btn btn-purple" style={{ flex: 1 }} onClick={handleEvaluate} disabled={evaluating}>
                              {evaluating ? <><span className="spin">⚙</span> Evaluating...</> : evaluated ? '↻ Re-evaluate' : '🗺 Evaluate vs Themes'}
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => { setRoadmapParsed(false); setRoadmapItems([]); setEvaluated(false); }}>Change</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Progress */}
              {(isSynthesizing || Object.keys(agentStatuses).length > 0) && (
                <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} isSynthesizing={isSynthesizing} synthMessage={SYNTH_MESSAGES[synthMsgIdx]} elapsed={synthElapsed} />
              )}

              {synthError && (
                <div style={{ padding: '10px 14px', background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--red)' }}>
                  ✗ {synthError}
                </div>
              )}
            </div>

            {/* Right — Document library */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {documents.length > 0 ? `${documents.length} Document${documents.length !== 1 ? 's' : ''} in Library` : 'Document Library'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>
                    Each file is analyzed individually, then the Master Researcher synthesizes across all sources
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleSynthesize} disabled={isSynthesizing || documents.length === 0}>
                  {isSynthesizing ? <><span className="spin">⚙</span> Synthesizing...</> : '🔬 Synthesize Themes'}
                </button>
              </div>

              {docsLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading documents...</div>}

              {!docsLoading && documents.length === 0 && (
                <div className="empty">
                  <div className="empty-icon">📋</div>
                  <div className="empty-title">No documents yet</div>
                  <div className="empty-sub">Upload Word docs, PDFs, or text files containing user interviews, survey responses, or support tickets. Each document is analyzed individually before synthesis.</div>
                </div>
              )}

              {documents.map(doc => (
                <div key={doc.id} className="doc-item">
                  <div className="doc-icon">{fileIcon(doc.name)}</div>
                  <div className="doc-info">
                    <div className="doc-name" title={doc.name}>{doc.name}</div>
                    <div className="doc-meta">
                      Uploaded {new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length || 0} themes extracted
                      {doc.key_source && ` · ${doc.key_source}`}
                    </div>
                    {doc.document_summary && <div className="doc-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id] && (doc.themes || []).map(t => (
                      <div key={t.id} className="doc-theme-preview">
                        <strong>{t.title}</strong> — {t.description}
                      </div>
                    ))}
                  </div>
                  <div className="doc-actions">
                    <button className="btn-icon" title={expandedDocs[doc.id] ? 'Collapse themes' : 'Show themes'} onClick={() => setExpandedDocs(p => ({ ...p, [doc.id]: !p[doc.id] }))}>
                      {expandedDocs[doc.id] ? '▲' : '▼'}
                    </button>
                    <button className="btn-icon danger" title="Remove document" onClick={() => setDeleteTarget(doc)}>✕</button>
                  </div>
                </div>
              ))}

              {hasResults && !isAnalyzing && !hasAnalysis && (
                <div className="ready-banner">
                  <div>
                    <div className="ready-banner-text">✓ {masterThemes.length} themes synthesized — ready for full analysis</div>
                    <div className="ready-banner-sub">Run the PM → Engineer → Director → Rebuttal pipeline on your themes</div>
                  </div>
                  <button className="btn btn-primary" onClick={() => { setView('results'); handleRunAnalysis(); }}>
                    Run Full Analysis →
                  </button>
                </div>
              )}

              {isAnalyzing && (
                <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} isSynthesizing={false} synthMessage="" elapsed={0} />
              )}
              {analysisError && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13, padding: '8px 12px', background: 'var(--red-light)', borderRadius: 'var(--radius)' }}>{analysisError}</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Results View ── */}
      {view === 'results' && (
        <div className="page fade-in">
          {evaluated && (
            <div className="eval-banner">
              <div>
                <div className="eval-banner-text">✓ Roadmap evaluation complete</div>
                <div className="eval-banner-sub">{roadmapConflicts.length} conflict{roadmapConflicts.length !== 1 ? 's' : ''} · {strategicGaps.length} strategic gap{strategicGaps.length !== 1 ? 's' : ''} identified</div>
              </div>
              <button className="btn btn-purple btn-sm" onClick={() => setActiveTab('roadmap')}>View Gaps →</button>
            </div>
          )}

          {!hasAnalysis && !isAnalyzing && hasResults && (
            <div className="ready-banner" style={{ marginBottom: 20 }}>
              <div>
                <div className="ready-banner-text">Themes ready — run the full agent analysis</div>
                <div className="ready-banner-sub">PM · Engineer · Director · PM Rebuttal</div>
              </div>
              <button className="btn btn-primary" onClick={handleRunAnalysis}>Run Full Analysis →</button>
            </div>
          )}

          {isAnalyzing && (
            <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} isSynthesizing={false} synthMessage="" elapsed={0} />
          )}

          <div className="tab-bar">
            {tabs.map(t => (
              <button key={t.key} className={`tab-btn${t.primary ? ' primary-tab' : ''}${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
                {t.label}
                {t.count != null && t.count > 0 && <span className="tab-count">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* ── Themes ── */}
          {activeTab === 'themes' && (
            <div>
              {crossCuttingInsights.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div className="section-title">Cross-Cutting Insights</div>
                  {crossCuttingInsights.map((ins, i) => (
                    <div key={i} className="insight-bar">
                      <span style={{ flexShrink: 0 }}>💡</span>
                      <span>{ins}</span>
                    </div>
                  ))}
                </div>
              )}

              {masterThemes.map(t => {
                const sent = SENTIMENT_BADGE[t.sentiment] || { cls: 'badge-gray', label: t.sentiment };
                const strengthColor = t.strength >= 7 ? '#f59e0b' : t.strength >= 5 ? 'var(--blue)' : 'var(--border-strong)';
                return (
                  <div key={t.id} className={`card theme-card${t.strength >= 7 ? ' rising' : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', flex: 1, lineHeight: 1.4 }}>{t.title}</div>
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {t.isNew && <span className="badge badge-blue">New</span>}
                        {t.strength >= 7 && <span className="badge badge-orange"><span className="pulse">↑</span> Rising</span>}
                        <span className={`badge ${sent.cls}`}>{sent.label}</span>
                        {t.frequency && <span className="badge badge-gray">{t.frequency} sources</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>{t.description}</div>
                    {t.sourceDocuments?.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>From: {t.sourceDocuments.join(' · ')}</div>
                    )}
                    {(t.quotes || []).map((q, i) => <div key={i} className="theme-quote">"{q}"</div>)}
                    {t.ambiguities?.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 6 }}>⚠ Still unclear: {t.ambiguities.join(' · ')}</div>
                    )}
                    <div className="theme-strength-bar">
                      <div className="theme-strength-fill" style={{ width: `${t.strength * 10}%`, background: strengthColor }} />
                    </div>
                    <div className="theme-strength-label">
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Signal Strength</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: strengthColor }}>{t.strength}/10</span>
                    </div>
                  </div>
                );
              })}

              {researchGaps.length > 0 && (
                <div className="gap-card">
                  <div className="gap-title">⚠ Research Gaps</div>
                  {researchGaps.map((g, i) => <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 3 }}>· {g}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ── Questions ── */}
          {activeTab === 'questions' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                Ask these in your next research session to close gaps in understanding and strengthen weak signals.
              </p>
              {probingQuestions.map((q, i) => (
                <div key={i} className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--border-strong)', flexShrink: 0, lineHeight: 1, fontFamily: 'Georgia, serif' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, paddingTop: 3 }}>{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Recommendations ── */}
          {activeTab === 'recommendations' && (
            <div>
              {recommendations.map(r => {
                const ps = PLACEMENT_BADGE[r.roadmapPlacement] || PLACEMENT_BADGE.later;
                const eng = engineerEstimates.find(e => e.recommendationId === r.id);
                const challenges = directorChallenges.filter(c => c.recommendationId === r.id);
                const rebuttal = rebuttals.find(rb => rb.recommendationId === r.id);
                return (
                  <div key={r.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', flex: 1, lineHeight: 1.4 }}>{r.title}</div>
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                        <span className={`badge ${ps.cls}`}>{ps.label}</span>
                        {eng && <span className={`badge ${EFFORT_BADGE[eng.effort] || 'badge-gray'}`}>{eng.effort}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>{r.rationale}</div>
                    <div className="score-grid">
                      <ScoreBar label="User Value" value={r.userValue} color="var(--blue)" />
                      <ScoreBar label="Strategic Fit" value={r.strategicFit} color="var(--purple)" />
                      <ScoreBar label="Confidence" value={r.confidenceScore} color="#0891b2" />
                    </div>
                    {eng && (
                      <div className="eng-block">
                        <div className="eng-row">
                          <span><strong>Effort:</strong> {eng.effortWeeks}</span>
                          <span><strong>Complexity:</strong> {eng.complexity}</span>
                        </div>
                        {eng.incrementalPath && <div className="eng-path">→ {eng.incrementalPath}</div>}
                        {(eng.redFlags || []).map((f, i) => <div key={i} className="eng-flag">⚑ <span>{f}</span></div>)}
                      </div>
                    )}
                    {challenges.length > 0 && challenges.map((c, i) => (
                      <div key={i} className="challenge-block">
                        <div className="challenge-header">
                          <Badge type={c.severity} map={SEVERITY_BADGE} />
                          <span className="badge badge-gray">{c.type}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#92400e' }}>{c.challenge}</div>
                      </div>
                    ))}
                    {rebuttal && (
                      <div className="rebuttal-block">
                        <Badge type={rebuttal.stance} map={STANCE_BADGE} />
                        <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 6, lineHeight: 1.6 }}>{rebuttal.response}</div>
                        {rebuttal.revisedRecommendation && <div style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 4, fontStyle: 'italic' }}>→ Revised: {rebuttal.revisedRecommendation}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Deliberation ── */}
          {activeTab === 'deliberation' && (
            <div>
              {finalSummary && (
                <div className="card" style={{ background: 'var(--green-light)', borderColor: 'var(--green-mid)', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 8, fontSize: 13 }}>PM Final Statement</div>
                  <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.7 }}>{finalSummary}</div>
                </div>
              )}
              <div className="section-title">Director Challenges & PM Responses</div>
              {directorChallenges.map((c, i) => {
                const rb = rebuttals.find(r => r.challengeIndex === i);
                return (
                  <div key={i} className="card">
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Badge type={c.severity} map={SEVERITY_BADGE} />
                      <span className="badge badge-gray">{c.type}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 8 }}>{c.challenge}</div>
                    {rb && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <Badge type={rb.stance} map={STANCE_BADGE} />
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6 }}>{rb.response}</div>
                        {rb.revisedRecommendation && <div style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 4, fontStyle: 'italic' }}>→ {rb.revisedRecommendation}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Roadmap eval ── */}
          {activeTab === 'roadmap' && evaluated && (
            <div>
              {strategicGaps.length > 0 && (
                <>
                  <div className="section-title">Strategic Gaps — Not on your roadmap</div>
                  {strategicGaps.map((g, i) => (
                    <div key={i} className="card opportunity">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>◈ {g.title}</div>
                        <span className={`badge ${g.urgency === 'high' ? 'badge-red' : g.urgency === 'medium' ? 'badge-yellow' : 'badge-gray'}`}>{g.urgency} urgency</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{g.evidence}</div>
                    </div>
                  ))}
                  <div className="divider" />
                </>
              )}
              {roadmapConflicts.length > 0 && (
                <>
                  <div className="section-title">Roadmap Conflicts</div>
                  {roadmapConflicts.map((c, i) => {
                    const item = roadmapItems.find(r => r.id === c.roadmapItemId);
                    return (
                      <div key={i} className="card gap">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item?.item || `Item ${c.roadmapItemId}`}</div>
                          <span className="badge badge-red">{c.recommendation}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{c.issue}</div>
                      </div>
                    );
                  })}
                  <div className="divider" />
                </>
              )}
              <div className="section-title">Item-by-Item Coverage</div>
              {roadmapItems.map(r => {
                const ev = roadmapAnalysis.find(a => a.roadmapItemId === r.id);
                return (
                  <div key={r.id} className="card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.item}</div>
                      {ev?.rationale && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{ev.rationale}</div>}
                    </div>
                    {ev && <Badge type={ev.coverage} map={COVERAGE_BADGE} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sessions View ── */}
      {view === 'sessions' && (
        <div className="page fade-in" style={{ maxWidth: 800 }}>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text-primary)', marginBottom: 4 }}>Saved Sessions</div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>Load a previous analysis to continue building on it, or review past findings.</div>
          {sessions.length === 0 && (
            <div className="empty">
              <div className="empty-icon">💾</div>
              <div className="empty-title">No saved sessions yet</div>
              <div className="empty-sub">Run an analysis and hit Save Session to store your work here for future reference.</div>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="session-card">
              <div>
                <div className="session-date">{new Date(s.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                <div className="session-meta">{s.masterThemes?.length || 0} themes · {s.recommendations?.length || 0} recommendations{s.roadmapAnalysis?.length > 0 ? ' · Roadmap evaluated' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => handleLoadSession(s)}>Load Session</button>
                <button className="btn-danger-ghost" onClick={() => deleteSession(s.id).then(() => setSessions(ss => ss.filter(x => x.id !== s.id)))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
