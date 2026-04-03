import { useState, useRef, useEffect } from 'react';
import { parseRoadmap, analyzeTranscript, saveSession, getSessions, deleteSession } from './api';
import './App.css';

const sentimentColor = { positive: '#22c55e', negative: '#ef4444', mixed: '#f59e0b' };
const coverageStyle = {
  addresses: { bg: '#052e16', text: '#4ade80', label: '✓ Addresses' },
  partial:   { bg: '#1c1008', text: '#fbbf24', label: '~ Partial' },
  gap:       { bg: '#2d0a0a', text: '#f87171', label: '✗ Gap' },
  unrelated: { bg: '#0f172a', text: '#64748b', label: '— Unrelated' },
};
const statusStyle = {
  planned:       { color: '#7dd3fc', label: 'Planned' },
  'in-progress': { color: '#f59e0b', label: 'In Progress' },
  shipped:       { color: '#4ade80', label: 'Shipped' },
  unknown:       { color: '#475569', label: '—' },
};

function AgentStep({ label, status }) {
  const colors = { idle: '#1e293b', running: '#0ea5e9', done: '#22c55e', error: '#ef4444' };
  const icons  = { idle: '○', running: '◌', done: '●', error: '✕' };
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'5px 0' }}>
      <span className={status === 'running' ? 'pulse' : ''} style={{ color: colors[status], fontSize:'12px' }}>
        {icons[status]}
      </span>
      <span style={{ fontSize:'10px', color: status==='idle'?'#334155':status==='done'?'#64748b':colors[status], letterSpacing:'.08em' }}>
        {label}
      </span>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('engine'); // 'engine' | 'sessions'

  // Roadmap state
  const [roadmapFile, setRoadmapFile]     = useState(null);
  const [roadmapText, setRoadmapText]     = useState('');
  const [roadmapItems, setRoadmapItems]   = useState([]);
  const [roadmapParsed, setRoadmapParsed] = useState(false);
  const [roadmapName, setRoadmapName]     = useState('');

  // Analysis state
  const [transcript, setTranscript]           = useState('');
  const [loading, setLoading]                 = useState(false);
  const [activeTab, setActiveTab]             = useState('themes');
  const [allThemes, setAllThemes]             = useState([]);
  const [probingQuestions, setProbingQuestions] = useState([]);
  const [roadmapAnalysis, setRoadmapAnalysis] = useState([]);
  const [newOpportunities, setNewOpportunities] = useState([]);
  const [sessionCount, setSessionCount]       = useState(0);
  const [error, setError]                     = useState('');
  const [saveStatus, setSaveStatus]           = useState('');

  // Sessions
  const [sessions, setSessions]     = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Agent steps
  const [steps, setSteps] = useState({ extract: 'idle', parse: 'idle', analyze: 'idle' });
  const setStep = (k, v) => setSteps(p => ({ ...p, [k]: v }));

  const fileRef = useRef(null);

  useEffect(() => {
    if (view === 'sessions') fetchSessions();
  }, [view]);

  const fetchSessions = async () => {
    setSessionsLoading(true);
    try { setSessions(await getSessions()); } catch {}
    setSessionsLoading(false);
  };

  // ── Parse roadmap ──────────────────────────────────────────────────────────
  const handleParseRoadmap = async () => {
    if (!roadmapFile && !roadmapText.trim()) return;
    setLoading(true); setError('');
    setStep('extract', 'running'); setStep('parse', 'idle');
    try {
      setStep('extract', 'done'); setStep('parse', 'running');
      const items = await parseRoadmap(roadmapFile, roadmapText);
      setRoadmapItems(items);
      setRoadmapParsed(true);
      setRoadmapName(roadmapFile ? roadmapFile.name : 'Pasted roadmap');
      setStep('parse', 'done');
    } catch (e) {
      setError('Failed to parse roadmap. Try pasting text instead.');
      setStep('extract', 'error'); setStep('parse', 'error');
    } finally { setLoading(false); }
  };

  // ── Analyze feedback ───────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!transcript.trim()) return;
    setLoading(true); setError(''); setStep('analyze', 'running');
    try {
      const parsed = await analyzeTranscript(transcript, roadmapItems, allThemes);
      const existingMap = Object.fromEntries(allThemes.map(x => [x.id, x]));
      const merged = parsed.themes.map(t => {
        const ex = existingMap[t.id];
        if (ex) return { ...ex, ...t, strength: Math.min(10, ex.strength + (t.strength > 5 ? 1 : 0)), isNew: false };
        return { ...t };
      });
      allThemes.forEach(x => { if (!merged.find(m => m.id === x.id)) merged.push({ ...x }); });
      const sortedThemes = merged.sort((a, b) => b.strength - a.strength);
      setAllThemes(sortedThemes);
      setProbingQuestions(parsed.probingQuestions);
      setRoadmapAnalysis(parsed.roadmapAnalysis);
      setNewOpportunities(parsed.newOpportunities);
      setSessionCount(c => c + 1);
      setTranscript('');
      setStep('analyze', 'done');
    } catch (e) {
      setError('Analysis failed. Try again.');
      setStep('analyze', 'error');
    } finally { setLoading(false); }
  };

  // ── Save session ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSession({
        roadmap_name: roadmapName,
        roadmap_items: roadmapItems,
        themes: allThemes,
        probing_questions: probingQuestions,
        roadmap_analysis: roadmapAnalysis,
        new_opportunities: newOpportunities,
        session_count: sessionCount,
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleDeleteSession = async (id) => {
    try { await deleteSession(id); setSessions(s => s.filter(x => x.id !== id)); } catch {}
  };

  const loadSession = (s) => {
    setRoadmapItems(s.roadmap_items || []);
    setRoadmapParsed(true);
    setRoadmapName(s.roadmap_name || '');
    setAllThemes(s.themes || []);
    setProbingQuestions(s.probing_questions || []);
    setRoadmapAnalysis(s.roadmap_analysis || []);
    setNewOpportunities(s.new_opportunities || []);
    setSessionCount(s.session_count || 0);
    setView('engine');
  };

  const reset = () => {
    setAllThemes([]); setProbingQuestions([]); setRoadmapAnalysis([]);
    setNewOpportunities([]); setSessionCount(0); setTranscript(''); setError('');
    setSteps(p => ({ ...p, analyze: 'idle' }));
  };
  const fullReset = () => {
    reset(); setRoadmapFile(null); setRoadmapText(''); setRoadmapItems([]);
    setRoadmapParsed(false); setRoadmapName('');
    setSteps({ extract: 'idle', parse: 'idle', analyze: 'idle' });
  };

  const rising = allThemes.filter(t => t.strength >= 7);

  const saveLabel = { saving: 'Saving...', saved: '✓ Saved', error: 'Error', '': sessionCount > 0 ? 'Save Session' : '' }[saveStatus] || (sessionCount > 0 ? 'Save Session' : '');

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div>
          <div className="logo">INSIGHT ENGINE</div>
          <div className="logo-sub">CONTINUOUS USER FEEDBACK INTELLIGENCE</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'18px' }}>
          {sessionCount > 0 && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'10px', color:'#475569', letterSpacing:'.1em' }}>SESSIONS</div>
              <div style={{ fontSize:'24px', fontWeight:800, fontFamily:"'Syne',sans-serif", color:'#7dd3fc', lineHeight:1 }}>{sessionCount}</div>
            </div>
          )}
          {rising.length > 0 && (
            <div className="rising-badge">
              <div className="pulse" style={{ width:6, height:6, borderRadius:'50%', background:'#f59e0b' }} />
              <span>{rising.length} RISING SIGNAL{rising.length > 1 ? 'S' : ''}</span>
            </div>
          )}
          {sessionCount > 0 && (
            <button className="btn-p" onClick={handleSave} disabled={saveStatus === 'saving'} style={{ fontSize:'10px', padding:'8px 14px' }}>
              {saveLabel}
            </button>
          )}
          <button className={`tab-btn${view === 'sessions' ? ' active' : ''}`} onClick={() => setView(v => v === 'sessions' ? 'engine' : 'sessions')}>
            {view === 'sessions' ? '← Engine' : 'Sessions'}
          </button>
        </div>
      </div>

      {/* Sessions view */}
      {view === 'sessions' && (
        <div style={{ padding:'28px', maxWidth:'800px', margin:'0 auto' }}>
          <div style={{ fontSize:'11px', color:'#475569', letterSpacing:'.14em', marginBottom:'18px' }}>SAVED SESSIONS</div>
          {sessionsLoading && <div className="pulse" style={{ color:'#475569', fontSize:'11px' }}>Loading...</div>}
          {!sessionsLoading && sessions.length === 0 && (
            <div style={{ color:'#334155', fontSize:'11px', textAlign:'center', marginTop:'60px' }}>No saved sessions yet.</div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:'13px', color:'#f1f5f9', marginBottom:'4px' }}>{s.roadmap_name || 'Untitled session'}</div>
                <div style={{ fontSize:'10px', color:'#475569' }}>
                  {s.themes?.length || 0} themes · {s.session_count || 0} feedback sessions · {new Date(s.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button className="btn-p" style={{ fontSize:'10px', padding:'7px 14px' }} onClick={() => loadSession(s)}>Load</button>
                <button className="btn-g" style={{ fontSize:'10px', padding:'7px 14px' }} onClick={() => handleDeleteSession(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Engine view */}
      {view === 'engine' && (
        <div className="layout">
          {/* Left */}
          <div className="left-panel">
            {/* Step 1 */}
            <div className="panel-section">
              <div className="section-label" style={{ display:'flex', justifyContent:'space-between' }}>
                <span>① ROADMAP SOURCE</span>
                {roadmapParsed && <span style={{ color:'#22c55e' }}>{roadmapItems.length} ITEMS</span>}
              </div>

              {!roadmapParsed ? (
                <>
                  <div className={`upload-zone${roadmapFile ? ' has-file' : ''}`} onClick={() => fileRef.current?.click()}>
                    <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg" style={{ display:'none' }}
                      onChange={e => { setRoadmapFile(e.target.files[0] || null); setRoadmapText(''); }} />
                    {roadmapFile
                      ? <><div style={{ fontSize:'11px', color:'#22c55e' }}>✓ {roadmapFile.name}</div><div style={{ fontSize:'10px', color:'#475569', marginTop:'3px' }}>Click to change</div></>
                      : <><div style={{ fontSize:'11px', color:'#475569' }}>Drop file or click to upload</div><div style={{ fontSize:'10px', color:'#334155', marginTop:'3px' }}>PDF, TXT, MD, image</div></>
                    }
                  </div>
                  <div style={{ textAlign:'center', fontSize:'10px', color:'#334155', letterSpacing:'.1em', margin:'8px 0' }}>OR PASTE TEXT</div>
                  <textarea value={roadmapText} onChange={e => { setRoadmapText(e.target.value); setRoadmapFile(null); }}
                    placeholder={'Q3 Roadmap\n- Smart reorder suggestions\n- Loyalty points at checkout\n...'} style={{ minHeight:'80px' }} />
                  <div style={{ marginTop:'10px' }}>
                    <button className="btn-p" style={{ width:'100%' }} onClick={handleParseRoadmap}
                      disabled={loading || (!roadmapFile && !roadmapText.trim())}>
                      {loading && steps.parse === 'running' ? 'Parsing...' : 'Parse Roadmap'}
                    </button>
                  </div>
                  {(steps.extract !== 'idle' || steps.parse !== 'idle') && (
                    <div className="agent-box">
                      <AgentStep label="Extract document text" status={steps.extract} />
                      <AgentStep label="Roadmap parser agent" status={steps.parse} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ maxHeight:'200px', overflowY:'auto' }}>
                    {roadmapItems.map(r => {
                      const s = statusStyle[r.status] || statusStyle.unknown;
                      const a = roadmapAnalysis.find(x => x.roadmapItemId === r.id);
                      const cs = a ? coverageStyle[a.coverage] : null;
                      return (
                        <div key={r.id} style={{ padding:'7px 10px', marginBottom:'4px', background: cs ? cs.bg : '#0a0f18', border:'1px solid #1e293b', fontSize:'10px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:'8px' }}>
                            <span style={{ color:'#94a3b8', flex:1 }}>{r.item}</span>
                            <div style={{ display:'flex', gap:'6px', flexShrink:0 }}>
                              <span style={{ color:s.color }}>{s.label}</span>
                              {cs && <span style={{ color:cs.text }}>{cs.label}</span>}
                            </div>
                          </div>
                          {a && <div style={{ color:'#475569', marginTop:'3px' }}>{a.rationale}</div>}
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn-g" style={{ marginTop:'10px', width:'100%', fontSize:'10px' }} onClick={fullReset}>
                    ↺ Change Roadmap
                  </button>
                </>
              )}
            </div>

            {/* Step 2 */}
            <div className="panel-section" style={{ flex:1, display:'flex', flexDirection:'column' }}>
              <div className="section-label" style={{ color: roadmapParsed ? '#475569' : '#334155' }}>
                ② PASTE FEEDBACK
              </div>
              <textarea value={transcript} onChange={e => setTranscript(e.target.value)} disabled={!roadmapParsed}
                placeholder={roadmapParsed ? 'Interview transcript, meeting notes, survey response...' : 'Parse a roadmap first...'}
                style={{ flex:1, minHeight:'130px' }} />
              {error && <div style={{ color:'#f87171', fontSize:'10px', marginTop:'6px' }}>{error}</div>}
              <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}>
                <button className="btn-p" style={{ flex:1 }} onClick={handleAnalyze}
                  disabled={loading || !transcript.trim() || !roadmapParsed}>
                  {loading && steps.analyze === 'running' ? 'Analyzing...' : sessionCount === 0 ? 'Analyze' : 'Add to Engine'}
                </button>
                {sessionCount > 0 && <button className="btn-g" onClick={reset}>Reset</button>}
              </div>
              {steps.analyze !== 'idle' && (
                <div className="agent-box">
                  <AgentStep label="Insight analysis agent" status={steps.analyze} />
                </div>
              )}
            </div>
          </div>

          {/* Right */}
          <div className="right-panel">
            <div className="tabs">
              {[
                { key:'themes',        label:`Themes${allThemes.length ? ` (${allThemes.length})` : ''}` },
                { key:'questions',     label:`Probing Questions${probingQuestions.length ? ` (${probingQuestions.length})` : ''}` },
                { key:'opportunities', label:`Opportunities${newOpportunities.length ? ` (${newOpportunities.length})` : ''}` },
              ].map(t => (
                <button key={t.key} className={`tab-btn${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
              ))}
            </div>

            <div className="tab-content">
              {allThemes.length === 0 && !loading && (
                <div style={{ color:'#334155', fontSize:'11px', letterSpacing:'.08em', marginTop:'60px', textAlign:'center', lineHeight:2 }}>
                  {roadmapParsed ? 'Paste feedback and hit Analyze to begin.' : 'Start by uploading or pasting your roadmap →'}
                </div>
              )}
              {loading && steps.analyze === 'running' && (
                <div className="pulse" style={{ color:'#475569', fontSize:'11px', letterSpacing:'.1em', marginTop:'60px', textAlign:'center' }}>
                  Processing signals...
                </div>
              )}

              {activeTab === 'themes' && allThemes.length > 0 && (
                <div className="fade-in">
                  {allThemes.map(t => (
                    <div key={t.id} className={`card${t.strength >= 7 ? ' rising' : ''}`}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'5px' }}>
                        <div style={{ fontSize:'13px', color:'#f1f5f9', fontWeight:500 }}>{t.title}</div>
                        <div style={{ display:'flex', gap:'5px', flexShrink:0, marginLeft:'10px' }}>
                          {t.isNew && <span className="tag" style={{ background:'#0c1a2e', color:'#7dd3fc' }}>New</span>}
                          {t.strength >= 7 && <span className="tag pulse" style={{ background:'#2d1f00', color:'#f59e0b' }}>↑ Rising</span>}
                          <span className="tag" style={{ color:sentimentColor[t.sentiment], border:`1px solid ${sentimentColor[t.sentiment]}44` }}>{t.sentiment}</span>
                        </div>
                      </div>
                      <div style={{ fontSize:'11px', color:'#64748b', lineHeight:1.6 }}>{t.description}</div>
                      {t.quote && <div style={{ fontSize:'11px', color:'#475569', borderLeft:'2px solid #334155', paddingLeft:'10px', marginTop:'8px', fontStyle:'italic' }}>"{t.quote}"</div>}
                      <div className="bar">
                        <div className="fill" style={{ width:`${t.strength * 10}%`, background: t.strength>=7?'#f59e0b':t.strength>=4?'#0ea5e9':'#334155' }} />
                      </div>
                      <div style={{ fontSize:'10px', color:'#334155', marginTop:'3px', textAlign:'right', letterSpacing:'.08em' }}>SIGNAL {t.strength}/10</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'questions' && probingQuestions.length > 0 && (
                <div className="fade-in">
                  <div style={{ fontSize:'10px', color:'#475569', letterSpacing:'.1em', marginBottom:'14px' }}>Ask these in your next research session.</div>
                  {probingQuestions.map((q, i) => (
                    <div key={i} style={{ display:'flex', gap:'14px', marginBottom:'8px', padding:'13px 15px', background:'#0d1421', border:'1px solid #1e293b' }}>
                      <div style={{ color:'#1e3a4a', fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:'18px', lineHeight:1, flexShrink:0 }}>{String(i+1).padStart(2,'0')}</div>
                      <div style={{ fontSize:'12px', color:'#94a3b8', lineHeight:1.7 }}>{q}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'opportunities' && newOpportunities.length > 0 && (
                <div className="fade-in">
                  <div style={{ fontSize:'10px', color:'#475569', letterSpacing:'.1em', marginBottom:'14px' }}>Net-new opportunities not currently on roadmap.</div>
                  {newOpportunities.map((o, i) => (
                    <div key={i} style={{ marginBottom:'8px', padding:'13px 15px', background:'#0a1a0a', border:'1px solid #14532d' }}>
                      <div style={{ fontSize:'12px', color:'#4ade80', marginBottom:'5px', fontWeight:500 }}>◈ {o.title}</div>
                      <div style={{ fontSize:'11px', color:'#64748b', lineHeight:1.6 }}>{o.rationale}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
