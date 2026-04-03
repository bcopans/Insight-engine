import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  synthesize, runAnalysis, parseRoadmap, evaluateRoadmap,
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

function Badge({ cls, children }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

function ScoreRow({ label, value, color }) {
  return (
    <div className="score-row">
      <span className="score-label-text">{label}</span>
      <div className="score-bar-wrap">
        <div className="score-bar-fill" style={{ width:`${value*10}%`, background: color }} />
      </div>
      <span className="score-val">{value}</span>
    </div>
  );
}

function Step({ label, status }) {
  const icons = { idle:'○', running:'◌', done:'✓', error:'✕' };
  return (
    <div className={`step ${status}`}>
      <span className={`step-dot${status==='running'?' pulse':''}`}>{icons[status]}</span>
      <span className="step-label">{label}</span>
      {status==='running' && <span className="step-running-label">Running...</span>}
    </div>
  );
}

function fileIcon(name='') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext==='docx'||ext==='doc') return '📄';
  if (ext==='pdf') return '📕';
  if (['png','jpg','jpeg','gif'].includes(ext)) return '🖼';
  return '📃';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(0)}KB`;
  return `${(bytes/(1024*1024)).toFixed(1)}MB`;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('files'); // files | results | sessions

  // Documents
  const [documents, setDocuments]         = useState([]);
  const [uploading, setUploading]         = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]); // {name, status}
  const [dragOver, setDragOver]           = useState(false);
  const [docsLoading, setDocsLoading]     = useState(false);

  // Synthesis
  const [synthesizing, setSynthesizing]   = useState(false);
  const [masterThemes, setMasterThemes]   = useState([]);
  const [probingQuestions, setProbingQuestions] = useState([]);
  const [researchGaps, setResearchGaps]   = useState([]);
  const [crossCuttingInsights, setCrossCuttingInsights] = useState([]);
  const [synthError, setSynthError]       = useState('');

  // Analysis
  const [analyzing, setAnalyzing]         = useState(false);
  const [agentStatus, setAgentStatus]     = useState({ pm:'idle', engineer:'idle', director:'idle', rebuttal:'idle' });
  const [recommendations, setRecommendations] = useState([]);
  const [engineerEstimates, setEngineerEstimates] = useState([]);
  const [directorChallenges, setDirectorChallenges] = useState([]);
  const [rebuttals, setRebuttals]         = useState([]);
  const [finalSummary, setFinalSummary]   = useState('');
  const [analysisError, setAnalysisError] = useState('');

  // Roadmap
  const [showRoadmap, setShowRoadmap]     = useState(false);
  const [roadmapText, setRoadmapText]     = useState('');
  const [roadmapFile, setRoadmapFile]     = useState(null);
  const [roadmapItems, setRoadmapItems]   = useState([]);
  const [roadmapParsed, setRoadmapParsed] = useState(false);
  const [parsingRoadmap, setParsingRoadmap] = useState(false);
  const [evaluating, setEvaluating]       = useState(false);
  const [evaluated, setEvaluated]         = useState(false);
  const [roadmapAnalysis, setRoadmapAnalysis] = useState([]);
  const [roadmapConflicts, setRoadmapConflicts] = useState([]);
  const [strategicGaps, setStrategicGaps] = useState([]);

  // UI
  const [activeTab, setActiveTab]         = useState('themes');
  const [expandedDocs, setExpandedDocs]   = useState({});
  const [saveStatus, setSaveStatus]       = useState('');
  const [sessions, setSessions]           = useState([]);

  const fileRef = useRef(null);
  const roadmapFileRef = useRef(null);
  const hasResults = masterThemes.length > 0;
  const hasAnalysis = recommendations.length > 0;

  useEffect(() => { loadDocuments(); }, []);

  const loadDocuments = async () => {
    setDocsLoading(true);
    try { setDocuments(await getDocuments()); } catch {}
    setDocsLoading(false);
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(files.map(f => ({ name: f.name, status: 'processing' })));

    try {
      const results = await uploadFiles(files);
      setUploadProgress(results.map(r => ({ name: r.name, status: r.error ? 'error' : 'done' })));
      await loadDocuments();
      setTimeout(() => setUploadProgress([]), 3000);
    } catch (e) {
      setUploadProgress(files.map(f => ({ name: f.name, status: 'error' })));
    } finally {
      setUploading(false);
    }
  }, []);

  const onDropZoneChange = (e) => handleFiles(Array.from(e.target.files));
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const handleDeleteDoc = async (id) => {
    try { await deleteDocument(id); setDocuments(d => d.filter(x => x.id !== id)); } catch {}
  };

  // ── Synthesize ─────────────────────────────────────────────────────────────
  const handleSynthesize = async () => {
    setSynthesizing(true); setSynthError('');
    try {
      const result = await synthesize();
      setMasterThemes(result.themes || []);
      setProbingQuestions(result.probingQuestions || []);
      setResearchGaps(result.researchGaps || []);
      setCrossCuttingInsights(result.crossCuttingInsights || []);
      setRecommendations([]); setEngineerEstimates([]); setDirectorChallenges([]);
      setRebuttals([]); setFinalSummary(''); setEvaluated(false);
      setView('results'); setActiveTab('themes');
    } catch (e) {
      setSynthError('Synthesis failed. Make sure you have documents uploaded.');
    } finally { setSynthesizing(false); }
  };

  // ── Run analysis ───────────────────────────────────────────────────────────
  const handleRunAnalysis = async () => {
    if (!masterThemes.length) return;
    setAnalyzing(true); setAnalysisError('');
    setAgentStatus({ pm:'running', engineer:'idle', director:'idle', rebuttal:'idle' });
    try {
      const result = await runAnalysis(masterThemes);
      setAgentStatus({ pm:'done', engineer:'done', director:'done', rebuttal:'done' });
      setRecommendations(result.recommendations || []);
      setEngineerEstimates(result.engineerEstimates || []);
      setDirectorChallenges(result.directorChallenges || []);
      setRebuttals(result.rebuttals || []);
      setFinalSummary(result.finalSummary || '');
      setActiveTab('recommendations');
    } catch (e) {
      setAnalysisError('Analysis failed. Try again.');
      setAgentStatus({ pm:'error', engineer:'error', director:'error', rebuttal:'error' });
    } finally { setAnalyzing(false); }
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

  // ── Save / Sessions ────────────────────────────────────────────────────────
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

  const rising = masterThemes.filter(t => t.strength >= 7);
  const tabs = [
    { key:'themes', label:`Themes (${masterThemes.length})` },
    { key:'questions', label:'Follow-up Questions' },
    ...(hasAnalysis ? [
      { key:'recommendations', label:`Recommendations (${recommendations.length})` },
      { key:'deliberation', label:'Deliberation' },
    ] : []),
    ...(evaluated ? [{ key:'roadmap', label:'Roadmap Eval' }] : []),
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
          <button className={`nav-btn${view==='results'?' active':''}`} onClick={() => setView('results')} disabled={!hasResults}>
            🔬 Analysis {hasResults && `(${masterThemes.length} themes)`}
          </button>
          <button className={`nav-btn${view==='sessions'?' active':''}`} onClick={handleLoadSessions}>
            💾 Sessions
          </button>
        </div>
        <div className="header-right">
          {rising.length > 0 && <Badge cls="badge-orange"><span className="pulse">⚡</span> {rising.length} Rising</Badge>}
          {hasResults && (
            <button className="btn-secondary btn-sm" onClick={handleSave} disabled={saveStatus==='saving'}>
              {saveStatus==='saving'?'Saving...':saveStatus==='saved'?'✓ Saved':'Save Session'}
            </button>
          )}
        </div>
      </header>

      {/* ── Files view ── */}
      {view==='files' && (
        <div className="page fade-in">
          <div className="two-col">
            {/* Left: Upload */}
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
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md,.png,.jpg" style={{display:'none'}} onChange={onDropZoneChange} />
                  <div className="drop-zone-icon">{uploading ? <span className="spin">⏳</span> : '📂'}</div>
                  <div className="drop-zone-title">{uploading ? 'Processing files...' : 'Drop files here or click to browse'}</div>
                  <div className="drop-zone-sub">Word docs, PDFs, text files · Multiple files supported</div>
                </div>

                {uploadProgress.length > 0 && (
                  <div style={{marginTop:12}}>
                    {uploadProgress.map((f,i) => (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',fontSize:12}}>
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

              {/* Roadmap panel */}
              <div className="panel">
                <div className="panel-title">
                  <span>Roadmap <Badge cls="badge-gray">Optional</Badge></span>
                  <button className="btn-secondary btn-sm" onClick={() => setShowRoadmap(s=>!s)}>{showRoadmap?'Hide':'Add'}</button>
                </div>
                {showRoadmap && (
                  <div className="fade-in">
                    {!roadmapParsed ? (
                      <>
                        <div className="drop-zone" style={{padding:16}} onClick={() => roadmapFileRef.current?.click()}>
                          <input ref={roadmapFileRef} type="file" accept=".docx,.pdf,.txt,.md" style={{display:'none'}} onChange={e => { setRoadmapFile(e.target.files[0]); setRoadmapText(''); }} />
                          {roadmapFile ? <div style={{fontSize:13,color:'#15803d',fontWeight:600}}>✓ {roadmapFile.name}</div> : <div style={{fontSize:13,color:'#6b7280'}}>Upload roadmap file</div>}
                        </div>
                        <div style={{textAlign:'center',fontSize:12,color:'#9ca3af',margin:'8px 0'}}>or paste text</div>
                        <textarea value={roadmapText} onChange={e=>{setRoadmapText(e.target.value);setRoadmapFile(null);}} placeholder={'Q3 Roadmap\n- Feature A\n- Feature B...'} style={{minHeight:70,fontSize:12}} />
                        <button className="btn-secondary" style={{width:'100%',marginTop:10}} onClick={handleParseRoadmap} disabled={parsingRoadmap||(!roadmapFile&&!roadmapText.trim())}>
                          {parsingRoadmap?'Parsing...':'Parse Roadmap'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                          <Badge cls="badge-green">✓ {roadmapItems.length} items loaded</Badge>
                          <button className="btn-secondary btn-sm" onClick={()=>{setRoadmapParsed(false);setRoadmapItems([]);setEvaluated(false);}}>Change</button>
                        </div>
                        <div style={{maxHeight:150,overflowY:'auto',marginBottom:10}}>
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
            </div>

            {/* Right: Document library + actions */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:'#0f172a'}}>{documents.length} Document{documents.length!==1?'s':''} in Library</div>
                  <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>Each document is analyzed individually, then synthesized into a unified theme model</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn-primary" onClick={handleSynthesize} disabled={synthesizing||documents.length===0}>
                    {synthesizing ? <><span className="spin">⏳</span> Synthesizing...</> : '🔬 Synthesize Themes'}
                  </button>
                </div>
              </div>
              {synthError && <div style={{color:'#dc2626',fontSize:13,padding:'10px 14px',background:'#fef2f2',borderRadius:8,marginBottom:12}}>{synthError}</div>}

              {docsLoading && <div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>Loading documents...</div>}

              {!docsLoading && documents.length===0 && (
                <div className="empty">
                  <div className="empty-icon">📂</div>
                  <div className="empty-title">No documents yet</div>
                  <div className="empty-sub">Upload Word docs, PDFs, or text files containing user feedback, interview notes, or survey responses.</div>
                </div>
              )}

              {documents.map(doc => (
                <div key={doc.id} className="file-item card-hover">
                  <div className="file-icon">{fileIcon(doc.name)}</div>
                  <div className="file-info">
                    <div className="file-name">{doc.name}</div>
                    <div className="file-meta">
                      {new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length||0} themes extracted
                      {doc.key_source && ` · ${doc.key_source}`}
                    </div>
                    {doc.document_summary && <div className="file-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id] && doc.themes?.length > 0 && (
                      <div style={{marginTop:8}}>
                        {doc.themes.map(t => (
                          <div key={t.id} style={{padding:'5px 8px',background:'#f8f9fb',borderRadius:5,border:'1px solid #e2e6ed',marginBottom:4,fontSize:12}}>
                            <div style={{fontWeight:600,color:'#1a1f2e'}}>{t.title}</div>
                            <div style={{color:'#64748b',marginTop:2}}>{t.description}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                    <button className="btn-icon" title="Toggle themes" onClick={() => setExpandedDocs(p=>({...p,[doc.id]:!p[doc.id]}))}>
                      {expandedDocs[doc.id]?'▲':'▼'}
                    </button>
                    <button className="btn-icon" title="Delete" onClick={() => handleDeleteDoc(doc.id)}>🗑</button>
                  </div>
                </div>
              ))}

              {hasResults && !analyzing && (
                <div style={{marginTop:20,padding:'16px 20px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:600,color:'#1d4ed8',fontSize:14}}>✓ Themes synthesized — ready for full analysis</div>
                    <div style={{fontSize:12,color:'#3b82f6',marginTop:2}}>{masterThemes.length} themes across {documents.length} documents</div>
                  </div>
                  <button className="btn-primary" onClick={handleRunAnalysis} disabled={analyzing}>
                    Run Full Analysis →
                  </button>
                </div>
              )}

              {analyzing && (
                <div className="panel fade-in" style={{marginTop:20}}>
                  <div className="panel-title">Agent Pipeline</div>
                  <div className="steps">
                    <Step label="PM — recommending solutions & roadmap placement" status={agentStatus.pm} />
                    <Step label="Engineer — estimating effort & flagging risks" status={agentStatus.engineer} />
                    <Step label="Director — challenging every assumption" status={agentStatus.director} />
                    <Step label="PM — defending, revising, or conceding" status={agentStatus.rebuttal} />
                  </div>
                  {analysisError && <div style={{color:'#dc2626',fontSize:12,marginTop:8}}>{analysisError}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Results view ── */}
      {view==='results' && (
        <div className="page fade-in">
          {evaluated && (
            <div className="eval-banner">
              <div>
                <div style={{fontWeight:600,color:'#5b21b6',fontSize:14}}>✓ Roadmap evaluation complete</div>
                <div style={{fontSize:12,color:'#7c3aed',marginTop:2}}>{roadmapConflicts.length} conflicts · {strategicGaps.length} gaps identified</div>
              </div>
              <button className="btn-purple" onClick={() => setActiveTab('roadmap')}>View Evaluation →</button>
            </div>
          )}

          {!hasAnalysis && (
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
              <button className="btn-primary" onClick={handleRunAnalysis} disabled={analyzing}>
                {analyzing?<><span className="spin">⏳</span> Analyzing...</>:'Run Full Analysis →'}
              </button>
            </div>
          )}

          <div className="tab-bar">
            {tabs.map(t => <button key={t.key} className={`tab-btn${activeTab===t.key?' active':''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>)}
          </div>

          {/* Themes */}
          {activeTab==='themes' && (
            <div>
              {crossCuttingInsights.length > 0 && (
                <div style={{marginBottom:20}}>
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
                  {t.sourceDocuments?.length > 0 && (
                    <div style={{fontSize:11,color:'#9ca3af',marginBottom:6}}>From: {t.sourceDocuments.join(' · ')}</div>
                  )}
                  {(t.quotes||[]).map((q,i) => <div key={i} className="quote">"{q}"</div>)}
                  {t.ambiguities?.length>0 && (
                    <div style={{fontSize:12,color:'#f59e0b',marginTop:6}}>⚠ Still unclear: {t.ambiguities.join(' · ')}</div>
                  )}
                  <div style={{marginTop:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>Signal Strength</span>
                      <span style={{fontSize:12,fontWeight:700,color:t.strength>=7?'#d97706':'#2563eb'}}>{t.strength}/10</span>
                    </div>
                    <div className="signal-bar">
                      <div className="signal-fill" style={{width:`${t.strength*10}%`,background:t.strength>=7?'#f59e0b':'#2563eb'}} />
                    </div>
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
              <p style={{fontSize:13,color:'#64748b',marginBottom:16}}>Ask these in your next research session to close gaps in understanding.</p>
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
                        <div style={{display:'flex',gap:16,marginBottom:eng.incrementalPath?6:0,flexWrap:'wrap'}}>
                          <span><strong>Effort:</strong> {eng.effortWeeks}</span>
                          <span><strong>Complexity:</strong> {eng.complexity}</span>
                        </div>
                        {eng.incrementalPath && <div style={{color:'#374151',marginBottom:4}}>→ {eng.incrementalPath}</div>}
                        {eng.redFlags?.map((f,i) => <div key={i} style={{color:'#dc2626',marginTop:3}}>⚑ {f}</div>)}
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
                        {rebuttal.revisedRecommendation && <div style={{color:'#d97706',marginTop:4,fontStyle:'italic'}}>→ Revised: {rebuttal.revisedRecommendation}</div>}
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
                      <Badge cls="badge-gray">{c.directorStance}</Badge>
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
                  <div style={{fontWeight:700,fontSize:13,color:'#374151',marginBottom:12}}>Strategic Gaps — Not on your roadmap</div>
                  {strategicGaps.map((g,i) => (
                    <div key={i} className="card" style={{borderLeft:'3px solid #7c3aed'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}>
                        <div style={{fontWeight:600,color:'#0f172a'}}>◈ {g.title}</div>
                        <Badge cls={g.urgency==='high'?'badge-red':g.urgency==='medium'?'badge-yellow':'badge-gray'}>{g.urgency} urgency</Badge>
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

      {/* ── Sessions view ── */}
      {view==='sessions' && (
        <div className="page fade-in" style={{maxWidth:800}}>
          <div style={{fontWeight:700,fontSize:20,color:'#0f172a',marginBottom:6}}>Saved Sessions</div>
          <div style={{fontSize:13,color:'#64748b',marginBottom:24}}>Load a previous analysis session to continue your work.</div>
          {sessions.length===0 && (
            <div className="empty">
              <div className="empty-icon">💾</div>
              <div className="empty-title">No saved sessions yet</div>
              <div className="empty-sub">Run an analysis and hit Save Session to store your work here.</div>
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
