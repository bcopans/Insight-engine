import { useState, useRef } from 'react';
import { analyzeTranscript, parseRoadmap, evaluateRoadmap, saveSession, getSessions, deleteSession } from './api';
import './App.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const sentimentBadge = {
  positive:   { cls: 'badge-green',  label: 'Positive' },
  negative:   { cls: 'badge-red',    label: 'Negative' },
  mixed:      { cls: 'badge-yellow', label: 'Mixed' },
  frustrated: { cls: 'badge-orange', label: 'Frustrated' },
  urgent:     { cls: 'badge-red',    label: 'Urgent' },
};
const placementBadge = {
  now:   { cls: 'badge-green',  label: 'Now' },
  next:  { cls: 'badge-yellow', label: 'Next Quarter' },
  later: { cls: 'badge-gray',   label: 'Later' },
  cut:   { cls: 'badge-red',    label: 'Cut' },
  new:   { cls: 'badge-purple', label: 'New Opportunity' },
};
const effortBadge = {
  XS: { cls: 'badge-green',  label: 'XS' },
  S:  { cls: 'badge-green',  label: 'S' },
  M:  { cls: 'badge-yellow', label: 'M' },
  L:  { cls: 'badge-orange', label: 'L' },
  XL: { cls: 'badge-red',    label: 'XL' },
};
const coverageBadge = {
  addresses: { cls: 'badge-green',  label: '✓ Addresses' },
  partial:   { cls: 'badge-yellow', label: '~ Partial' },
  gap:       { cls: 'badge-red',    label: '✗ Gap' },
  unrelated: { cls: 'badge-gray',   label: '— Unrelated' },
};
const stanceBadge = {
  defend:  { cls: 'badge-green',  label: '⚡ Defended' },
  revise:  { cls: 'badge-yellow', label: '↻ Revised' },
  concede: { cls: 'badge-red',    label: '✗ Conceded' },
};
const severityBadge = {
  blocker: { cls: 'badge-red',    label: 'Blocker' },
  major:   { cls: 'badge-orange', label: 'Major' },
  minor:   { cls: 'badge-yellow', label: 'Minor' },
};

function Badge({ type, map, label: overrideLabel }) {
  const cfg = map?.[type] || { cls: 'badge-gray', label: type };
  return <span className={`badge ${cfg.cls}`}>{overrideLabel || cfg.label}</span>;
}

