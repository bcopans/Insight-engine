import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  streamSynthesize, streamAnalyze,
  parseRoadmap, evaluateRoadmap,
  saveSession, getSessions, deleteSession
} from './api';
import './App.css';

// ── Badge maps ────────────────────────────────────────────────────────────────
const sentimentMap = { positive:'badge-green', negative:'badge-red', mixed:'badge-yellow', frustrated:'badge-orange', urgent:'badge-red' };
const placementMap = { now:'badge-green', next:'badge-yellow', later:'badge-gray', cut:'badge-red', new:'badge-purple' };
const placementLabel = { now:'Now', next:'Next Quarter', later:'Later', cut:'Cut', new:'New Opportunity' };
const effortMap = { XS:'badge-green', S:'badge-green', M:'badge-yellow', L:'badge-orange', XL:'badge-red' };
const coverageMap = { addresses:'badge-green', partial:'badge-yellow', gap:'badge-red', unrelated:'badge-gray' };
const coverageLabel = { addresses:'✓ Addresses', partial:'~ Partial', gap:'✗ Gap', unrelated:'— Unrelated' };
const stanceMap = { defend:'badge-green', revise:'badge-yellow', concede:'badge-red' };
const stanceLabel = { defend:'⚡ Defended', revise:'↻ Revised', concede:'✗ Conceded' };
const severityMap = { blocker:'badge-red', major:'badge-orange', minor:'badge-yellow' };

const AGENTS = [
  { id: 'pm',       label: 'PM Agent',       icon: '🎯', desc: 'Forming recommendations & roadmap placement' },
  { id: 'engineer', label: 'Engineer Agent',  icon: '⚙️', desc: 'Estimating effort & flagging risks' },
  { id: 'director', label: 'Director Agent',  icon: '🔍', desc: 'Challenging assumptions' },
  { id: 'rebuttal', label: 'PM Rebuttal',     icon: '💬', desc: 'Defending or revising each challenge' },
];

function Badge({ cls, children }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

function ScoreRow({ label, value, color }) {
  return (
    <div className="score-row">
      <span className="score-label-text">{label}</span>
      <div className="score-bar-wrap"><div className="score-bar-fill" style={{ width:`${value*10}%`, background:color }} /></div>
      <span className="score-val">{value}</span>
    </div>
  );
}

function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'docx' || ext === 'doc') return '📄';
  if (ext === 'pdf') return '📕';
  if (['png','jpg','jpeg'].includes(ext)) return '🖼';
  return '📃';
}

