import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  synthesizeThemes, runAnalysis,
  chatFinance, recalculateFinance,
  parseRoadmap, saveSession, getSessions, deleteSession
} from './api';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const SYNTH_MSGS = [
  'Loading documents...', 'Reading each document...', 'Extracting customer problems...',
  'Evaluating positioning...', 'Synthesizing across all sources...', 'Almost done...',
];

const ANALYSIS_STEPS = [
  'PM forming recommendations...', 'Engineer estimating effort...',
  'Finance Analyst modeling impact...', 'GTM Specialist planning launch...',
  'Director reviewing the plan...', 'PM defending recommendations...',
];

const PRIORITY_STYLE = {
  P0:  { cls: 'p0',   label: 'P0' },
  P1:  { cls: 'p1',   label: 'P1' },
  P2:  { cls: 'p2',   label: 'P2' },
  Cut: { cls: 'pcut', label: 'Cut' },
};

const SIZE_BADGE = { large: { cls: 'b-red', label: 'Large Problem' }, medium: { cls: 'b-yellow', label: 'Medium Problem' }, small: { cls: 'b-gray', label: 'Small Problem' } };
const POS_BADGE = { yes: { cls: 'b-green', label: '✓ Uniquely Positioned' }, partially: { cls: 'b-yellow', label: '~ Partially Positioned' }, no: { cls: 'b-gray', label: '✗ Not Differentiated' } };
const CERT_BADGE = { high: { cls: 'b-green', label: 'High Certainty' }, medium: { cls: 'b-yellow', label: 'Medium Certainty' }, low: { cls: 'b-red', label: 'Low Certainty' } };
const TYPE_BADGE = { revenue: { cls: 'b-green', label: '💰 Revenue' }, adoption: { cls: 'b-blue', label: '📈 New Advertisers' }, efficiency: { cls: 'b-purple', label: '⚡ Efficiency' }, foundation: { cls: 'b-gray', label: '🏗 Foundation' } };
const STANCE_BADGE = { defend: { cls: 'b-green', label: '✓ Defended' }, revise: { cls: 'b-yellow', label: '↻ Revised' }, concede: { cls: 'b-red', label: '✗ Conceded' } };
const COMPLEXITY_LABEL = { low: { cls: 'b-green', label: 'Low Complexity' }, medium: { cls: 'b-yellow', label: 'Medium Complexity' }, high: { cls: 'b-orange', label: 'High Complexity' }, 'very-high': { cls: 'b-red', label: 'Very High Complexity' } };