function ScoreBar({ value, color = '#2563eb' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="signal-bar" style={{ flex: 1, margin: 0 }}>
        <div className="signal-fill" style={{ width: `${value * 10}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', width: 18 }}>{value}</span>
    </div>
  );
}

function AgentRow({ label, status }) {
  const icons = { idle: '○', running: '◌', done: '✓', error: '✕' };
  return (
    <div className={`agent-row ${status}`}>
      <span className={status === 'running' ? 'pulse' : ''} style={{ fontSize: 14 }}>{icons[status]}</span>
      <span>{label}</span>
      {status === 'running' && <span style={{ marginLeft: 'auto', fontSize: 11 }}>Running...</span>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('analyze');

  // Transcript + themes
  const [transcript, setTranscript]           = useState('');
  const [existingThemes, setExistingThemes]   = useState([]);
  const [sessionCount, setSessionCount]       = useState(0);
  const [analyzing, setAnalyzing]             = useState(false);
  const [analysisError, setAnalysisError]     = useState('');
  const [agentStatus, setAgentStatus]         = useState({ researcher: 'idle', pm: 'idle', engineer: 'idle', director: 'idle', rebuttal: 'idle' });

  // Results
  const [themes, setThemes]                   = useState([]);
  const [probingQuestions, setProbingQuestions] = useState([]);
  const [researchGaps, setResearchGaps]       = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [engineerEstimates, setEngineerEstimates] = useState([]);
  const [directorChallenges, setDirectorChallenges] = useState([]);
  const [rebuttals, setRebuttals]             = useState([]);
  const [finalSummary, setFinalSummary]       = useState('');
  const [activeTab, setActiveTab]             = useState('themes');

  // Roadmap (optional)
  const [showRoadmap, setShowRoadmap]         = useState(false);
  const [roadmapText, setRoadmapText]         = useState('');
  const [roadmapFile, setRoadmapFile]         = useState(null);
  const [roadmapItems, setRoadmapItems]       = useState([]);
  const [roadmapParsed, setRoadmapParsed]     = useState(false);
  const [parsingRoadmap, setParsingRoadmap]   = useState(false);
  const [roadmapError, setRoadmapError]       = useState('');

  // Roadmap eval results
  const [evaluating, setEvaluating]           = useState(false);
  const [evaluated, setEvaluated]             = useState(false);
  const [roadmapAnalysis, setRoadmapAnalysis] = useState([]);
  const [roadmapConflicts, setRoadmapConflicts] = useState([]);
  const [strategicGaps, setStrategicGaps]     = useState([]);
  const [evalError, setEvalError]             = useState('');

  // Sessions
  const [sessions, setSessions]               = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [saveStatus, setSaveStatus]           = useState('');

  const fileRef = useRef(null);
  const hasResults = themes.length > 0;

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!transcript.trim()) return;
    setAnalyzing(true);
    setAnalysisError('');
    setAgentStatus({ researcher: 'running', pm: 'idle', engineer: 'idle', director: 'idle', rebuttal: 'idle' });

    try {
      const result = await analyzeTranscript(transcript, existingThemes);

      setAgentStatus({ researcher: 'done', pm: 'done', engineer: 'done', director: 'done', rebuttal: 'done' });

      // Merge themes
      const existingMap = Object.fromEntries(existingThemes.map(t => [t.id, t]));
      const merged = (result.themes || []).map(t => {
        const ex = existingMap[t.id];
        if (ex) return { ...ex, ...t, strength: Math.min(10, ex.strength + (t.strength > 5 ? 1 : 0)), isNew: false };
        return { ...t };
      });
      existingThemes.forEach(t => { if (!merged.find(m => m.id === t.id)) merged.push({ ...t }); });
      const sorted = merged.sort((a, b) => b.strength - a.strength);

      setThemes(sorted);
      setExistingThemes(sorted);
      setProbingQuestions(result.probingQuestions || []);
      setResearchGaps(result.researchGaps || []);
      setRecommendations(result.recommendations || []);
      setEngineerEstimates(result.engineerEstimates || []);
      setDirectorChallenges(result.directorChallenges || []);
      setRebuttals(result.rebuttals || []);
      setFinalSummary(result.finalSummary || '');
      setSessionCount(c => c + 1);
      setTranscript('');
      setActiveTab('themes');
      setEvaluated(false);
    } catch (e) {
      setAnalysisError('Analysis failed. Check your API connection and try again.');
      setAgentStatus({ researcher: 'error', pm: 'error', engineer: 'error', director: 'error', rebuttal: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Parse roadmap ──────────────────────────────────────────────────────────
  const handleParseRoadmap = async () => {
    if (!roadmapFile && !roadmapText.trim()) return;
    setParsingRoadmap(true);
    setRoadmapError('');
    try {
      const items = await parseRoadmap(roadmapFile, roadmapText);
      setRoadmapItems(Array.isArray(items) ? items : []);
      setRoadmapParsed(true);
    } catch (e) {
      setRoadmapError('Could not parse roadmap. Try pasting text directly.');
    } finally {
      setParsingRoadmap(false);
    }
  };

  // ── Evaluate against roadmap ───────────────────────────────────────────────
  const handleEvaluate = async () => {
    if (!themes.length || !roadmapItems.length) return;
    setEvaluating(true);
    setEvalError('');
    try {
      const result = await evaluateRoadmap(themes, roadmapItems);
      setRoadmapAnalysis(result.roadmapAnalysis || []);
      setRoadmapConflicts(result.roadmapConflicts || []);
      setStrategicGaps(result.strategicGaps || []);
      setEvaluated(true);
      setActiveTab('roadmap');
    } catch (e) {
      setEvalError('Evaluation failed. Try again.');
    } finally {
      setEvaluating(false);
    }
  };

  // ── Save session ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSession({
        themes, probingQuestions, researchGaps, recommendations,
        engineerEstimates, directorChallenges, rebuttals, finalSummary,
        roadmapItems, roadmapAnalysis, roadmapConflicts, strategicGaps,
        session_count: sessionCount,
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 2500);
    }
  };

  const handleLoadSessions = async () => {
    setView('sessions');
    setLoadingSessions(true);
    try { setSessions(await getSessions()); } catch {}
    setLoadingSessions(false);
  };

  const handleLoadSession = (s) => {
    setThemes(s.themes || []);
    setExistingThemes(s.themes || []);
    setProbingQuestions(s.probingQuestions || []);
    setResearchGaps(s.researchGaps || []);
    setRecommendations(s.recommendations || []);
    setEngineerEstimates(s.engineerEstimates || []);
    setDirectorChallenges(s.directorChallenges || []);
    setRebuttals(s.rebuttals || []);
    setFinalSummary(s.finalSummary || '');
    setRoadmapItems(s.roadmapItems || []);
    setRoadmapParsed((s.roadmapItems || []).length > 0);
    setRoadmapAnalysis(s.roadmapAnalysis || []);
    setRoadmapConflicts(s.roadmapConflicts || []);
    setStrategicGaps(s.strategicGaps || []);
    setEvaluated((s.roadmapAnalysis || []).length > 0);
    setSessionCount(s.session_count || 0);
    setView('analyze');
    setActiveTab('themes');
  };

  const handleDeleteSession = async (id) => {
    try { await deleteSession(id); setSessions(s => s.filter(x => x.id !== id)); } catch {}
  };

  const rising = themes.filter(t => t.strength >= 7);
  const tabs = [
    { key: 'themes',          label: `Themes (${themes.length})` },
    { key: 'questions',       label: `Follow-up Questions` },
    { key: 'recommendations', label: `Recommendations (${recommendations.length})` },
    { key: 'deliberation',    label: 'Deliberation' },
    ...(evaluated ? [{ key: 'roadmap', label: 'Roadmap Evaluation' }] : []),
  ];

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div>
          <div className="logo">Insight Engine</div>
          <div className="logo-sub">User Research Intelligence</div>
        </div>
        <nav className="nav">
          <button className={`nav-btn${view === 'analyze' ? ' active' : ''}`} onClick={() => setView('analyze')}>Analyze</button>
          <button className={`nav-btn${view === 'sessions' ? ' active' : ''}`} onClick={handleLoadSessions}>Sessions</button>
        </nav>
        <div className="header-right">
          {sessionCount > 0 && (
            <span style={{ fontSize: 12, color: '#64748b' }}>{sessionCount} run{sessionCount !== 1 ? 's' : ''}</span>
          )}
          {rising.length > 0 && (
            <span className="badge badge-orange pulse">⚡ {rising.length} Rising Signal{rising.length > 1 ? 's' : ''}</span>
          )}
          {hasResults && (
            <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={handleSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error' : 'Save Session'}
            </button>
          )}
        </div>
      </header>

      {/* ── Sessions view ── */}
      {view === 'sessions' && (
        <div className="page fade-in">
          <div className="page-title">Saved Sessions</div>
          <div className="page-sub">Load a previous session to continue building on accumulated themes.</div>
          {loadingSessions && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading...</div>}
          {!loadingSessions && sessions.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📂</div>
              <div className="empty-title">No saved sessions yet</div>
              <div className="empty-sub">Run an analysis and hit Save Session to store your work.</div>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="session-card">
              <div>
                <div style={{ fontWeight: 600, color: '#1a1f2e', marginBottom: 4 }}>
                  {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {s.themes?.length || 0} themes · {s.session_count || 0} feedback runs · {s.recommendations?.length || 0} recommendations
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => handleLoadSession(s)}>Load</button>
                <button className="btn-danger" onClick={() => handleDeleteSession(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Main analyze view ── */}
      {view === 'analyze' && (
        <div className="page">
          <div className="two-col">

            {/* ── Left column ── */}
            <div className="left-col">

              {/* Feedback input */}
              <div className="panel">
                <div className="panel-title">① Paste Feedback</div>
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  disabled={analyzing}
                  placeholder="Interview transcript, meeting notes, survey responses, support tickets..."
                  style={{ minHeight: 180 }}
                />
                {analysisError && (
                  <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>
                    {analysisError}
                  </div>
                )}
                <button
                  className="btn-primary"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={handleAnalyze}
                  disabled={analyzing || !transcript.trim()}
                >
                  {analyzing ? '⏳ Agents analyzing...' : sessionCount === 0 ? 'Run Analysis' : 'Add More Feedback'}
                </button>
                {existingThemes.length > 0 && !analyzing && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
                    {existingThemes.length} accumulated themes will be merged
                  </div>
                )}
              </div>

              {/* Agent pipeline */}
              {analyzing && (
                <div className="panel fade-in">
                  <div className="panel-title">Agent Pipeline</div>
                  <AgentRow label="Researcher — defining problems" status={agentStatus.researcher} />
                  <AgentRow label="PM — recommending solutions" status={agentStatus.pm} />
                  <AgentRow label="Engineer — estimating effort" status={agentStatus.engineer} />
                  <AgentRow label="Director — challenging the plan" status={agentStatus.director} />
                  <AgentRow label="PM — defending or revising" status={agentStatus.rebuttal} />
                </div>
              )}

              {/* Optional roadmap */}
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showRoadmap ? 14 : 0 }}>
                  <div className="panel-title" style={{ margin: 0 }}>② Roadmap <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Optional</span></div>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => setShowRoadmap(s => !s)}>
                    {showRoadmap ? 'Hide' : 'Add Roadmap'}
                  </button>
                </div>

                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div
                          className={`upload-zone${roadmapFile ? ' has-file' : ''}`}
                          onClick={() => fileRef.current?.click()}
                        >
                          <input
                            ref={fileRef}
                            type="file"
                            accept=".pdf,.txt,.md,.csv,.png,.jpg"
                            style={{ display: 'none' }}
                            onChange={e => { setRoadmapFile(e.target.files[0] || null); setRoadmapText(''); }}
                          />
                          {roadmapFile
                            ? <><div style={{ fontWeight: 600, color: '#15803d' }}>✓ {roadmapFile.name}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>Click to change</div></>
                            : <><div style={{ fontWeight: 500, color: '#374151' }}>Upload file</div><div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>PDF, TXT, MD, image</div></>
                          }
                        </div>
                        <div style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', margin: '10px 0' }}>or paste text</div>
                        <textarea
                          value={roadmapText}
                          onChange={e => { setRoadmapText(e.target.value); setRoadmapFile(null); }}
                          placeholder={'Q3 Roadmap\n- Self-serve campaign builder\n- Closed-loop attribution\n...'}
                          style={{ minHeight: 80 }}
                        />
                        {roadmapError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{roadmapError}</div>}
                        <button
                          className="btn-secondary"
                          style={{ width: '100%', marginTop: 10 }}
                          onClick={handleParseRoadmap}
                          disabled={parsingRoadmap || (!roadmapFile && !roadmapText.trim())}
                        >
                          {parsingRoadmap ? '⏳ Parsing...' : 'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span className="badge badge-green">✓ {roadmapItems.length} items loaded</span>
                          <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => { setRoadmapParsed(false); setRoadmapItems([]); setEvaluated(false); }}>Change</button>
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                          {roadmapItems.map(r => {
                            const ev = roadmapAnalysis.find(a => a.roadmapItemId === r.id);
                            return (
                              <div key={r.id} style={{ padding: '6px 10px', marginBottom: 4, background: '#f8f9fb', borderRadius: 6, border: '1px solid #e2e6ed', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#374151', flex: 1 }}>{r.item}</span>
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  <span className={`badge ${r.status === 'shipped' ? 'badge-green' : r.status === 'in-progress' ? 'badge-yellow' : 'badge-blue'}`} style={{ fontSize: 10 }}>{r.status}</span>
                                  {ev && <span className={`badge ${coverageBadge[ev.coverage]?.cls}`} style={{ fontSize: 10 }}>{coverageBadge[ev.coverage]?.label}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {hasResults && (
                          <div style={{ marginTop: 12 }}>
                            {evalError && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{evalError}</div>}
                            <button
                              className="btn-purple"
                              style={{ width: '100%' }}
                              onClick={handleEvaluate}
                              disabled={evaluating}
                            >
                              {evaluating ? '⏳ Evaluating...' : evaluated ? '↻ Re-evaluate Against Roadmap' : '🗺 Evaluate Against Roadmap'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right column — Results ── */}
            <div>
              {!hasResults ? (
                <div className="empty" style={{ marginTop: 60 }}>
                  <div className="empty-icon">🔬</div>
                  <div className="empty-title">No analysis yet</div>
                  <div className="empty-sub">Paste feedback on the left and run analysis to see themes, recommendations, and the full agent deliberation.</div>
                </div>
              ) : (
                <div className="fade-in">
                  {evaluated && (
                    <div className="eval-banner">
                      <div>
                        <div className="eval-banner-text">✓ Roadmap evaluation complete</div>
                        <div className="eval-banner-sub">{roadmapConflicts.length} conflicts · {strategicGaps.length} gaps identified</div>
                      </div>
                      <button className="btn-purple" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => setActiveTab('roadmap')}>
                        View Evaluation →
                      </button>
                    </div>
                  )}

                  <div className="tab-bar">
                    {tabs.map(t => (
                      <button key={t.key} className={`tab-btn${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
                    ))}
                  </div>

                  {/* ── Themes ── */}
                  {activeTab === 'themes' && (
                    <div>
                      {themes.map(t => {
                        const sent = sentimentBadge[t.sentiment] || { cls: 'badge-gray', label: t.sentiment };
                        return (
                          <div key={t.id} className={`card${t.strength >= 7 ? ' rising' : ''}${t.isNew ? ' new-theme' : ''}`}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', flex: 1 }}>{t.title}</div>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                {t.isNew && <span className="badge badge-blue">New</span>}
                                {t.strength >= 7 && <span className="badge badge-orange pulse">↑ Rising</span>}
                                <span className={`badge ${sent.cls}`}>{sent.label}</span>
                              </div>
                            </div>
                            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 8 }}>{t.description}</div>
                            {(t.quotes || []).map((q, i) => (
                              <div key={i} className="quote">"{q}"</div>
                            ))}
                            {t.ambiguities?.length > 0 && (
                              <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                                ⚠ Still unclear: {t.ambiguities.join(' · ')}
                              </div>
                            )}
                            <div style={{ marginTop: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>SIGNAL STRENGTH</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: t.strength >= 7 ? '#d97706' : '#2563eb' }}>{t.strength}/10</span>
                              </div>
                              <div className="signal-bar">
                                <div className="signal-fill" style={{ width: `${t.strength * 10}%`, background: t.strength >= 7 ? '#f59e0b' : '#2563eb' }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {researchGaps.length > 0 && (
                        <div className="card" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
                          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 8, fontSize: 13 }}>⚠ Research Gaps</div>
                          {researchGaps.map((g, i) => (
                            <div key={i} style={{ fontSize: 13, color: '#78350f', marginBottom: 4 }}>· {g}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Questions ── */}
                  {activeTab === 'questions' && (
                    <div>
                      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Ask these in your next research session to fill the gaps in your understanding.</p>
                      {probingQuestions.map((q, i) => (
                        <div key={i} className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, color: '#e2e6ed', flexShrink: 0, lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</span>
                          <span style={{ fontSize: 13, color: '#1a1f2e', lineHeight: 1.6, paddingTop: 2 }}>{q}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Recommendations ── */}
                  {activeTab === 'recommendations' && (
                    <div>
                      {recommendations.map(r => {
                        const ps = placementBadge[r.roadmapPlacement] || placementBadge.later;
                        const eng = engineerEstimates.find(e => e.recommendationId === r.id);
                        const challenges = directorChallenges.filter(c => c.recommendationId === r.id);
                        const rebuttal = rebuttals.find(rb => rb.recommendationId === r.id);
                        return (
                          <div key={r.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', flex: 1 }}>{r.title}</div>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                <span className={`badge ${ps.cls}`}>{ps.label}</span>
                                {eng && <span className={`badge ${effortBadge[eng.effort]?.cls}`}>{eng.effort}</span>}
                              </div>
                            </div>
                            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>{r.rationale}</div>
                            <div className="score-grid">
                              {[['User Value', r.userValue, '#2563eb'], ['Strategic Fit', r.strategicFit, '#7c3aed'], ['Confidence', r.confidenceScore, '#0891b2']].map(([l, v, c]) => (
                                <div key={l} className="score-item">
                                  <div className="score-label">{l}</div>
                                  <ScoreBar value={v} color={c} />
                                </div>
                              ))}
                            </div>
                            {eng && (
                              <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8f9fb', borderRadius: 6, fontSize: 12 }}>
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: eng.incrementalPath ? 6 : 0 }}>
                                  <span><strong>Effort:</strong> {eng.effortWeeks}</span>
                                  <span><strong>Complexity:</strong> {eng.complexity}</span>
                                </div>
                                {eng.incrementalPath && <div style={{ color: '#374151' }}>→ {eng.incrementalPath}</div>}
                                {eng.redFlags?.map((f, i) => <div key={i} style={{ color: '#dc2626', marginTop: 4 }}>⚑ {f}</div>)}
                              </div>
                            )}
                            {challenges.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                {challenges.map((c, i) => (
                                  <div key={i} style={{ padding: '8px 12px', background: '#fff7ed', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                                      <span className={`badge ${severityBadge[c.severity]?.cls}`}>{severityBadge[c.severity]?.label}</span>
                                      <span className="badge badge-gray">{c.type}</span>
                                    </div>
                                    <div style={{ color: '#92400e' }}>{c.challenge}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {rebuttal && (
                              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, fontSize: 12 }}>
                                <span className={`badge ${stanceBadge[rebuttal.stance]?.cls}`} style={{ marginBottom: 6, display: 'inline-block' }}>{stanceBadge[rebuttal.stance]?.label}</span>
                                <div style={{ color: '#166534', marginTop: 4 }}>{rebuttal.response}</div>
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
                        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', marginBottom: 16 }}>
                          <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8, fontSize: 13 }}>PM Final Statement</div>
                          <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.7 }}>{finalSummary}</div>
                        </div>
                      )}
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>Director Challenges</div>
                      {directorChallenges.map((c, i) => {
                        const rb = rebuttals.find(r => r.challengeIndex === i);
                        return (
                          <div key={i} className="card">
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                              <span className={`badge ${severityBadge[c.severity]?.cls}`}>{severityBadge[c.severity]?.label}</span>
                              <span className="badge badge-gray">{c.type}</span>
                              <span className="badge badge-gray">{c.directorStance}</span>
                            </div>
                            <div style={{ fontSize: 13, color: '#1a1f2e', lineHeight: 1.6, marginBottom: 8 }}>{c.challenge}</div>
                            {rb && (
                              <div style={{ borderTop: '1px solid #e2e6ed', paddingTop: 8, marginTop: 4 }}>
                                <span className={`badge ${stanceBadge[rb.stance]?.cls}`} style={{ marginBottom: 6, display: 'inline-block' }}>{stanceBadge[rb.stance]?.label}</span>
                                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{rb.response}</div>
                                {rb.revisedRecommendation && (
                                  <div style={{ marginTop: 6, fontSize: 12, color: '#d97706', fontStyle: 'italic' }}>→ Revised: {rb.revisedRecommendation}</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Roadmap evaluation ── */}
                  {activeTab === 'roadmap' && evaluated && (
                    <div>
                      {strategicGaps.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>Strategic Gaps — Not on your roadmap</div>
                          {strategicGaps.map((g, i) => (
                            <div key={i} className="card" style={{ borderLeft: '3px solid #7c3aed' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontWeight: 600, color: '#0f172a' }}>◈ {g.title}</div>
                                <span className={`badge ${g.urgency === 'high' ? 'badge-red' : g.urgency === 'medium' ? 'badge-yellow' : 'badge-gray'}`}>{g.urgency} urgency</span>
                              </div>
                              <div style={{ fontSize: 13, color: '#374151' }}>{g.evidence}</div>
                            </div>
                          ))}
                          <div className="divider" />
                        </>
                      )}
                      {roadmapConflicts.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>Roadmap Conflicts</div>
                          {roadmapConflicts.map((c, i) => {
                            const item = roadmapItems.find(r => r.id === c.roadmapItemId);
                            return (
                              <div key={i} className="card" style={{ borderLeft: '3px solid #ef4444' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{item?.item || `Item ${c.roadmapItemId}`}</div>
                                  <span className="badge badge-red">{c.recommendation}</span>
                                </div>
                                <div style={{ fontSize: 13, color: '#374151' }}>{c.issue}</div>
                              </div>
                            );
                          })}
                          <div className="divider" />
                        </>
                      )}
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>Item-by-Item Coverage</div>
                      {roadmapItems.map(r => {
                        const ev = roadmapAnalysis.find(a => a.roadmapItemId === r.id);
                        const cb = ev ? coverageBadge[ev.coverage] : null;
                        return (
                          <div key={r.id} className="card" style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: ev?.rationale ? 4 : 0 }}>
                              <span style={{ fontSize: 13, color: '#1a1f2e', fontWeight: 500 }}>{r.item}</span>
                              {cb && <span className={`badge ${cb.cls}`}>{cb.label}</span>}
                            </div>
                            {ev?.rationale && <div style={{ fontSize: 12, color: '#64748b' }}>{ev.rationale}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