// ── Agent Progress Panel ──────────────────────────────────────────────────────
function AgentProgress({ agentStatuses, agentMessages, synthStatus, isSynthesizing, isAnalyzing }) {
  if (!isSynthesizing && !isAnalyzing) return null;
  return (
    <div className="panel fade-in" style={{ marginTop: 16 }}>
      <div className="panel-title">
        {isSynthesizing ? '🔬 Synthesizing' : '🤖 Agent Deliberation'}
      </div>

      {isSynthesizing && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'#eff6ff', borderRadius:6, fontSize:13 }}>
          <span className="spin" style={{ fontSize:16 }}>⏳</span>
          <span style={{ color:'#1d4ed8' }}>{synthStatus || 'Processing...'}</span>
        </div>
      )}

      {isAnalyzing && AGENTS.map(a => {
        const status = agentStatuses[a.id] || 'idle';
        const message = agentMessages[a.id] || a.desc;
        return (
          <div key={a.id} style={{
            display:'flex', alignItems:'flex-start', gap:12, padding:'10px 12px',
            marginBottom:4, borderRadius:6, fontSize:13,
            background: status==='running' ? '#eff6ff' : status==='done' ? '#f0fdf4' : status==='error' ? '#fef2f2' : '#f8f9fb',
            border: `1px solid ${status==='running'?'#bfdbfe':status==='done'?'#86efac':status==='error'?'#fecaca':'#e2e6ed'}`,
            transition: 'all .3s'
          }}>
            <span style={{ fontSize:18, flexShrink:0 }}>{a.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color: status==='running'?'#1d4ed8':status==='done'?'#15803d':status==='error'?'#dc2626':'#64748b' }}>
                {a.label}
                {status==='running' && <span className="pulse" style={{ marginLeft:8, fontSize:11, fontWeight:400 }}>Running...</span>}
                {status==='done' && <span style={{ marginLeft:8, fontSize:11, fontWeight:400, color:'#16a34a' }}>✓ Complete</span>}
                {status==='error' && <span style={{ marginLeft:8, fontSize:11, fontWeight:400, color:'#dc2626' }}>✗ Failed</span>}
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('files');

  // Documents
  const [documents, setDocuments]           = useState([]);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [dragOver, setDragOver]             = useState(false);
  const [docsLoading, setDocsLoading]       = useState(false);
  const [expandedDocs, setExpandedDocs]     = useState({});

  // Synthesis
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthStatus, setSynthStatus]       = useState('');
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
  const [saveStatus, setSaveStatus]         = useState('');
  const [sessions, setSessions]             = useState([]);

  const fileRef = useRef(null);
  const roadmapFileRef = useRef(null);

  const hasResults = masterThemes.length > 0;
  const hasAnalysis = recommendations.length > 0;
  const rising = masterThemes.filter(t => t.strength >= 7);

  useEffect(() => { loadDocuments(); }, []);

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
      setUploadProgress(results.map(r => ({ name: r.name, status: r.error ? 'error' : 'done' })));
      await loadDocuments();
      setTimeout(() => setUploadProgress([]), 4000);
    } catch {
      setUploadProgress(files.map(f => ({ name: f.name, status: 'error' })));
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const handleDeleteDoc = async (id) => {
    try { await deleteDocument(id); setDocuments(d => d.filter(x => x.id !== id)); } catch {}
  };

  // ── Synthesize ─────────────────────────────────────────────────────────────
  const handleSynthesize = () => {
    setIsSynthesizing(true); setSynthError(''); setSynthStatus('');
    setRecommendations([]); setRebuttals([]); setFinalSummary(''); setEvaluated(false);

    streamSynthesize({
      onStatus: ({ message }) => setSynthStatus(message),
      onComplete: (data) => {
        setMasterThemes(data.themes || []);
        setProbingQuestions(data.probingQuestions || []);
        setResearchGaps(data.researchGaps || []);
        setCrossCuttingInsights(data.crossCuttingInsights || []);
        setIsSynthesizing(false);
        setView('results');
        setActiveTab('themes');
      },
      onError: (msg) => {
        setSynthError(msg || 'Synthesis failed');
        setIsSynthesizing(false);
      }
    });
  };

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleRunAnalysis = () => {
    if (!masterThemes.length) return;
    setIsAnalyzing(true); setAnalysisError('');
    setAgentStatuses({}); setAgentMessages({});

    streamAnalyze(masterThemes, {
      onAgent: ({ agent, status, message, output }) => {
        setAgentStatuses(p => ({ ...p, [agent]: status }));
        if (message) setAgentMessages(p => ({ ...p, [agent]: message }));
        if (output && agent === 'pm') setRecommendations(output.recommendations || []);
        if (output && agent === 'engineer') setEngineerEstimates(output.estimates || []);
        if (output && agent === 'director') setDirectorChallenges(output.challenges || []);
        if (output && agent === 'rebuttal') { setRebuttals(output.rebuttals || []); setFinalSummary(output.finalSummary || ''); }
      },
      onComplete: (data) => {
        setRecommendations(data.recommendations || []);
        setEngineerEstimates(data.engineerEstimates || []);
        setDirectorChallenges(data.directorChallenges || []);
        setRebuttals(data.rebuttals || []);
        setFinalSummary(data.finalSummary || '');
        setIsAnalyzing(false);
        setActiveTab('recommendations');
      },
      onError: (msg) => {
        setAnalysisError(msg || 'Analysis failed');
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
    } catch {}
    setParsingRoadmap(false);
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const result = await evaluateRoadmap(masterThemes, roadmapItems);
      setRoadmapAnalysis(result.roadmapAnalysis || []);
      setRoadmapConflicts(result.roadmapConflicts || []);
      setStrategicGaps(result.strategicGaps || []);
      setEvaluated(true); setActiveTab('roadmap');
    } catch {}
    setEvaluating(false);
  };

  // ── Save/Sessions ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSession({ masterThemes, probingQuestions, researchGaps, crossCuttingInsights, recommendations, engineerEstimates, directorChallenges, rebuttals, finalSummary, roadmapItems, roadmapAnalysis, roadmapConflicts, strategicGaps });
      setSaveStatus('saved'); setTimeout(() => setSaveStatus(''), 2500);
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
  };

  const tabs = [
    { key:'themes', label:`Themes (${masterThemes.length})` },
    { key:'questions', label:'Questions' },
    ...(hasAnalysis ? [
      { key:'recommendations', label:`Recs (${recommendations.length})` },
      { key:'deliberation', label:'Deliberation' },
    ] : []),
    ...(evaluated ? [{ key:'roadmap', label:'Roadmap' }] : []),
  ];

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div>
          <div className="logo">Insight Engine</div>
          <div className="logo-sub">User Research Intelligence</div>
        </div>
        <div className="header-center">
          <button className={`nav-btn${view==='files'?' active':''}`} onClick={() => setView('files')}>
            📁 Documents {documents.length > 0 && `(${documents.length})`}
          </button>
          <button className={`nav-btn${view==='results'?' active':''}`} onClick={() => hasResults && setView('results')} style={{ opacity: hasResults?1:.4, cursor: hasResults?'pointer':'not-allowed' }}>
            🔬 Analysis {hasResults && `(${masterThemes.length})`}
          </button>
          <button className={`nav-btn${view==='sessions'?' active':''}`} onClick={handleLoadSessions}>
            💾 Sessions
          </button>
        </div>
        <div className="header-right">
          {rising.length > 0 && <Badge cls="badge-orange"><span className="pulse">⚡</span> {rising.length} Rising</Badge>}
          {hasResults && (
            <button className="btn-secondary btn-sm" onClick={handleSave} disabled={saveStatus==='saving'}>
              {saveStatus==='saving'?'Saving...':saveStatus==='saved'?'✓ Saved':'Save'}
            </button>
          )}
        </div>
      </header>

      {/* ── Files View ── */}
      {view==='files' && (
        <div className="page fade-in">
          <div className="two-col">
            {/* Left */}
            <div className="left-col">
              <div className="panel">
                <div className="panel-title">Upload Feedback Documents</div>
                <div
                  className={`drop-zone${dragOver?' drag-over':''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md,.png,.jpg" style={{display:'none'}} onChange={e => handleFiles(Array.from(e.target.files))} />
                  <div className="drop-zone-icon">{uploading ? <span className="spin">⏳</span> : '📂'}</div>
                  <div className="drop-zone-title">{uploading ? 'Processing files...' : 'Drop files or click to browse'}</div>
                  <div className="drop-zone-sub">Word, PDF, TXT · Multiple files supported</div>
                </div>

                {uploadProgress.length > 0 && (
                  <div style={{marginTop:10}}>
                    {uploadProgress.map((f,i) => (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',fontSize:12}}>
                        <span>{fileIcon(f.name)}</span>
                        <span style={{flex:1,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                        <span className={`file-status ${f.status}`}>
                          {f.status==='processing'?<span className="pulse">Processing...</span>:f.status==='done'?'✓ Done':'✗ Error'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roadmap */}
              <div className="panel">
                <div className="panel-title">
                  <span>Roadmap <Badge cls="badge-gray">Optional</Badge></span>
                  <button className="btn-secondary btn-sm" onClick={() => setShowRoadmap(s=>!s)}>{showRoadmap?'Hide':'Add'}</button>
                </div>
                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div className="drop-zone" style={{padding:14}} onClick={() => roadmapFileRef.current?.click()}>
                          <input ref={roadmapFileRef} type="file" accept=".docx,.pdf,.txt,.md" style={{display:'none'}} onChange={e => { setRoadmapFile(e.target.files[0]); setRoadmapText(''); }} />
                          {roadmapFile ? <div style={{fontSize:13,color:'#15803d',fontWeight:600}}>✓ {roadmapFile.name}</div> : <div style={{fontSize:13,color:'#6b7280'}}>Upload roadmap file</div>}
                        </div>
                        <div style={{textAlign:'center',fontSize:12,color:'#9ca3af',margin:'8px 0'}}>or paste text</div>
                        <textarea value={roadmapText} onChange={e=>{setRoadmapText(e.target.value);setRoadmapFile(null);}} placeholder={'Q3 Roadmap\n- Feature A\n- Feature B'} style={{minHeight:70,fontSize:12}} />
                        <button className="btn-secondary" style={{width:'100%',marginTop:8}} onClick={handleParseRoadmap} disabled={parsingRoadmap||(!roadmapFile&&!roadmapText.trim())}>
                          {parsingRoadmap?'Parsing...':'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                          <Badge cls="badge-green">✓ {roadmapItems.length} items</Badge>
                          <button className="btn-secondary btn-sm" onClick={()=>{setRoadmapParsed(false);setRoadmapItems([]);setEvaluated(false);}}>Change</button>
                        </div>
                        <div style={{maxHeight:140,overflowY:'auto',marginBottom:10}}>
                          {roadmapItems.map(r => {
                            const ev = roadmapAnalysis.find(a=>a.roadmapItemId===r.id);
                            return (
                              <div key={r.id} style={{padding:'5px 8px',marginBottom:3,background:'#f8f9fb',borderRadius:5,border:'1px solid #e2e6ed',fontSize:12,display:'flex',justifyContent:'space-between',gap:6}}>
                                <span style={{color:'#374151',flex:1}}>{r.item}</span>
                                {ev && <Badge cls={coverageMap[ev.coverage]}>{coverageLabel[ev.coverage]}</Badge>}
                              </div>
                            );
                          })}
                        </div>
                        {hasResults && (
                          <button className="btn-purple" style={{width:'100%'}} onClick={handleEvaluate} disabled={evaluating}>
                            {evaluating?'Evaluating...':evaluated?'↻ Re-evaluate':'🗺 Evaluate Against Roadmap'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Synthesize error */}
              {synthError && (
                <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626'}}>
                  ✗ {synthError}
                </div>
              )}
            </div>

            {/* Right */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:'#0f172a'}}>{documents.length} Document{documents.length!==1?'s':''}</div>
                  <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>Each file is analyzed individually, then synthesized into a unified theme model</div>
                </div>
                <button className="btn-primary" onClick={handleSynthesize} disabled={isSynthesizing||documents.length===0}>
                  {isSynthesizing ? <><span className="spin">⏳</span> Synthesizing...</> : '🔬 Synthesize Themes'}
                </button>
              </div>

              {/* Agent progress */}
              <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} synthStatus={synthStatus} isSynthesizing={isSynthesizing} isAnalyzing={isAnalyzing} />

              {docsLoading && <div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>Loading...</div>}

              {!docsLoading && documents.length===0 && (
                <div className="empty">
                  <div className="empty-icon">📂</div>
                  <div className="empty-title">No documents yet</div>
                  <div className="empty-sub">Upload Word docs, PDFs, or text files containing user feedback, interviews, or survey responses.</div>
                </div>
              )}

              {documents.map(doc => (
                <div key={doc.id} className="file-item card-hover">
                  <div className="file-icon">{fileIcon(doc.name)}</div>
                  <div className="file-info">
                    <div className="file-name">{doc.name}</div>
                    <div className="file-meta">
                      {new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length||0} themes
                      {doc.key_source && ` · ${doc.key_source}`}
                    </div>
                    {doc.document_summary && <div className="file-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id] && (doc.themes||[]).map(t => (
                      <div key={t.id} style={{padding:'5px 8px',background:'#f8f9fb',borderRadius:5,border:'1px solid #e2e6ed',marginTop:4,fontSize:12}}>
                        <div style={{fontWeight:600,color:'#1a1f2e'}}>{t.title}</div>
                        <div style={{color:'#64748b',marginTop:2}}>{t.description}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                    <button className="btn-icon" onClick={() => setExpandedDocs(p=>({...p,[doc.id]:!p[doc.id]}))}>
                      {expandedDocs[doc.id]?'▲':'▼'}
                    </button>
                    <button className="btn-icon" onClick={() => handleDeleteDoc(doc.id)}>🗑</button>
                  </div>
                </div>
              ))}

              {hasResults && !isAnalyzing && (
                <div style={{marginTop:20,padding:'16px 20px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:600,color:'#1d4ed8',fontSize:14}}>✓ Themes ready — run full agent analysis</div>
                    <div style={{fontSize:12,color:'#3b82f6',marginTop:2}}>{masterThemes.length} themes across {documents.length} documents</div>
                  </div>
                  <button className="btn-primary" onClick={() => { setView('results'); handleRunAnalysis(); }}>
                    Run Full Analysis →
                  </button>
                </div>
              )}

              {isAnalyzing && (
                <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} synthStatus={synthStatus} isSynthesizing={false} isAnalyzing={true} />
              )}
              {analysisError && <div style={{marginTop:10,color:'#dc2626',fontSize:12,padding:'8px 12px',background:'#fef2f2',borderRadius:6}}>{analysisError}</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Results View ── */}
      {view==='results' && (
        <div className="page fade-in">
          {evaluated && (
            <div className="eval-banner">
              <div>
                <div style={{fontWeight:600,color:'#5b21b6',fontSize:14}}>✓ Roadmap evaluation complete</div>
                <div style={{fontSize:12,color:'#7c3aed',marginTop:2}}>{roadmapConflicts.length} conflicts · {strategicGaps.length} gaps</div>
              </div>
              <button className="btn-purple" onClick={() => setActiveTab('roadmap')}>View →</button>
            </div>
          )}

          {/* Live agent progress in results view */}
          {isAnalyzing && (
            <AgentProgress agentStatuses={agentStatuses} agentMessages={agentMessages} synthStatus={synthStatus} isSynthesizing={false} isAnalyzing={true} />
          )}

          {!hasAnalysis && !isAnalyzing && hasResults && (
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
              <button className="btn-primary" onClick={handleRunAnalysis}>Run Full Analysis →</button>
            </div>
          )}

          <div className="tab-bar">
            {tabs.map(t => <button key={t.key} className={`tab-btn${activeTab===t.key?' active':''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>)}
          </div>

          {/* Themes */}
          {activeTab==='themes' && (
            <div>
              {crossCuttingInsights.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#64748b',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:8}}>Cross-Cutting Insights</div>
                  {crossCuttingInsights.map((ins,i) => <div key={i} className="insight-card">💡 {ins}</div>)}
                </div>
              )}
              {masterThemes.map(t => (
                <div key={t.id} className={`card card-hover${t.strength>=7?' rising':''}${t.isNew?' new-theme':''}`}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:6}}>
                    <div style={{fontWeight:700,fontSize:14,color:'#0f172a',flex:1}}>{t.title}</div>
                    <div style={{display:'flex',gap:5,flexShrink:0,flexWrap:'wrap',justifyContent:'flex-end'}}>
                      {t.strength>=7 && <Badge cls="badge-orange"><span className="pulse">↑</span> Rising</Badge>}
                      <Badge cls={sentimentMap[t.sentiment]||'badge-gray'}>{t.sentiment}</Badge>
                      {t.frequency && <Badge cls="badge-gray">{t.frequency} sources</Badge>}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:'#374151',lineHeight:1.6,marginBottom:8}}>{t.description}</div>
                  {t.sourceDocuments?.length > 0 && <div style={{fontSize:11,color:'#9ca3af',marginBottom:6}}>From: {t.sourceDocuments.join(' · ')}</div>}
                  {(t.quotes||[]).map((q,i) => <div key={i} className="quote">"{q}"</div>)}
                  {t.ambiguities?.length>0 && <div style={{fontSize:12,color:'#f59e0b',marginTop:6}}>⚠ Unclear: {t.ambiguities.join(' · ')}</div>}
                  <div style={{marginTop:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>Signal Strength</span>
                      <span style={{fontSize:12,fontWeight:700,color:t.strength>=7?'#d97706':'#2563eb'}}>{t.strength}/10</span>
                    </div>
                    <div className="signal-bar"><div className="signal-fill" style={{width:`${t.strength*10}%`,background:t.strength>=7?'#f59e0b':'#2563eb'}} /></div>
                  </div>
                </div>
              ))}
              {researchGaps.length>0 && (
                <div className="card" style={{background:'#fffbeb',borderColor:'#fde68a',marginTop:4}}>
                  <div style={{fontWeight:700,color:'#92400e',marginBottom:8,fontSize:13}}>⚠ Research Gaps</div>
                  {researchGaps.map((g,i) => <div key={i} style={{fontSize:13,color:'#78350f',marginBottom:3}}>· {g}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Questions */}
          {activeTab==='questions' && (
            <div>
              <p style={{fontSize:13,color:'#64748b',marginBottom:16}}>Ask these in your next research session.</p>
              {probingQuestions.map((q,i) => (
                <div key={i} className="card card-hover" style={{display:'flex',gap:14,alignItems:'flex-start'}}>
                  <span style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:22,color:'#e2e6ed',flexShrink:0,lineHeight:1}}>{String(i+1).padStart(2,'0')}</span>
                  <span style={{fontSize:13,color:'#1a1f2e',lineHeight:1.6,paddingTop:3}}>{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {activeTab==='recommendations' && (
            <div>
              {recommendations.map(r => {
                const eng = engineerEstimates.find(e=>e.recommendationId===r.id);
                const challenges = directorChallenges.filter(c=>c.recommendationId===r.id);
                const rebuttal = rebuttals.find(rb=>rb.recommendationId===r.id);
                return (
                  <div key={r.id} className="card card-hover">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:8}}>
                      <div style={{fontWeight:700,fontSize:14,color:'#0f172a',flex:1}}>{r.title}</div>
                      <div style={{display:'flex',gap:5,flexShrink:0}}>
                        <Badge cls={placementMap[r.roadmapPlacement]||'badge-gray'}>{placementLabel[r.roadmapPlacement]||r.roadmapPlacement}</Badge>
                        {eng && <Badge cls={effortMap[eng.effort]||'badge-gray'}>{eng.effort}</Badge>}
                      </div>
                    </div>
                    <div style={{fontSize:13,color:'#374151',lineHeight:1.6,marginBottom:12}}>{r.rationale}</div>
                    <ScoreRow label="User Value" value={r.userValue} color="#2563eb" />
                    <ScoreRow label="Strategic Fit" value={r.strategicFit} color="#7c3aed" />
                    <ScoreRow label="Confidence" value={r.confidenceScore} color="#0891b2" />
                    {eng && (
                      <div style={{marginTop:12,padding:'10px 12px',background:'#f8f9fb',borderRadius:6,fontSize:12}}>
                        <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:eng.incrementalPath?6:0}}>
                          <span><strong>Effort:</strong> {eng.effortWeeks}</span>
                          <span><strong>Complexity:</strong> {eng.complexity}</span>
                        </div>
                        {eng.incrementalPath && <div style={{color:'#374151',marginBottom:4}}>→ {eng.incrementalPath}</div>}
                        {(eng.redFlags||[]).map((f,i) => <div key={i} style={{color:'#dc2626',marginTop:3}}>⚑ {f}</div>)}
                      </div>
                    )}
                    {challenges.length>0 && (
                      <div style={{marginTop:10}}>
                        {challenges.map((c,i) => (
                          <div key={i} style={{padding:'8px 12px',background:'#fff7ed',borderRadius:6,marginBottom:4,fontSize:12}}>
                            <div style={{display:'flex',gap:6,marginBottom:4}}>
                              <Badge cls={severityMap[c.severity]}>{c.severity}</Badge>
                              <Badge cls="badge-gray">{c.type}</Badge>
                            </div>
                            <div style={{color:'#92400e'}}>{c.challenge}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {rebuttal && (
                      <div style={{marginTop:8,padding:'8px 12px',background:'#f0fdf4',borderRadius:6,fontSize:12}}>
                        <Badge cls={stanceMap[rebuttal.stance]}>{stanceLabel[rebuttal.stance]}</Badge>
                        <div style={{color:'#166534',marginTop:6,lineHeight:1.6}}>{rebuttal.response}</div>
                        {rebuttal.revisedRecommendation && <div style={{color:'#d97706',marginTop:4,fontStyle:'italic'}}>→ {rebuttal.revisedRecommendation}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Deliberation */}
          {activeTab==='deliberation' && (
            <div>
              {finalSummary && (
                <div className="card" style={{background:'#f0fdf4',borderColor:'#86efac',marginBottom:16}}>
                  <div style={{fontWeight:700,color:'#15803d',marginBottom:8,fontSize:13}}>PM Final Statement</div>
                  <div style={{fontSize:13,color:'#166534',lineHeight:1.7}}>{finalSummary}</div>
                </div>
              )}
              <div style={{fontWeight:600,fontSize:13,color:'#374151',marginBottom:12}}>Director Challenges & PM Responses</div>
              {directorChallenges.map((c,i) => {
                const rb = rebuttals.find(r=>r.challengeIndex===i);
                return (
                  <div key={i} className="card">
                    <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                      <Badge cls={severityMap[c.severity]}>{c.severity}</Badge>
                      <Badge cls="badge-gray">{c.type}</Badge>
                    </div>
                    <div style={{fontSize:13,color:'#1a1f2e',lineHeight:1.6,marginBottom:8}}>{c.challenge}</div>
                    {rb && (
                      <div style={{borderTop:'1px solid #e2e6ed',paddingTop:8}}>
                        <Badge cls={stanceMap[rb.stance]}>{stanceLabel[rb.stance]}</Badge>
                        <div style={{fontSize:13,color:'#374151',lineHeight:1.6,marginTop:6}}>{rb.response}</div>
                        {rb.revisedRecommendation && <div style={{fontSize:12,color:'#d97706',marginTop:4,fontStyle:'italic'}}>→ {rb.revisedRecommendation}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Roadmap eval */}
          {activeTab==='roadmap' && evaluated && (
            <div>
              {strategicGaps.length>0 && (
                <>
                  <div style={{fontWeight:700,fontSize:13,color:'#374151',marginBottom:12}}>Strategic Gaps — Not on roadmap</div>
                  {strategicGaps.map((g,i) => (
                    <div key={i} className="card" style={{borderLeft:'3px solid #7c3aed'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}>
                        <div style={{fontWeight:600,color:'#0f172a'}}>◈ {g.title}</div>
                        <Badge cls={g.urgency==='high'?'badge-red':g.urgency==='medium'?'badge-yellow':'badge-gray'}>{g.urgency}</Badge>
                      </div>
                      <div style={{fontSize:13,color:'#374151'}}>{g.evidence}</div>
                    </div>
                  ))}
                  <div className="divider" />
                </>
              )}
              {roadmapConflicts.length>0 && (
                <>
                  <div style={{fontWeight:700,fontSize:13,color:'#374151',marginBottom:12}}>Roadmap Conflicts</div>
                  {roadmapConflicts.map((c,i) => {
                    const item = roadmapItems.find(r=>r.id===c.roadmapItemId);
                    return (
                      <div key={i} className="card" style={{borderLeft:'3px solid #ef4444'}}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}>
                          <div style={{fontWeight:600,color:'#0f172a'}}>{item?.item||`Item ${c.roadmapItemId}`}</div>
                          <Badge cls="badge-red">{c.recommendation}</Badge>
                        </div>
                        <div style={{fontSize:13,color:'#374151'}}>{c.issue}</div>
                      </div>
                    );
                  })}
                  <div className="divider" />
                </>
              )}
              <div style={{fontWeight:700,fontSize:13,color:'#374151',marginBottom:12}}>Item Coverage</div>
              {roadmapItems.map(r => {
                const ev = roadmapAnalysis.find(a=>a.roadmapItemId===r.id);
                return (
                  <div key={r.id} className="card" style={{padding:'10px 14px',display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:'#1a1f2e'}}>{r.item}</div>
                      {ev?.rationale && <div style={{fontSize:12,color:'#64748b',marginTop:3}}>{ev.rationale}</div>}
                    </div>
                    {ev && <Badge cls={coverageMap[ev.coverage]}>{coverageLabel[ev.coverage]}</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sessions View ── */}
      {view==='sessions' && (
        <div className="page fade-in" style={{maxWidth:800}}>
          <div style={{fontWeight:700,fontSize:20,color:'#0f172a',marginBottom:6}}>Saved Sessions</div>
          <div style={{fontSize:13,color:'#64748b',marginBottom:24}}>Load a previous analysis to continue your work.</div>
          {sessions.length===0 && (
            <div className="empty">
              <div className="empty-icon">💾</div>
              <div className="empty-title">No saved sessions yet</div>
              <div className="empty-sub">Run an analysis and hit Save to store it here.</div>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id} className="card card-hover" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
              <div>
                <div style={{fontWeight:600,color:'#1a1f2e',marginBottom:4}}>{new Date(s.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{s.masterThemes?.length||0} themes · {s.recommendations?.length||0} recommendations</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn-primary btn-sm" onClick={() => handleLoadSession(s)}>Load</button>
                <button className="btn-danger" onClick={() => deleteSession(s.id).then(() => setSessions(ss=>ss.filter(x=>x.id!==s.id)))}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