function Badge({ cls, label }) { return <span className={`badge ${cls}`}>{label}</span>; }
function fileIcon(n = '') { const e = (n.split('.').pop() || '').toLowerCase(); return ['docx','doc'].includes(e) ? '📄' : e === 'pdf' ? '📕' : '📃'; }
function Toast({ msg }) { return msg ? <div className="toast">{msg}</div> : null; }
function DeleteModal({ doc, onConfirm, onCancel }) {
  if (!doc) return null;
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Remove document?</div>
        <div className="modal-body">"{doc.name}" will be removed and excluded from future synthesis.</div>
        <div className="modal-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ── Finance Model Component ───────────────────────────────────────────────────
function FinanceModel({ recommendation }) {
  const model = recommendation?.fin;
  const [assumptions, setAssumptions] = useState(model?.assumptions || []);
  const [headline, setHeadline] = useState(model?.headline || '');
  const [calcLogic, setCalcLogic] = useState(model?.calculationLogic || '');
  const [recalculating, setRecalculating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `I've modeled the financial impact for **${recommendation?.title}**. Current estimate: ${model?.headline || 'pending'}. Edit any assumption above and recalculate, or ask me a question about the model.` }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const msgsEndRef = useRef(null);

  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const result = await recalculateFinance(recommendation, assumptions);
      if (result.headline) setHeadline(result.headline);
      if (result.calculationLogic) setCalcLogic(result.calculationLogic);
    } catch {}
    setRecalculating(false);
  };

  const updateAssumption = (id, val) => {
    setAssumptions(prev => prev.map(a => a.id === id ? { ...a, value: val } : a));
  };

  const addAssumption = () => {
    if (!newLabel.trim() || !newValue.trim()) return;
    setAssumptions(prev => [...prev, { id: `custom-${Date.now()}`, label: newLabel, value: newValue, editable: true, confidence: 'medium' }]);
    setNewLabel(''); setNewValue('');
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: 'user', content: chatInput };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs); setChatInput(''); setChatLoading(true);
    try {
      const { response } = await chatFinance(newMsgs, recommendation, { ...model, assumptions, headline });
      setMessages(m => [...m, { role: 'assistant', content: response }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    }
    setChatLoading(false);
  };

  if (!model) return <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>No financial model available for this recommendation.</div>;

  return (
    <div>
      {/* Impact headline */}
      <div className="impact-banner" style={{ marginBottom: 14 }}>
        <div className="impact-number">{headline}</div>
        <div className="impact-label">{model.projectType === 'revenue' ? 'Projected Ad Revenue Impact' : 'Projected New Advertisers'}</div>
        {model.upside && <div className="impact-range">↑ {model.upside} · ↓ {model.downside}</div>}
      </div>

      {/* Calculation logic */}
      {calcLogic && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 'var(--r)', marginBottom: 12, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-1)' }}>How we got there:</strong> {calcLogic}
        </div>
      )}

      {/* Editable assumptions */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-hd" style={{ margin: 0 }}>Assumptions</div>
          <button className="btn btn-primary btn-xs" onClick={handleRecalculate} disabled={recalculating}>
            {recalculating ? <><span className="spin">⚙</span> Recalculating...</> : '↻ Recalculate'}
          </button>
        </div>
        {assumptions.map(a => (
          <div key={a.id} className="assumption-row">
            <span className="assumption-label">{a.label}</span>
            <Badge cls={a.confidence === 'high' ? 'b-green' : a.confidence === 'medium' ? 'b-yellow' : 'b-red'} label={a.confidence} />
            <input
              className="assumption-input"
              value={a.value}
              onChange={e => updateAssumption(a.id, e.target.value)}
              disabled={a.editable === false}
            />
          </div>
        ))}
        {/* Add new assumption */}
        <div className="add-assumption-row">
          <input className="assumption-input" style={{ flex: 1, width: 'auto', textAlign: 'left' }} placeholder="New assumption name" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
          <input className="assumption-input" style={{ width: 120 }} placeholder="Value" value={newValue} onChange={e => setNewValue(e.target.value)} />
          <button className="btn btn-secondary btn-xs" onClick={addAssumption} disabled={!newLabel.trim() || !newValue.trim()}>+ Add</button>
        </div>
      </div>

      {/* Chat */}
      <div className="section-hd">Discuss with Finance Analyst</div>
      <div className="chat-wrap">
        <div className="chat-msgs">
          {messages.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>)}
          {chatLoading && <div className="chat-msg assistant"><span className="pulse">Thinking...</span></div>}
          <div ref={msgsEndRef} />
        </div>
        <div className="chat-input-row">
          <textarea className="chat-input" rows={2} value={chatInput} onChange={e => setChatInput(e.target.value)}
            placeholder="Ask about assumptions, scenarios, or provide better data..."
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
          />
          <button className="btn btn-primary btn-sm" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('documents');

  // Docs
  const [documents, setDocuments]       = useState([]);
  const [uploading, setUploading]       = useState(false);
  const [uploadStatus, setUploadStatus] = useState([]);
  const [dragOver, setDragOver]         = useState(false);
  const [docsLoading, setDocsLoading]   = useState(false);
  const [expandedDocs, setExpandedDocs] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Synth
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthMsgIdx, setSynthMsgIdx]   = useState(0);
  const [synthElapsed, setSynthElapsed] = useState(0);
  const [synthError, setSynthError]     = useState('');
  const [themes, setThemes]             = useState([]);
  const [questions, setQuestions]       = useState([]);
  const [researchGaps, setResearchGaps] = useState([]);

  // Analysis
  const [analyzing, setAnalyzing]       = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [directorChallenges, setDirectorChallenges] = useState([]);
  const [rebuttals, setRebuttals]       = useState([]);
  const [finalSummary, setFinalSummary] = useState('');
  const [roadmapConflicts, setRoadmapConflicts] = useState([]);
  const [strategicGaps, setStrategicGaps] = useState([]);

  // Roadmap
  const [showRoadmap, setShowRoadmap]   = useState(false);
  const [roadmapText, setRoadmapText]   = useState('');
  const [roadmapFile, setRoadmapFile]   = useState(null);
  const [roadmapItems, setRoadmapItems] = useState([]);
  const [roadmapParsed, setRoadmapParsed] = useState(false);
  const [parsingRoadmap, setParsingRoadmap] = useState(false);

  // UI
  const [activeTab, setActiveTab]       = useState('themes');
  const [toast, setToast]               = useState('');
  const [saveStatus, setSaveStatus]     = useState('');
  const [sessions, setSessions]         = useState([]);
  const [expandedChallenges, setExpandedChallenges] = useState({});
  const [activeModelRec, setActiveModelRec] = useState(null);

  const fileRef = useRef(null);
  const roadmapRef = useRef(null);
  const synthInt = useRef(null);
  const elapsedInt = useRef(null);
  const stepInt = useRef(null);

  const hasThemes = themes.length > 0;
  const hasAnalysis = recommendations.length > 0;
  const rising = themes.filter(t => t.strength >= 7);

  useEffect(() => { loadDocs(); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const loadDocs = async () => { setDocsLoading(true); try { setDocuments(await getDocuments()); } catch {} setDocsLoading(false); };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    if (!files.length) return;
    setUploading(true);
    setUploadStatus(files.map(f => ({ name: f.name, status: 'processing' })));
    try {
      const results = await uploadFiles(files);
      setUploadStatus(results.map(r => ({ name: r.name, status: r.error ? 'error' : 'done' })));
      await loadDocs();
      setTimeout(() => setUploadStatus([]), 4000);
      const ok = results.filter(r => !r.error).length;
      if (ok) showToast(`✓ ${ok} document${ok > 1 ? 's' : ''} uploaded`);
    } catch { setUploadStatus(files.map(f => ({ name: f.name, status: 'error' }))); }
    setUploading(false);
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDocument(deleteTarget.id); setDocuments(d => d.filter(x => x.id !== deleteTarget.id)); showToast('Removed'); } catch {}
    setDeleteTarget(null);
  };

  // ── Synthesize ─────────────────────────────────────────────────────────────
  const handleSynthesize = async () => {
    setSynthesizing(true); setSynthError(''); setSynthMsgIdx(0); setSynthElapsed(0);
    synthInt.current = setInterval(() => setSynthMsgIdx(i => Math.min(i + 1, SYNTH_MSGS.length - 1)), 4000);
    elapsedInt.current = setInterval(() => setSynthElapsed(s => s + 1), 1000);
    try {
      const data = await synthesizeThemes();
      clearInterval(synthInt.current); clearInterval(elapsedInt.current);
      setThemes(data.themes || []); setQuestions(data.probingQuestions || []); setResearchGaps(data.researchGaps || []);
      setSynthesizing(false); setView('results'); setActiveTab('themes');
      showToast(`✓ ${data.themes?.length || 0} themes synthesized`);
    } catch (e) {
      clearInterval(synthInt.current); clearInterval(elapsedInt.current);
      setSynthError(e.message?.includes('No documents') ? 'Upload documents first.' : 'Synthesis failed. Try again.');
      setSynthesizing(false);
    }
  };

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!themes.length) return;
    setAnalyzing(true); setAnalysisError('');
    let idx = 0; setAnalysisStep(ANALYSIS_STEPS[0]);
    stepInt.current = setInterval(() => { idx = Math.min(idx + 1, ANALYSIS_STEPS.length - 1); setAnalysisStep(ANALYSIS_STEPS[idx]); }, 18000);
    try {
      const data = await runAnalysis(themes, roadmapItems);
      clearInterval(stepInt.current);
      setRecommendations(data.recommendations || []);
      setDirectorChallenges(data.directorChallenges || []);
      setRebuttals(data.rebuttals || []);
      setFinalSummary(data.finalSummary || '');
      setRoadmapConflicts(data.roadmapConflicts || []);
      setStrategicGaps(data.strategicGaps || []);
      setAnalyzing(false); setActiveTab('recommendations');
      showToast(`✓ ${data.recommendations?.length || 0} recommendations generated`);
    } catch (e) {
      clearInterval(stepInt.current);
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
      await saveSession({ themes, questions, researchGaps, recommendations, directorChallenges, rebuttals, finalSummary, roadmapItems, roadmapConflicts, strategicGaps });
      setSaveStatus('saved'); showToast('✓ Session saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus(''), 2500); }
  };

  const loadSessions = async () => { setView('sessions'); try { setSessions(await getSessions()); } catch {}};

  const loadSession = (s) => {
    setThemes(s.themes || []); setQuestions(s.questions || []); setResearchGaps(s.researchGaps || []);
    setRecommendations(s.recommendations || []); setDirectorChallenges(s.directorChallenges || []);
    setRebuttals(s.rebuttals || []); setFinalSummary(s.finalSummary || '');
    setRoadmapItems(s.roadmapItems || []); setRoadmapConflicts(s.roadmapConflicts || []); setStrategicGaps(s.strategicGaps || []);
    setRoadmapParsed((s.roadmapItems || []).length > 0);
    setView('results'); setActiveTab('themes'); showToast('Session loaded');
  };

  const stepDone = (n) => n === 1 ? documents.length > 0 : n === 2 ? hasThemes : false;

  const tabs = [
    { key: 'themes', label: 'Themes', count: themes.length },
    { key: 'questions', label: 'Follow-up', count: questions.length },
    ...(hasAnalysis ? [
      { key: 'recommendations', label: 'Recommendations', count: recommendations.length },
      { key: 'modeling', label: 'Financial Model', count: null },
      { key: 'review', label: 'Agent Review', count: null },
      ...(roadmapConflicts.length > 0 || strategicGaps.length > 0 ? [{ key: 'roadmap', label: 'Roadmap', count: null }] : []),
    ] : []),
  ];

  return (
    <div className="app">
      <Toast msg={toast} />
      <DeleteModal doc={deleteTarget} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />

      {/* Header */}
      <header className="header">
        <div className="logo-wrap">
          <div className="logo-mark">IE</div>
          <div><div className="logo-text">Insight Engine</div><div className="logo-sub">User Research Intelligence</div></div>
        </div>
        <div className="stepper">
          <button className={`step-btn ${view === 'documents' ? 'active' : ''} ${stepDone(1) ? 'done' : ''}`} onClick={() => setView('documents')}>
            <span className="step-num">{stepDone(1) ? '✓' : '1'}</span><span>Documents</span>
          </button>
          <span className="step-arrow">›</span>
          <button className={`step-btn ${view === 'results' ? 'active' : ''} ${stepDone(2) ? 'done' : ''}`} onClick={() => hasThemes && setView('results')} disabled={!hasThemes}>
            <span className="step-num">{hasAnalysis ? '✓' : '2'}</span><span>Analysis</span>
          </button>
          <span className="step-arrow">›</span>
          <button className={`step-btn ${view === 'sessions' ? 'active' : ''}`} onClick={loadSessions}>
            <span className="step-num">3</span><span>Sessions</span>
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

      {/* Documents */}
      {view === 'documents' && (
        <div className="page fade-in">
          <div className="two-col">
            <div className="sidebar">
              <div className="panel">
                <div className="panel-hd"><span className="panel-title">Upload Feedback</span></div>
                <div className={`drop-zone${dragOver ? ' over' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md" style={{ display: 'none' }} onChange={e => handleFiles(Array.from(e.target.files))} />
                  <div className="dz-icon">{uploading ? <span className="spin">⏳</span> : '📂'}</div>
                  <div className="dz-title">{uploading ? 'Processing...' : 'Drop files or click to browse'}</div>
                  <div className="dz-sub">Word, PDF, TXT · Multiple files</div>
                </div>
                {uploadStatus.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--border)', marginTop: i === 0 ? 8 : 0 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{f.name}</span>
                    <span style={{ fontWeight: 600, color: f.status === 'done' ? 'var(--green)' : f.status === 'error' ? 'var(--red)' : 'var(--yellow)', flexShrink: 0, fontSize: 11 }}>
                      {f.status === 'processing' ? <span className="pulse">Analyzing...</span> : f.status === 'done' ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Roadmap */}
              <div className="panel">
                <div className="panel-hd" style={{ marginBottom: showRoadmap ? 12 : 0 }}>
                  <span className="panel-title">Roadmap <Badge cls="b-gray" label="Optional" /></span>
                  <button className="btn btn-secondary btn-xs" onClick={() => setShowRoadmap(s => !s)}>
                    {showRoadmap ? 'Hide' : roadmapParsed ? `✓ ${roadmapItems.length} items` : 'Add →'}
                  </button>
                </div>
                {!showRoadmap && !roadmapParsed && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Add your roadmap to identify gaps and conflicts.</div>}
                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div className="drop-zone" style={{ padding: 12 }} onClick={() => roadmapRef.current?.click()}>
                          <input ref={roadmapRef} type="file" accept=".docx,.pdf,.txt,.md" style={{ display: 'none' }} onChange={e => { setRoadmapFile(e.target.files[0]); setRoadmapText(''); }} />
                          <div style={{ fontSize: 13, color: roadmapFile ? 'var(--green)' : 'var(--text-2)', fontWeight: 600 }}>{roadmapFile ? `✓ ${roadmapFile.name}` : 'Upload file'}</div>
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', margin: '6px 0' }}>or paste text</div>
                        <textarea value={roadmapText} onChange={e => { setRoadmapText(e.target.value); setRoadmapFile(null); }} placeholder="Q3 Roadmap&#10;- Feature A&#10;- Feature B" style={{ minHeight: 70, fontSize: 12 }} />
                        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={handleParseRoadmap} disabled={parsingRoadmap || (!roadmapFile && !roadmapText.trim())}>
                          {parsingRoadmap ? <><span className="spin">⚙</span> Parsing...</> : 'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
                          {roadmapItems.map(r => (
                            <div key={r.id} style={{ padding: '4px 8px', marginBottom: 3, background: 'var(--surface-2)', borderRadius: 5, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-2)' }}>{r.item}</div>
                          ))}
                        </div>
                        <button className="btn btn-secondary btn-xs" onClick={() => { setRoadmapParsed(false); setRoadmapItems([]); }}>Change</button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {synthesizing && (
                <div className="progress-box fade-in">
                  <div className="progress-hd"><span className="spin">⚙</span> Synthesizing</div>
                  <div className="progress-msg">{SYNTH_MSGS[synthMsgIdx]}</div>
                  <div className="progress-elapsed">{synthElapsed}s elapsed</div>
                </div>
              )}
              {analyzing && (
                <div className="progress-box fade-in">
                  <div className="progress-hd"><span className="spin">⚙</span> Running Analysis</div>
                  <div className="progress-msg">{analysisStep}</div>
                  <div className="progress-elapsed">6 agents · typically 2-4 minutes</div>
                </div>
              )}
              {synthError && <div style={{ padding: '10px 12px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--red)' }}>✗ {synthError}</div>}
              {analysisError && <div style={{ padding: '10px 12px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--red)' }}>✗ {analysisError}</div>}
            </div>

            {/* Doc library */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{documents.length} Document{documents.length !== 1 ? 's' : ''}</div>
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
                  <div className="empty-sub">Upload interview transcripts, survey responses, or support tickets to get started.</div>
                </div>
              )}
              {documents.map(doc => (
                <div key={doc.id} className="doc-row">
                  <div className="doc-icon">{fileIcon(doc.name)}</div>
                  <div className="doc-body">
                    <div className="doc-name">{doc.name}</div>
                    <div className="doc-meta">{new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length || 0} themes · {doc.key_source || '—'}</div>
                    {doc.document_summary && <div className="doc-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id] && (doc.themes || []).map(t => (
                      <div key={t.id} className="doc-theme-item"><strong>{t.customerProblem || t.id}</strong></div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button className="btn-icon" onClick={() => setExpandedDocs(p => ({ ...p, [doc.id]: !p[doc.id] }))}>{expandedDocs[doc.id] ? '▲' : '▼'}</button>
                    <button className="btn-icon red" onClick={() => setDeleteTarget(doc)}>✕</button>
                  </div>
                </div>
              ))}
              {hasThemes && !analyzing && !hasAnalysis && (
                <div className="info-banner banner-blue" style={{ marginTop: 14 }}>
                  <div>
                    <div className="banner-title">✓ {themes.length} themes ready</div>
                    <div className="banner-sub">Run the 6-agent analysis to generate recommendations</div>
                  </div>
                  <button className="btn btn-primary" onClick={() => { setView('results'); handleAnalyze(); }}>Run Analysis →</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {view === 'results' && (
        <div className="page fade-in">
          {analyzing && (
            <div className="info-banner banner-blue" style={{ marginBottom: 16 }}>
              <div><div className="banner-title"><span className="spin">⚙</span> {analysisStep}</div><div className="banner-sub">6 agents · 2-4 minutes</div></div>
            </div>
          )}
          {!hasAnalysis && !analyzing && hasThemes && (
            <div className="info-banner banner-blue" style={{ marginBottom: 16 }}>
              <div><div className="banner-title">Themes ready — run the full analysis</div><div className="banner-sub">PM · Engineer · Finance · GTM · Director · Rebuttal</div></div>
              <button className="btn btn-primary" onClick={handleAnalyze}>Run Analysis →</button>
            </div>
          )}

          <div className="tabs">
            {tabs.map(t => (
              <button key={t.key} className={`tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
                {t.label}{t.count != null && t.count > 0 && <span className="tab-ct">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Themes */}
          {activeTab === 'themes' && (
            <div>
              {themes.map(t => {
                const sB = SIZE_BADGE[t.problemSize] || SIZE_BADGE.medium;
                const pB = POS_BADGE[t.amazonPositioned] || POS_BADGE.partially;
                const cB = CERT_BADGE[t.certainty] || CERT_BADGE.medium;
                const sc = t.strength >= 7 ? '#f59e0b' : t.strength >= 5 ? 'var(--blue)' : 'var(--border-strong)';
                return (
                  <div key={t.id} className="theme-card">
                    <div className="theme-header">
                      <div className="theme-problem">{t.customerProblem}</div>
                      <div className="theme-tags">
                        <Badge cls={sB.cls} label={sB.label} />
                        <Badge cls={pB.cls} label={pB.label} />
                      </div>
                    </div>
                    <div className="theme-grid">
                      <div className="tc">
                        <div className="tc-label">Problem Detail</div>
                        <div className="tc-val">{t.description}</div>
                      </div>
                      <div className="tc">
                        <div className="tc-label">Amazon Uniquely Positioned?</div>
                        <div className="tc-val">{t.amazonPositioned === 'yes' ? 'Yes' : t.amazonPositioned === 'partially' ? 'Partially' : 'No'}</div>
                        <div className="tc-sub">{t.amazonPositionedRationale}</div>
                      </div>
                      <div className="tc">
                        <div className="tc-label">Sources</div>
                        <div className="tc-val">{t.sourceCount || '—'} total</div>
                        <div className="tc-sub">{t.sourceMix}</div>
                      </div>
                      <div className="tc">
                        <div className="tc-label">Certainty</div>
                        <div style={{ marginBottom: 4 }}><Badge cls={cB.cls} label={cB.label} /></div>
                        {t.followUpNeeded ? <div className="tc-sub" style={{ color: 'var(--yellow)' }}>⚠ {t.followUpNeeded}</div> : <div className="tc-sub" style={{ color: 'var(--green)' }}>✓ Well understood</div>}
                      </div>
                    </div>
                    {(t.quotes || []).slice(0, 1).map((q, i) => (
                      <div key={i} className="tc-full"><div className="quote-block">"{q}"</div></div>
                    ))}
                    <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Signal Strength</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: sc }}>{t.strength}/10</span>
                    </div>
                    <div style={{ padding: '0 16px 12px' }}>
                      <div className="strength-bar"><div className="strength-fill" style={{ width: `${t.strength * 10}%`, background: sc }} /></div>
                    </div>
                  </div>
                );
              })}
              {researchGaps.length > 0 && (
                <div style={{ padding: '12px 14px', background: 'var(--yellow-bg)', border: '1px solid #fde68a', borderRadius: 'var(--r)' }}>
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6, fontSize: 13 }}>⚠ Research Gaps</div>
                  {researchGaps.map((g, i) => <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 2 }}>· {g}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Questions */}
          {activeTab === 'questions' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.6 }}>Ask these in your next research session to close gaps and strengthen weak signals.</p>
              {questions.map((q, i) => (
                <div key={i} className="theme-card" style={{ padding: 0 }}>
                  <div style={{ padding: '14px 16px', display: 'flex', gap: 14 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--border-strong)', flexShrink: 0, lineHeight: 1.3 }}>{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.5, marginBottom: q.whyItMatters ? 6 : 0 }}>{q.question || q}</div>
                      {q.whyItMatters && <div style={{ fontSize: 12, color: 'var(--blue)', background: 'var(--blue-bg)', padding: '4px 8px', borderRadius: 4, lineHeight: 1.5 }}><strong>Why it matters:</strong> {q.whyItMatters}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations — stack ranked */}
          {activeTab === 'recommendations' && (
            <div>
              {/* Priority summary */}
              {hasAnalysis && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  {['P0', 'P1', 'P2', 'Cut'].map(p => {
                    const count = recommendations.filter(r => r.priority === p).length;
                    if (!count) return null;
                    const s = PRIORITY_STYLE[p];
                    return <span key={p} className={`p-tag ${s.cls}`}>{s.label} · {count}</span>;
                  })}
                </div>
              )}

              {recommendations.map((r, idx) => {
                const ps = PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.P2;
                const tB = TYPE_BADGE[r.projectType] || TYPE_BADGE.revenue;
                const eng = r.eng || {};
                const fin = r.fin || {};
                const cxB = COMPLEXITY_LABEL[eng.complexity];
                const challenges = directorChallenges.filter(c => c.recommendationId === r.id);
                const rebuttal = rebuttals.find(rb => rb.recommendationId === r.id);
                const hasChallenges = challenges.length > 0;

                return (
                  <div key={r.id} className="rec-card">
                    <div className="rec-top">
                      <div className="rec-rank">#{r.stackRank || idx + 1}</div>
                      <div className="rec-main">
                        <div className="rec-title-row">
                          <div className="rec-title">{r.title}</div>
                          <span className={`p-tag ${ps.cls}`}>{ps.label}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Badge cls={tB.cls} label={tB.label} />
                          {cxB && <Badge cls={cxB.cls} label={cxB.label} />}
                          {eng.effortWeeks && <Badge cls="b-gray" label={`⏱ ${eng.effortWeeks}`} />}
                          {fin.headline && <Badge cls="b-green" label={`💰 ${fin.headline}`} />}
                        </div>
                      </div>
                    </div>

                    {/* Combined score strip */}
                    <div className="rec-summary-row" style={{ borderTop: '1px solid var(--border)' }}>
                      <div className="summary-cell">
                        <div className="summary-val" style={{ color: 'var(--blue)' }}>{r.userValue}/10</div>
                        <div className="summary-label">User Value</div>
                      </div>
                      <div className="summary-cell">
                        <div className="summary-val" style={{ color: 'var(--purple)' }}>{r.strategicFit}/10</div>
                        <div className="summary-label">Strategic Fit</div>
                      </div>
                      <div className="summary-cell">
                        <div className="summary-val" style={{ color: '#0891b2' }}>{r.confidenceScore}/10</div>
                        <div className="summary-label">Confidence</div>
                      </div>
                    </div>

                    {/* Customer problem */}
                    <div className="rec-section">
                      <div className="rec-label">Customer Problem This Solves</div>
                      <div className="rec-problem-box">{r.customerProblemSolved}</div>
                    </div>

                    {/* What to build */}
                    <div className="rec-section">
                      <div className="rec-label">What to Build</div>
                      <div className="rec-text">{r.rationale}</div>
                    </div>

                    {/* MLP */}
                    <div className="rec-section">
                      <div className="rec-label">Minimum Lovable Product</div>
                      <div className="rec-mlp-box">{r.mlp}</div>
                    </div>

                    {/* Risks */}
                    {r.risks?.length > 0 && (
                      <div className="rec-section">
                        <div className="rec-label">Risks</div>
                        {r.risks.map((risk, i) => (
                          <div key={i} className="risk-item">
                            <span className="risk-icon">⚠</span>
                            <span>{risk}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Director challenges — collapsible */}
                    {hasChallenges && (
                      <div className="rec-section">
                        <div className="rec-label">Director Feedback</div>
                        {challenges.map((c, ci) => {
                          const key = `${r.id}-${ci}`;
                          const isOpen = expandedChallenges[key];
                          const rb = rebuttals.find(rb => rb.recommendationId === r.id && rb.challengeIndex === directorChallenges.indexOf(c));
                          const sbB = rb ? STANCE_BADGE[rb.stance] : null;
                          return (
                            <div key={ci} className="challenge-block">
                              <div className="challenge-header" onClick={() => setExpandedChallenges(p => ({ ...p, [key]: !p[key] }))}>
                                <Badge cls={c.isBlocker ? 'b-red' : 'b-yellow'} label={c.isBlocker ? '🚫 Blocker' : '⚠ Non-blocker'} />
                                <Badge cls="b-gray" label={c.category} />
                                {sbB && <Badge cls={sbB.cls} label={sbB.label} />}
                                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{isOpen ? '▲ Hide' : '▼ Show'}</span>
                              </div>
                              {isOpen && (
                                <div className="challenge-body fade-in">
                                  <div className="challenge-feedback">{c.feedback}</div>
                                  {c.context && <div className="challenge-context">{c.context}</div>}
                                  {rb && (
                                    <div className="rebuttal-box">
                                      {sbB && <Badge cls={sbB.cls} label={sbB.label} />}
                                      <div style={{ marginTop: 4 }}>{rb.response}</div>
                                      {rb.revisedTitle && <div style={{ fontSize: 11, color: 'var(--yellow)', marginTop: 4, fontStyle: 'italic' }}>→ Revised to: {rb.revisedTitle}</div>}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Financial Model */}
          {activeTab === 'modeling' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>
                Review and refine the financial model for each recommendation. Edit any assumption and recalculate to see updated projections.
              </p>
              {/* Rec selector */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                {recommendations.filter(r => r.fin).map(r => (
                  <button key={r.id} className={`btn ${activeModelRec?.id === r.id ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setActiveModelRec(r)}>
                    #{r.stackRank} {r.title.slice(0, 30)}{r.title.length > 30 ? '...' : ''}
                  </button>
                ))}
              </div>
              {activeModelRec
                ? <FinanceModel key={activeModelRec.id} recommendation={activeModelRec} />
                : recommendations.filter(r => r.fin).length > 0
                  ? <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>Select a recommendation above to view its financial model</div>
                  : <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>No financial models available. Run analysis first.</div>
              }
            </div>
          )}

          {/* Agent Review */}
          {activeTab === 'review' && (
            <div>
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--text-1)' }}>About Agent Review:</strong> After the PM, Engineer, Finance, and GTM agents complete their work, the Director reviews every recommendation and raises specific challenges. The PM then responds to each challenge — defending with evidence, revising, or conceding. This simulates a real planning meeting.
              </div>
              {finalSummary && (
                <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 'var(--r)', padding: '12px 16px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 6, fontSize: 13 }}>PM Final Statement</div>
                  <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.7 }}>{finalSummary}</div>
                </div>
              )}
              <div className="section-hd">All Director Challenges</div>
              {directorChallenges.map((c, i) => {
                const rec = recommendations.find(r => r.id === c.recommendationId);
                const rb = rebuttals.find(r => r.challengeIndex === i);
                const sbB = rb ? STANCE_BADGE[rb.stance] : null;
                const key = `review-${i}`;
                const isOpen = expandedChallenges[key];
                return (
                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={() => setExpandedChallenges(p => ({ ...p, [key]: !p[key] }))}>
                      {rec && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>#{rec.stackRank} {rec.title.slice(0, 25)}...</span>}
                      <Badge cls={c.isBlocker ? 'b-red' : 'b-yellow'} label={c.isBlocker ? 'Blocker' : 'Non-blocker'} />
                      <Badge cls="b-gray" label={c.category} />
                      {sbB && <Badge cls={sbB.cls} label={sbB.label} />}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '12px 14px' }} className="fade-in">
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', marginBottom: 6 }}>{c.feedback}</div>
                        {c.context && <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 4, marginBottom: 8 }}>{c.context}</div>}
                        {rb && (
                          <div className="rebuttal-box">
                            {sbB && <Badge cls={sbB.cls} label={sbB.label} />}
                            <div style={{ marginTop: 4 }}>{rb.response}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Roadmap */}
          {activeTab === 'roadmap' && (
            <div>
              {strategicGaps.length > 0 && (
                <>
                  <div className="section-hd">Strategic Gaps — Not on your roadmap</div>
                  {strategicGaps.map((g, i) => (
                    <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--purple)', borderRadius: 'var(--r)', padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ fontWeight: 600 }}>◈ {g.title}</div>
                        <Badge cls={g.urgency === 'high' ? 'b-red' : g.urgency === 'medium' ? 'b-yellow' : 'b-gray'} label={g.urgency} />
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
                      <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--red)', borderRadius: 'var(--r)', padding: '12px 14px', marginBottom: 8 }}>
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

      {/* Sessions */}
      {view === 'sessions' && (
        <div className="page fade-in" style={{ maxWidth: 760 }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Saved Sessions</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 22 }}>Load a previous session to continue your work.</div>
          {sessions.length === 0 && (
            <div className="empty">
              <div className="empty-icon">💾</div>
              <div className="empty-title">No saved sessions</div>
              <div className="empty-sub">Run an analysis and hit Save to store your work here.</div>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '12px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
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
