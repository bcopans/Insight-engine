import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadFiles, getDocuments, deleteDocument,
  synthesizeThemes, runAnalysis,
  chatFinance, recalculateFinance,
  parseRoadmap, saveDecision, getDecisions, getLogs,
  saveSession, getSessions, deleteSession
} from './api';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const SYNTH_MSGS = ['Loading documents...','Reading each document...','Extracting customer problems...','Evaluating positioning...','Synthesizing across all sources...','Almost done...'];
const ANALYSIS_STEPS = ['PM forming recommendations...','Engineer estimating effort...','Finance Analyst modeling impact...','GTM Specialist planning launch...','Director reviewing the plan...','PM defending recommendations...'];

const CERT_BADGE = { high:{cls:'b-green',label:'High Certainty'}, medium:{cls:'b-yellow',label:'Medium Certainty'}, low:{cls:'b-red',label:'Low Certainty'} };
const TYPE_BADGE = { revenue:{cls:'b-green',label:'💰 Revenue'}, adoption:{cls:'b-blue',label:'📈 New Advertisers'}, efficiency:{cls:'b-purple',label:'⚡ Efficiency'}, foundation:{cls:'b-gray',label:'🏗 Foundation'} };
const STANCE_BADGE = { defend:{cls:'b-green',label:'✓ Defended'}, revise:{cls:'b-yellow',label:'↻ Revised'}, concede:{cls:'b-red',label:'✗ Conceded'} };
const COMPLEXITY = { low:{cls:'b-green',label:'Low Complexity'}, medium:{cls:'b-yellow',label:'Medium Complexity'}, high:{cls:'b-orange',label:'High Complexity'}, 'very-high':{cls:'b-red',label:'Very High Complexity'} };
const PRIORITY_STYLE = { P0:{cls:'p0',label:'P0'}, P1:{cls:'p1',label:'P1'}, P2:{cls:'p2',label:'P2'}, Cut:{cls:'pcut',label:'Cut'} };
const STATUS_DOT = { shipped:'status-shipped', 'in-progress':'status-in-progress', planned:'status-planned', unknown:'status-unknown' };

function Badge({cls,label}){ return <span className={`badge ${cls}`}>{label}</span>; }
function fileIcon(n=''){ const e=(n.split('.').pop()||'').toLowerCase(); return ['docx','doc'].includes(e)?'📄':e==='pdf'?'📕':'📃'; }
function Toast({msg}){ return msg?<div className="toast">{msg}</div>:null; }

function DeleteModal({doc,onConfirm,onCancel}){
  if(!doc) return null;
  return <div className="modal-bg" onClick={onCancel}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Remove document?</div>
    <div className="modal-body">"{doc.name}" will be removed and excluded from future synthesis.</div>
    <div className="modal-actions">
      <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      <button className="btn btn-sm" style={{background:'#dc2626',color:'#fff'}} onClick={onConfirm}>Remove</button>
    </div>
  </div></div>;
}

function RejectModal({rec, onConfirm, onCancel}){
  const [reason, setReason] = useState('');
  if(!rec) return null;
  return <div className="modal-bg" onClick={onCancel}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Reject "{rec.title}"?</div>
    <div className="modal-body">
      <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for rejection (optional)" style={{minHeight:70,fontSize:13,marginTop:4}} />
    </div>
    <div className="modal-actions">
      <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      <button className="btn btn-sm btn-reject" onClick={()=>onConfirm(reason)}>Confirm Reject</button>
    </div>
  </div></div>;
}

// ── Finance Model ─────────────────────────────────────────────────────────────
function FinanceModel({recommendation}){
  const model = recommendation?.fin;
  const [assumptions, setAssumptions] = useState(model?.assumptions||[]);
  const [headline, setHeadline] = useState(model?.headline||'');
  const [calcLogic, setCalcLogic] = useState(model?.calculationLogic||'');
  const [recalcing, setRecalcing] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [messages, setMessages] = useState([{role:'assistant',content:`I've built an initial financial model for **${recommendation?.title}**. Current estimate: ${model?.headline||'pending'}. Edit any assumption and recalculate, or ask me a question.`}]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const msgsEnd = useRef(null);
  useEffect(()=>{ msgsEnd.current?.scrollIntoView({behavior:'smooth'}); },[messages]);

  const recalc = async()=>{
    setRecalcing(true);
    try{ const r=await recalculateFinance(recommendation,assumptions); if(r.headline)setHeadline(r.headline); if(r.calculationLogic)setCalcLogic(r.calculationLogic); }catch{}
    setRecalcing(false);
  };
  const updateA=(id,val)=>setAssumptions(p=>p.map(a=>a.id===id?{...a,value:val}:a));
  const addA=()=>{ if(!newLabel.trim()||!newValue.trim())return; setAssumptions(p=>[...p,{id:`c-${Date.now()}`,label:newLabel,value:newValue,editable:true,confidence:'medium'}]); setNewLabel('');setNewValue(''); };
  const sendChat=async()=>{
    if(!chatInput.trim()||chatLoading)return;
    const userMsg={role:'user',content:chatInput};
    const msgs=[...messages,userMsg]; setMessages(msgs); setChatInput(''); setChatLoading(true);
    try{ const {response}=await chatFinance(msgs,recommendation,{...model,assumptions,headline}); setMessages(m=>[...m,{role:'assistant',content:response}]); }
    catch{ setMessages(m=>[...m,{role:'assistant',content:'Something went wrong. Try again.'}]); }
    setChatLoading(false);
  };
  if(!model) return <div style={{fontSize:13,color:'var(--text-3)',padding:'12px 0'}}>No financial model for this recommendation.</div>;
  return(
    <div>
      <div className="impact-banner">
        <div className="impact-number">{headline}</div>
        <div className="impact-label">{model.projectType==='revenue'?'Projected Ad Revenue Impact':'Projected New Advertisers'}</div>
        {model.upside&&<div className="impact-range">↑ {model.upside} · ↓ {model.downside}</div>}
      </div>
      {calcLogic&&<div style={{fontSize:12,color:'var(--text-2)',background:'var(--surface-2)',padding:'8px 10px',borderRadius:'var(--r)',marginBottom:12,lineHeight:1.6}}><strong style={{color:'var(--text-1)'}}>How we got there:</strong> {calcLogic}</div>}
      <div style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div className="section-hd" style={{margin:0}}>Assumptions</div>
          <button className="btn btn-primary btn-xs" onClick={recalc} disabled={recalcing}>{recalcing?<><span className="spin">⚙</span> Recalculating...</>:'↻ Recalculate'}</button>
        </div>
        {assumptions.map(a=>(
          <div key={a.id} className="assumption-row">
            <span className="assumption-label">{a.label}</span>
            <Badge cls={a.confidence==='high'?'b-green':a.confidence==='medium'?'b-yellow':'b-red'} label={a.confidence}/>
            <input className="assumption-input" value={a.value} onChange={e=>updateA(a.id,e.target.value)} disabled={a.editable===false}/>
          </div>
        ))}
        <div className="add-row">
          <input className="assumption-input" style={{flex:1,width:'auto',textAlign:'left'}} placeholder="New assumption" value={newLabel} onChange={e=>setNewLabel(e.target.value)}/>
          <input className="assumption-input" style={{width:110}} placeholder="Value" value={newValue} onChange={e=>setNewValue(e.target.value)}/>
          <button className="btn btn-secondary btn-xs" onClick={addA} disabled={!newLabel.trim()||!newValue.trim()}>+ Add</button>
        </div>
      </div>
      <div className="section-hd">Discuss with Finance Analyst</div>
      <div className="chat-wrap">
        <div className="chat-msgs">
          {messages.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>)}
          {chatLoading&&<div className="chat-msg assistant"><span className="pulse">Thinking...</span></div>}
          <div ref={msgsEnd}/>
        </div>
        <div className="chat-input-row">
          <textarea className="chat-input" rows={2} value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Ask about assumptions, scenarios, or provide better data..." onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}}/>
          <button className="btn btn-primary btn-sm" onClick={sendChat} disabled={chatLoading||!chatInput.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ── Left Nav ──────────────────────────────────────────────────────────────────
function LeftNav({active, setActive, hasThemes, hasAnalysis, docCount, themeCount, recCount}){
  const items = [
    {section:'Research', items:[
      {key:'documents', icon:'📁', label:'Documents', badge:docCount||null},
    ]},
    {section:'Analysis', items:[
      {key:'exec',            icon:'📋', label:'Exec Summary',     disabled:!hasThemes},
      {key:'themes',          icon:'🔍', label:'Themes',           badge:themeCount||null, disabled:!hasThemes},
      {key:'followup',        icon:'❓', label:'Follow-up',        disabled:!hasThemes},
      {key:'recommendations', icon:'🎯', label:'Recommendations',  badge:recCount||null, disabled:!hasAnalysis},
      {key:'financial',       icon:'💰', label:'Financial Model',  disabled:!hasAnalysis},
      {key:'agentreview',     icon:'🤖', label:'Agent Review',     disabled:!hasAnalysis},
      {key:'roadmap',         icon:'🗺', label:'Roadmap',          disabled:false},
    ]},
    {section:'History', items:[
      {key:'sessions', icon:'💾', label:'Sessions'},
      {key:'logs',     icon:'📜', label:'Logs'},
    ]},
  ];
  return(
    <nav className="leftnav">
      {items.map(section=>(
        <div key={section.section} className="nav-section">
          <div className="nav-section-label">{section.section}</div>
          {section.items.map(item=>(
            <button key={item.key} className={`nav-item${active===item.key?' active':''}`}
              disabled={item.disabled}
              onClick={()=>!item.disabled&&setActive(item.key)}
              style={item.disabled?{opacity:.35,cursor:'not-allowed'}:{}}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge!=null&&item.badge>0&&<span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
          <div className="nav-divider"/>
        </div>
      ))}
    </nav>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [view, setView] = useState('documents');

  // Docs
  const [documents, setDocuments]     = useState([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState([]);
  const [dragOver, setDragOver]       = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Synth
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthMsgIdx, setSynthMsgIdx]   = useState(0);
  const [synthElapsed, setSynthElapsed] = useState(0);
  const [synthError, setSynthError]     = useState('');
  const [execSummary, setExecSummary]   = useState(null);
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

  // Decisions
  const [decisions, setDecisions]       = useState({});
  const [rejectTarget, setRejectTarget] = useState(null);

  // Roadmap
  const [roadmapText, setRoadmapText]   = useState('');
  const [roadmapFile, setRoadmapFile]   = useState(null);
  const [roadmapItems, setRoadmapItems] = useState([]);
  const [roadmapParsed, setRoadmapParsed] = useState(false);
  const [parsingRoadmap, setParsingRoadmap] = useState(false);
  const [expandedRoadmapItems, setExpandedRoadmapItems] = useState({});

  // UI
  const [toast, setToast]               = useState('');
  const [saveStatus, setSaveStatus]     = useState('');
  const [sessions, setSessions]         = useState([]);
  const [logs, setLogs]                 = useState([]);
  const [logsLoading, setLogsLoading]   = useState(false);
  const [expandedThemes, setExpandedThemes] = useState({});
  const [expandedVOC, setExpandedVOC]   = useState({});
  const [expandedUnknowns, setExpandedUnknowns] = useState({});
  const [expandedChallenges, setExpandedChallenges] = useState({});
  const [activeModelRec, setActiveModelRec] = useState(null);
  const [expandedPriority, setExpandedPriority] = useState({});
  const [expandedScores, setExpandedScores] = useState({});
  const [synthKey, setSynthKey]         = useState(0);

  const fileRef = useRef(null);
  const roadmapRef = useRef(null);
  const synthInt = useRef(null);
  const elapsedInt = useRef(null);
  const stepInt = useRef(null);

  const hasThemes = themes.length > 0;
  const hasAnalysis = recommendations.length > 0;

  useEffect(()=>{ loadDocs(); },[]);

  const showToast = (msg)=>{ setToast(msg); setTimeout(()=>setToast(''),3000); };
  const loadDocs = async()=>{ setDocsLoading(true); try{ setDocuments(await getDocuments()); }catch{} setDocsLoading(false); };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async(files)=>{
    if(!files.length) return;
    setUploading(true);
    setUploadStatus(files.map(f=>({name:f.name,status:'processing'})));
    try{
      const results = await uploadFiles(files);
      setUploadStatus(results.map(r=>({name:r.name,status:r.error?'error':'done'})));
      await loadDocs();
      setTimeout(()=>setUploadStatus([]),4000);
      const ok=results.filter(r=>!r.error).length;
      if(ok) showToast(`✓ ${ok} document${ok>1?'s':''} uploaded`);
    }catch{ setUploadStatus(files.map(f=>({name:f.name,status:'error'}))); }
    setUploading(false);
  },[]);

  const onDrop=(e)=>{ e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); };

  const confirmDelete=async()=>{
    if(!deleteTarget) return;
    try{ await deleteDocument(deleteTarget.id); setDocuments(d=>d.filter(x=>x.id!==deleteTarget.id)); showToast('Removed'); }catch{}
    setDeleteTarget(null);
  };

  // ── Synthesize ─────────────────────────────────────────────────────────────
  const handleSynthesize=async()=>{
    setSynthesizing(true); setSynthError(''); setSynthMsgIdx(0); setSynthElapsed(0);
    synthInt.current=setInterval(()=>setSynthMsgIdx(i=>Math.min(i+1,SYNTH_MSGS.length-1)),4000);
    elapsedInt.current=setInterval(()=>setSynthElapsed(s=>s+1),1000);
    try{
      const data=await synthesizeThemes();
      clearInterval(synthInt.current); clearInterval(elapsedInt.current);
      setExecSummary(data.execSummary||null);
      setThemes(data.themes||[]); setQuestions(data.probingQuestions||[]); setResearchGaps(data.researchGaps||[]);
      setSynthKey(k=>k+1);
      setSynthesizing(false); setView('exec');
      showToast(`✓ ${data.themes?.length||0} themes synthesized`);
    }catch(e){
      clearInterval(synthInt.current); clearInterval(elapsedInt.current);
      setSynthError(e.message?.includes('No documents')?'Upload documents first.':'Synthesis failed. Try again.');
      setSynthesizing(false);
    }
  };

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze=async()=>{
    if(!themes.length) return;
    setAnalyzing(true); setAnalysisError('');
    let idx=0; setAnalysisStep(ANALYSIS_STEPS[0]);
    stepInt.current=setInterval(()=>{ idx=Math.min(idx+1,ANALYSIS_STEPS.length-1); setAnalysisStep(ANALYSIS_STEPS[idx]); },18000);
    try{
      const data=await runAnalysis(themes,roadmapItems);
      clearInterval(stepInt.current);
      setRecommendations(data.recommendations||[]);
      setDirectorChallenges(data.directorChallenges||[]);
      setRebuttals(data.rebuttals||[]); setFinalSummary(data.finalSummary||'');
      setRoadmapConflicts(data.roadmapConflicts||[]); setStrategicGaps(data.strategicGaps||[]);
      setAnalyzing(false); setView('recommendations');
      showToast(`✓ ${data.recommendations?.length||0} recommendations`);
    }catch(e){
      clearInterval(stepInt.current); setAnalysisError('Analysis failed. Please try again.'); setAnalyzing(false);
    }
  };

  // ── Decisions ──────────────────────────────────────────────────────────────
  const handleAccept=async(rec)=>{
    try{
      await saveDecision(rec.id, rec.title, 'accept', '');
      setDecisions(d=>({...d,[rec.id]:{decision:'accept',reason:''}}));
      showToast(`✓ Accepted: ${rec.title}`);
    }catch{}
  };

  const handleReject=async(reason)=>{
    if(!rejectTarget) return;
    try{
      await saveDecision(rejectTarget.id, rejectTarget.title, 'reject', reason);
      setDecisions(d=>({...d,[rejectTarget.id]:{decision:'reject',reason}}));
      showToast(`Rejected: ${rejectTarget.title}`);
    }catch{}
    setRejectTarget(null);
  };

  // ── Roadmap ────────────────────────────────────────────────────────────────
  const handleParseRoadmap=async()=>{
    setParsingRoadmap(true);
    try{
      const items=await parseRoadmap(roadmapFile,roadmapText);
      const arr=Array.isArray(items)?items:[];
      if(arr.length===0){
        showToast('No roadmap items found — try pasting text instead');
      } else {
        setRoadmapItems(arr);
        setRoadmapParsed(true);
        showToast(`✓ ${arr.length} roadmap items parsed`);
      }
    }catch(e){
      showToast('Parse failed: ' + (e.message||'unknown error'));
    }
    setParsingRoadmap(false);
  };

  // ── Logs ───────────────────────────────────────────────────────────────────
  const loadLogs=async()=>{
    setLogsLoading(true);
    try{ setLogs(await getLogs()); }catch{}
    setLogsLoading(false);
  };

  // ── Sessions ───────────────────────────────────────────────────────────────
  const handleSave=async()=>{
    setSaveStatus('saving');
    try{
      await saveSession({execSummary,themes,questions,researchGaps,recommendations,directorChallenges,rebuttals,finalSummary,roadmapItems,roadmapConflicts,strategicGaps,decisions});
      setSaveStatus('saved'); showToast('✓ Session saved');
      setTimeout(()=>setSaveStatus(''),2500);
    }catch{ setSaveStatus('error'); setTimeout(()=>setSaveStatus(''),2500); }
  };

  const loadSessions=async()=>{ setView('sessions'); try{ setSessions(await getSessions()); }catch{}};

  const loadSession=(s)=>{
    setExecSummary(s.execSummary||null); setThemes(s.themes||[]); setQuestions(s.questions||[]); setResearchGaps(s.researchGaps||[]);
    setRecommendations(s.recommendations||[]); setDirectorChallenges(s.directorChallenges||[]);
    setRebuttals(s.rebuttals||[]); setFinalSummary(s.finalSummary||'');
    setRoadmapItems(s.roadmapItems||[]); setRoadmapConflicts(s.roadmapConflicts||[]); setStrategicGaps(s.strategicGaps||[]);
    setDecisions(s.decisions||{}); setRoadmapParsed((s.roadmapItems||[]).length>0);
    setView('exec'); showToast('Session loaded');
  };

  const handleNavChange=(key)=>{
    setView(key);
    if(key==='logs') loadLogs();
    if(key==='sessions') loadSessions();
  };

  const committedCount = Object.values(decisions).filter(d=>d.decision==='accept').length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return(
    <div className="app">
      <Toast msg={toast}/>
      <DeleteModal doc={deleteTarget} onConfirm={confirmDelete} onCancel={()=>setDeleteTarget(null)}/>
      <RejectModal rec={rejectTarget} onConfirm={handleReject} onCancel={()=>setRejectTarget(null)}/>

      {/* Header */}
      <header className="header">
        <div className="logo-wrap">
          <div className="logo-mark">IE</div>
          <div><div className="logo-text">Insight Engine</div><div className="logo-sub">User Research Intelligence</div></div>
        </div>
        <div className="header-right">
          {committedCount>0&&<Badge cls="b-green" label={`✓ ${committedCount} committed`}/>}
          {hasThemes&&(
            <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saveStatus==='saving'}>
              {saveStatus==='saving'?'Saving...':saveStatus==='saved'?'✓ Saved':'Save Session'}
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        <LeftNav active={view} setActive={handleNavChange} hasThemes={hasThemes} hasAnalysis={hasAnalysis} docCount={documents.length} themeCount={themes.length} recCount={recommendations.length}/>

        <main className="main">

          {/* ── DOCUMENTS ── */}
          {view==='documents'&&(
            <div className="page fade-in">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
                <div>
                  <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Document Library</h1>
                  <p style={{fontSize:13,color:'var(--text-2)'}}>Upload feedback documents. Each is analyzed individually, then synthesized into a unified research model.</p>
                </div>
                <button className="btn btn-primary" onClick={handleSynthesize} disabled={synthesizing||documents.length===0}>
                  {synthesizing?<><span className="spin">⚙</span> Synthesizing...</>:'🔬 Synthesize Themes'}
                </button>
              </div>

              <div className="panel" style={{marginBottom:16}}>
                <div className={`drop-zone${dragOver?' over':''}`} onClick={()=>fileRef.current?.click()}
                  onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}>
                  <input ref={fileRef} type="file" multiple accept=".docx,.doc,.pdf,.txt,.md" style={{display:'none'}} onChange={e=>handleFiles(Array.from(e.target.files))}/>
                  <div className="dz-icon">{uploading?<span className="spin">⏳</span>:'📂'}</div>
                  <div className="dz-title">{uploading?'Processing...':'Drop files or click to browse'}</div>
                  <div className="dz-sub">Word, PDF, TXT · Multiple files</div>
                </div>
                {uploadStatus.map((f,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',fontSize:12,borderBottom:'1px solid var(--border)',marginTop:i===0?8:0}}>
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text-2)'}}>{f.name}</span>
                    <span style={{fontWeight:600,color:f.status==='done'?'var(--green)':f.status==='error'?'var(--red)':'var(--yellow)',fontSize:11}}>
                      {f.status==='processing'?<span className="pulse">Analyzing...</span>:f.status==='done'?'✓':'✗'}
                    </span>
                  </div>
                ))}
              </div>

              {synthesizing&&(
                <div className="progress-box">
                  <div className="progress-hd"><span className="spin">⚙</span> Synthesizing Research</div>
                  <div className="progress-msg">{SYNTH_MSGS[synthMsgIdx]}</div>
                  <div className="progress-elapsed">{synthElapsed}s elapsed</div>
                </div>
              )}
              {synthError&&<div style={{padding:'10px 12px',background:'var(--red-bg)',border:'1px solid var(--red-border)',borderRadius:'var(--r)',fontSize:13,color:'var(--red)',marginTop:10}}>✗ {synthError}</div>}

              {docsLoading&&<div style={{textAlign:'center',padding:40,color:'var(--text-3)'}}>Loading...</div>}
              {!docsLoading&&documents.length===0&&(
                <div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No documents yet</div><div className="empty-sub">Upload interview transcripts, survey responses, or support tickets.</div></div>
              )}
              {documents.map(doc=>(
                <div key={doc.id} className="doc-row">
                  <div className="doc-icon">{fileIcon(doc.name)}</div>
                  <div className="doc-body">
                    <div className="doc-name">{doc.name}</div>
                    <div className="doc-meta">{new Date(doc.created_at).toLocaleDateString()} · {doc.themes?.length||0} themes · {doc.key_source||'—'}</div>
                    {doc.document_summary&&<div className="doc-summary">{doc.document_summary}</div>}
                    {expandedDocs[doc.id]&&(doc.themes||[]).map(t=>(
                      <div key={t.id} style={{fontSize:11,color:'var(--text-2)',padding:'4px 6px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:4,marginTop:4}}>{t.customerProblem||t.id}</div>
                    ))}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <button className="btn-icon" onClick={()=>setExpandedDocs(p=>({...p,[doc.id]:!p[doc.id]}))}>{expandedDocs[doc.id]?'▲':'▼'}</button>
                    <button className="btn-icon red" onClick={()=>setDeleteTarget(doc)}>✕</button>
                  </div>
                </div>
              ))}

              {hasThemes&&!analyzing&&!hasAnalysis&&(
                <div className="info-banner banner-blue" style={{marginTop:16}}>
                  <div><div className="banner-title">✓ {themes.length} themes ready</div><div className="banner-sub">Run the 6-agent analysis to generate recommendations</div></div>
                  <button className="btn btn-primary" onClick={()=>{setView('recommendations');handleAnalyze();}}>Run Analysis →</button>
                </div>
              )}
            </div>
          )}

          {/* ── EXEC SUMMARY ── */}
          {view==='exec'&&(
            <div className="page fade-in">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
                <div><h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Executive Summary</h1><p style={{fontSize:13,color:'var(--text-2)'}}>Research overview for {documents.length} documents</p></div>
                {!hasAnalysis&&!analyzing&&<button className="btn btn-primary" onClick={handleAnalyze}>{analyzing?<><span className="spin">⚙</span> {analysisStep}</>:'Run Full Analysis →'}</button>}
              </div>

              {analyzing&&<div className="info-banner banner-blue" style={{marginBottom:16}}><div><div className="banner-title"><span className="spin">⚙</span> {analysisStep}</div><div className="banner-sub">6 agents · 2-4 minutes</div></div></div>}

              {execSummary?(
                <div className="exec-card">
                  <div className="exec-label">Research Narrative</div>
                  <div className="exec-narrative">{execSummary.narrative}</div>
                  <div className="exec-grid">
                    <div className="exec-cell">
                      <div className="exec-cell-label">How Research Was Conducted</div>
                      <div className="exec-cell-val">{execSummary.researchMethod}</div>
                    </div>
                    <div className="exec-cell">
                      <div className="exec-cell-label">Key Learning</div>
                      <div className="exec-cell-val">{execSummary.keyLearning}</div>
                    </div>
                    <div className="exec-cell">
                      <div className="exec-cell-label">Confidence</div>
                      <div style={{marginBottom:4}}><Badge cls={CERT_BADGE[execSummary.confidence]?.cls||'b-gray'} label={CERT_BADGE[execSummary.confidence]?.label||execSummary.confidence}/></div>
                      <div className="exec-cell-val" style={{fontSize:12,color:'var(--text-2)'}}>{execSummary.confidenceRationale}</div>
                    </div>
                  </div>
                </div>
              ):(
                <div className="exec-card" style={{textAlign:'center',padding:40}}>
                  <div style={{fontSize:32,marginBottom:10}}>🔬</div>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--text-2)',marginBottom:6}}>No research synthesized yet</div>
                  <div style={{fontSize:13,color:'var(--text-3)',marginBottom:16}}>Upload documents and click Synthesize Themes to generate the exec summary.</div>
                  <button className="btn btn-primary" onClick={()=>setView('documents')}>Go to Documents →</button>
                </div>
              )}

              {hasAnalysis&&(
                <div style={{marginTop:16,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                  {['P0','P1','P2'].map(p=>{
                    const recs=recommendations.filter(r=>r.priority===p);
                    if(!recs.length) return null;
                    const s=PRIORITY_STYLE[p];
                    const isOpen=expandedPriority[p];
                    return <div key={p} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)',overflow:'hidden'}}>
                      <div style={{padding:'12px 16px',textAlign:'center',cursor:'pointer',userSelect:'none'}} onClick={()=>setExpandedPriority(prev=>({...prev,[p]:!prev[p]}))}>
                        <div className={`p-tag ${s.cls}`} style={{fontSize:18,padding:'4px 12px',marginBottom:4,display:'inline-flex'}}>{s.label}</div>
                        <div style={{fontSize:24,fontWeight:800,color:'var(--text-1)'}}>{recs.length}</div>
                        <div style={{fontSize:11,color:'var(--text-3)',textTransform:'uppercase',fontWeight:600}}>Recommendations</div>
                        <div style={{fontSize:11,color:'var(--text-3)',marginTop:4}}>{isOpen?'▲ Hide':'▼ Show'}</div>
                      </div>
                      {isOpen&&(
                        <div style={{borderTop:'1px solid var(--border)',background:'var(--surface-2)'}} className="fade-in">
                          {recs.map(r=>(
                            <div key={r.id} style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>{setView('recommendations');}}>
                              <div style={{fontSize:13,fontWeight:600,color:'var(--text-1)',marginBottom:2}}>#{r.stackRank} {r.title}</div>
                              {r.fin?.headline&&<div style={{fontSize:11,color:'var(--green)'}}>{r.fin.headline}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>;
                  })}
                </div>
              )}

              {committedCount>0&&(
                <div style={{marginTop:12,background:'var(--green-bg)',border:'1px solid var(--green-border)',borderRadius:'var(--r)',padding:'12px 16px'}}>
                  <div style={{fontWeight:700,color:'var(--green)',marginBottom:4}}>✓ {committedCount} Committed</div>
                  {recommendations.filter(r=>decisions[r.id]?.decision==='accept').map(r=>(
                    <div key={r.id} style={{fontSize:13,color:'#166534',padding:'3px 0'}}>• {r.title}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── THEMES ── */}
          {view==='themes'&&(
            <div className="page fade-in">
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Research Themes</h1>
              <p style={{fontSize:13,color:'var(--text-2)',marginBottom:20}}>{themes.length} themes synthesized across {documents.length} documents</p>

              {themes.map(t=>{
                const cB=CERT_BADGE[t.certainty]||CERT_BADGE.medium;
                const isExpanded=expandedThemes[t.id];
                const hasUnknowns=(t.unknowns||[]).length>0;
                return(
                  <div key={t.id} className="theme-card">
                    {/* Collapsed header — always visible */}
                    <div className="theme-header" onClick={()=>setExpandedThemes(p=>({...p,[t.id]:!p[t.id]}))}>
                      <div>
                        <div className="theme-problem">{t.customerProblem}</div>
                        {t.customerWho&&<div style={{fontSize:12,color:'var(--text-2)',marginTop:4}}>👤 {t.customerWho}</div>}
                      </div>
                      <span className="theme-expand-icon">{isExpanded?'▲':'▼'}</span>
                    </div>
                    <div className="theme-summary-row">
                      <Badge cls={cB.cls} label={cB.label}/>
                      {t.sourceMix&&<Badge cls="b-gray" label={`${t.sourceCount||'?'} sources · ${t.sourceMix}`}/>}
                    </div>

                    {/* Expanded detail */}
                    {isExpanded&&(
                      <div className="fade-in">
                        <div className="theme-grid">
                          <div className="tc">
                            <div className="tc-label">Problem Detail</div>
                            <div className="tc-val">{t.description}</div>
                          </div>
                          <div className="tc">
                            <div className="tc-label">Who Is The Customer</div>
                            <div className="tc-val">{t.customerWho||'—'}</div>
                          </div>
                          <div className="tc">
                            <div className="tc-label">Amazon Positioning</div>
                            <div className="tc-val">{t.amazonPositioned==='yes'?'Uniquely Positioned':t.amazonPositioned==='partially'?'Partially Positioned':'Not Differentiated'}</div>
                            <div className="tc-sub">{t.amazonPositionedRationale}</div>
                          </div>
                          <div className="tc">
                            <div className="tc-label">Certainty</div>
                            <div style={{marginBottom:4}}><Badge cls={cB.cls} label={cB.label}/></div>
                            {t.followUpNeeded?<div className="tc-sub" style={{color:'var(--yellow)'}}>⚠ {t.followUpNeeded}</div>:<div className="tc-sub" style={{color:'var(--green)'}}>✓ Well understood</div>}
                          </div>
                        </div>

                        {/* VOC — compacted */}
                        {(t.quotes||[]).length>0&&(
                          <div className="voc-section">
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setExpandedVOC(p=>({...p,[t.id]:!p[t.id]}))}>
                              <div style={{fontSize:11,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Voice of Customer ({t.quotes.length})</div>
                              <span style={{fontSize:11,color:'var(--text-3)'}}>{expandedVOC[t.id]?'▲ Hide':'▼ Show'}</span>
                            </div>
                            {expandedVOC[t.id]&&(t.quotes||[]).map((q,i)=>(
                              <div key={i} className="voc-quote">"{q}"</div>
                            ))}
                          </div>
                        )}

                        {/* Unknowns — compacted */}
                        {hasUnknowns&&(
                          <>
                            <div className="unknowns-section" onClick={()=>setExpandedUnknowns(p=>({...p,[t.id]:!p[t.id]}))}>
                              <div style={{fontSize:11,fontWeight:700,color:'#92400e',textTransform:'uppercase',letterSpacing:'.06em'}}>⚠ Unknowns & Areas to Investigate ({t.unknowns.length})</div>
                              <span style={{fontSize:11,color:'#a16207'}}>{expandedUnknowns[t.id]?'▲ Hide':'▼ Show'}</span>
                            </div>
                            {expandedUnknowns[t.id]&&(
                              <div className="unknowns-body fade-in">
                                {t.unknowns.map((u,i)=><div key={i} style={{fontSize:13,color:'#78350f',marginBottom:4}}>· {u}</div>)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {researchGaps.length>0&&(
                <div style={{padding:'12px 14px',background:'var(--yellow-bg)',border:'1px solid #fde68a',borderRadius:'var(--r)',marginTop:8}}>
                  <div style={{fontWeight:700,color:'#92400e',marginBottom:6,fontSize:13}}>⚠ Research Gaps</div>
                  {researchGaps.map((g,i)=><div key={i} style={{fontSize:13,color:'#78350f',marginBottom:2}}>· {g}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ── FOLLOW-UP ── */}
          {view==='followup'&&(
            <div className="page fade-in" key={synthKey}>
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Follow-up Questions</h1>
              <p style={{fontSize:13,color:'var(--text-2)',marginBottom:20}}>Ask these in your next research session to close gaps and strengthen weak signals.</p>
              {questions.map((q,i)=>(
                <div key={i} className="theme-card" style={{padding:0,marginBottom:12}}>
                  <div style={{padding:'14px 16px',display:'flex',gap:14}}>
                    <span style={{fontSize:20,fontWeight:800,color:'var(--text-4)',flexShrink:0,lineHeight:1.3}}>{String(i+1).padStart(2,'0')}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,color:'var(--text-1)',fontWeight:600,lineHeight:1.5,marginBottom:10}}>{q.question||q}</div>
                      {(q.whatWeKnow||q.whatWeNeedToLearn)&&(
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                          {q.whatWeKnow&&(
                            <div style={{background:'var(--green-bg)',border:'1px solid var(--green-border)',borderRadius:'var(--r)',padding:'8px 10px'}}>
                              <div style={{fontSize:10,fontWeight:700,color:'var(--green)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>What We Know</div>
                              <div style={{fontSize:12,color:'#166534',lineHeight:1.5}}>{q.whatWeKnow}</div>
                            </div>
                          )}
                          {q.whatWeNeedToLearn&&(
                            <div style={{background:'var(--yellow-bg)',border:'1px solid #fde68a',borderRadius:'var(--r)',padding:'8px 10px'}}>
                              <div style={{fontSize:10,fontWeight:700,color:'var(--yellow)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>What We Need To Learn</div>
                              <div style={{fontSize:12,color:'#92400e',lineHeight:1.5}}>{q.whatWeNeedToLearn}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── RECOMMENDATIONS ── */}
          {view==='recommendations'&&(
            <div className="page fade-in">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                <div>
                  <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Recommendations</h1>
                  <p style={{fontSize:13,color:'var(--text-2)'}}>Stack-ranked by combined PM + Finance score</p>
                </div>
                {!hasAnalysis&&!analyzing&&hasThemes&&(
                  <button className="btn btn-primary" onClick={handleAnalyze}>Run Analysis →</button>
                )}
              </div>

              {analyzing&&<div className="info-banner banner-blue" style={{marginBottom:16}}><div><div className="banner-title"><span className="spin">⚙</span> {analysisStep}</div><div className="banner-sub">6 agents · 2-4 minutes</div></div></div>}
              {analysisError&&<div style={{padding:'10px 12px',background:'var(--red-bg)',border:'1px solid var(--red-border)',borderRadius:'var(--r)',fontSize:13,color:'var(--red)',marginBottom:12}}>✗ {analysisError}</div>}

              {hasAnalysis&&(
                <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                  {['P0','P1','P2','Cut'].map(p=>{
                    const count=recommendations.filter(r=>r.priority===p).length;
                    if(!count) return null;
                    const s=PRIORITY_STYLE[p];
                    return <span key={p} className={`p-tag ${s.cls}`}>{s.label} · {count}</span>;
                  })}
                  {committedCount>0&&<Badge cls="b-green" label={`✓ ${committedCount} accepted`}/>}
                </div>
              )}

              {recommendations.map((r,idx)=>{
                const ps=PRIORITY_STYLE[r.priority]||PRIORITY_STYLE.P2;
                const tB=TYPE_BADGE[r.projectType]||TYPE_BADGE.revenue;
                const eng=r.eng||{};
                const fin=r.fin||{};
                const cxB=COMPLEXITY[eng.complexity];
                const dec=decisions[r.id];
                const challenges=directorChallenges.filter(c=>c.recommendationId===r.id);

                return(
                  <div key={r.id} className={`rec-card${dec?.decision==='accept'?' accepted':dec?.decision==='reject'?' rejected':''}`}>
                    <div className="rec-top">
                      <div className="rec-rank">#{r.stackRank||idx+1}</div>
                      <div className="rec-main">
                        <div className="rec-title">{r.title}</div>
                        <div className="rec-tags">
                          <span className={`p-tag ${ps.cls}`}>{ps.label}</span>
                          <Badge cls={tB.cls} label={tB.label}/>
                          {cxB&&<Badge cls={cxB.cls} label={cxB.label}/>}
                          {eng.effortWeeks&&<Badge cls="b-gray" label={`⏱ ${eng.effortWeeks}`}/>}
                          {fin.headline&&<Badge cls="b-green" label={`💰 ${fin.headline}`}/>}
                        </div>
                      </div>
                    </div>

                    <div className="rec-scores">
                      <div className="score-cell" style={{cursor:'pointer'}} onClick={()=>setExpandedScores(p=>({...p,[`${r.id}-uv`]:!p[`${r.id}-uv`]}))}>
                        <div className="score-val" style={{color:'var(--blue)'}}>{r.userValue}/10</div>
                        <div className="score-label">User Value ▾</div>
                        {expandedScores[`${r.id}-uv`]&&<div style={{fontSize:11,color:'var(--text-2)',marginTop:4,lineHeight:1.5,textAlign:'left'}} className="fade-in">How strongly users expressed this need across research sources.</div>}
                      </div>
                      <div className="score-cell" style={{cursor:'pointer'}} onClick={()=>setExpandedScores(p=>({...p,[`${r.id}-sf`]:!p[`${r.id}-sf`]}))}>
                        <div className="score-val" style={{color:'var(--purple)'}}>{r.strategicFit}/10</div>
                        <div className="score-label">Strategic Fit ▾</div>
                        {expandedScores[`${r.id}-sf`]&&<div style={{fontSize:11,color:'var(--text-2)',marginTop:4,lineHeight:1.5,textAlign:'left'}} className="fade-in">Alignment with business goals, Amazon positioning, and competitive advantage.</div>}
                      </div>
                      <div className="score-cell" style={{cursor:'pointer'}} onClick={()=>setExpandedScores(p=>({...p,[`${r.id}-cf`]:!p[`${r.id}-cf`]}))}>
                        <div className="score-val" style={{color:'#0891b2'}}>{r.confidenceScore}/10</div>
                        <div className="score-label">Confidence ▾</div>
                        {expandedScores[`${r.id}-cf`]&&<div style={{fontSize:11,color:'var(--text-2)',marginTop:4,lineHeight:1.5,textAlign:'left'}} className="fade-in">Strength of evidence from research — signal clarity, source count, quote quality.</div>}
                      </div>
                    </div>

                    <div className="rec-section">
                      <div className="rec-label">Customer Problem This Solves</div>
                      <div className="problem-box">{r.customerProblemSolved}</div>
                    </div>
                    <div className="rec-section">
                      <div className="rec-label">What to Build</div>
                      <div className="rec-text">{r.rationale}</div>
                    </div>
                    <div className="rec-section">
                      <div className="rec-label">Minimum Lovable Product</div>
                      <div className="mlp-box">{r.mlp}</div>
                    </div>

                    {r.risks?.length>0&&(
                      <div className="rec-section">
                        <div className="rec-label">Risks</div>
                        {r.risks.map((risk,i)=>(
                          <div key={i} className="risk-row"><span className="risk-icon">⚠</span><span>{risk}</span></div>
                        ))}
                      </div>
                    )}

                    {challenges.length>0&&(
                      <div className="rec-section">
                        <div className="rec-label">Director Feedback</div>
                        {challenges.map((c,ci)=>{
                          const key=`${r.id}-${ci}`;
                          const isOpen=expandedChallenges[key];
                          const rb=rebuttals.find(rb=>rb.recommendationId===r.id&&rb.challengeIndex===directorChallenges.indexOf(c));
                          const sbB=rb?STANCE_BADGE[rb.stance]:null;
                          return(
                            <div key={ci} className="challenge-wrap">
                              <div className="challenge-hd" onClick={()=>setExpandedChallenges(p=>({...p,[key]:!p[key]}))}>
                                <Badge cls={c.isBlocker?'b-red':'b-yellow'} label={c.isBlocker?'🚫 Blocker':'⚠ Non-blocker'}/>
                                <Badge cls="b-gray" label={c.category}/>
                                {sbB&&<Badge cls={sbB.cls} label={sbB.label}/>}
                                <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-3)'}}>{isOpen?'▲ Hide':'▼ Show'}</span>
                              </div>
                              {isOpen&&(
                                <div className="challenge-body fade-in">
                                  <div className="challenge-text">{c.feedback}</div>
                                  {c.context&&<div className="challenge-ctx">{c.context}</div>}
                                  {rb&&(
                                    <div className="rebuttal-box">
                                      {sbB&&<Badge cls={sbB.cls} label={sbB.label}/>}
                                      <div style={{marginTop:4}}>{rb.response}</div>
                                      {rb.revisedTitle&&<div style={{fontSize:11,color:'var(--yellow)',marginTop:4,fontStyle:'italic'}}>→ Revised to: {rb.revisedTitle}</div>}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Accept / Reject */}
                    <div className="decision-bar">
                      {!dec&&(
                        <>
                          <button className="btn btn-accept btn-sm" onClick={()=>handleAccept(r)}>✓ Accept</button>
                          <button className="btn btn-reject btn-sm" onClick={()=>setRejectTarget(r)}>✗ Reject</button>
                        </>
                      )}
                      {dec?.decision==='accept'&&<span className="d-accepted">✓ Accepted</span>}
                      {dec?.decision==='reject'&&<><span className="d-rejected">✗ Rejected</span>{dec.reason&&<span className="decision-reason">"{dec.reason}"</span>}</>}
                      {dec&&<button className="btn-ghost" onClick={()=>setDecisions(d=>{const nd={...d};delete nd[r.id];return nd;})}>Undo</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── FINANCIAL MODEL ── */}
          {view==='financial'&&(
            <div className="page fade-in">
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Financial Model</h1>
              <p style={{fontSize:13,color:'var(--text-2)',marginBottom:20}}>Review and refine the financial model for each recommendation. Edit assumptions and recalculate.</p>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}>
                {recommendations.filter(r=>r.fin).map(r=>(
                  <button key={r.id} className={`btn ${activeModelRec?.id===r.id?'btn-primary':'btn-secondary'} btn-sm`} onClick={()=>setActiveModelRec(r)}>
                    #{r.stackRank} {r.title.slice(0,28)}{r.title.length>28?'...':''}
                  </button>
                ))}
              </div>
              {activeModelRec
                ?<FinanceModel key={activeModelRec.id} recommendation={activeModelRec}/>
                :recommendations.filter(r=>r.fin).length>0
                  ?<div style={{fontSize:13,color:'var(--text-3)',textAlign:'center',padding:40}}>Select a recommendation above</div>
                  :<div className="empty"><div className="empty-icon">💰</div><div className="empty-title">No models yet</div><div className="empty-sub">Run the full analysis to generate financial models.</div></div>
              }
            </div>
          )}

          {/* ── AGENT REVIEW ── */}
          {view==='agentreview'&&(
            <div className="page fade-in">
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Agent Review</h1>
              <div style={{background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'12px 16px',marginBottom:20,fontSize:13,color:'var(--text-2)',lineHeight:1.6}}>
                <strong style={{color:'var(--text-1)'}}>What happened here:</strong> After PM, Engineer, Finance, and GTM agents completed their work, the Director reviewed every recommendation and raised specific challenges. The PM then responded — defending with evidence, revising, or conceding. This tab is your record of that deliberation.
              </div>
              {finalSummary&&(
                <div style={{background:'var(--green-bg)',border:'1px solid var(--green-border)',borderRadius:'var(--r)',padding:'12px 16px',marginBottom:16}}>
                  <div style={{fontWeight:700,color:'var(--green)',marginBottom:6,fontSize:13}}>PM Final Statement</div>
                  <div style={{fontSize:13,color:'#166534',lineHeight:1.7}}>{finalSummary}</div>
                </div>
              )}
              <div className="section-hd">All Director Challenges</div>
              {directorChallenges.map((c,i)=>{
                const rec=recommendations.find(r=>r.id===c.recommendationId);
                const rb=rebuttals.find(r=>r.challengeIndex===i);
                const sbB=rb?STANCE_BADGE[rb.stance]:null;
                const key=`rev-${i}`;
                const isOpen=expandedChallenges[key];
                return(
                  <div key={i} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)',marginBottom:8,overflow:'hidden'}}>
                    <div style={{padding:'10px 14px',background:'var(--surface-2)',cursor:'pointer',display:'flex',alignItems:'center',gap:8}} onClick={()=>setExpandedChallenges(p=>({...p,[key]:!p[key]}))}>
                      {rec&&<span style={{fontSize:11,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase'}}>#{rec.stackRank} {rec.title.slice(0,24)}...</span>}
                      <Badge cls={c.isBlocker?'b-red':'b-yellow'} label={c.isBlocker?'Blocker':'Non-blocker'}/>
                      <Badge cls="b-gray" label={c.category}/>
                      {sbB&&<Badge cls={sbB.cls} label={sbB.label}/>}
                      <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-3)'}}>{isOpen?'▲':'▼'}</span>
                    </div>
                    {isOpen&&(
                      <div style={{padding:'12px 14px'}} className="fade-in">
                        <div style={{fontWeight:600,fontSize:13,color:'var(--text-1)',marginBottom:6,lineHeight:1.6}}>{c.feedback}</div>
                        {c.context&&<div style={{fontSize:12,color:'var(--text-2)',lineHeight:1.6,padding:'6px 8px',background:'var(--surface-2)',borderRadius:4,marginBottom:8}}>{c.context}</div>}
                        {rb&&<div className="rebuttal-box">{sbB&&<Badge cls={sbB.cls} label={sbB.label}/>}<div style={{marginTop:4}}>{rb.response}</div></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── ROADMAP ── */}
          {view==='roadmap'&&(
            <div className="page fade-in">
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Roadmap</h1>
              <p style={{fontSize:13,color:'var(--text-2)',marginBottom:20}}>Compare your current roadmap against research findings.</p>

              {/* Current roadmap */}
              {roadmapParsed?(
                <div className="panel" style={{marginBottom:20}}>
                  <div className="panel-hd">
                    <span className="panel-title">Current Roadmap ({roadmapItems.length} items)</span>
                    <button className="btn btn-secondary btn-xs" onClick={()=>{setRoadmapParsed(false);setRoadmapItems([]);}}>Change</button>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead>
                      <tr style={{borderBottom:'2px solid var(--border)'}}>
                        <th style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Initiative</th>
                        <th style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',width:100}}>Quarter</th>
                        <th style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',width:80}}>Effort</th>
                        <th style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',width:120}}>Impact</th>
                        <th style={{textAlign:'left',padding:'6px 10px',fontSize:10,fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.06em',width:80}}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roadmapItems.map((r,i)=>(
                        <tr key={r.id} style={{borderBottom:'1px solid var(--border)',background:i%2===0?'var(--surface)':'var(--surface-2)'}}>
                          <td style={{padding:'8px 10px',fontWeight:500,color:'var(--text-1)'}}>
                            {r.item}
                            {r.description&&<div style={{fontSize:11,color:'var(--text-3)',marginTop:2}}>{r.description}</div>}
                          </td>
                          <td style={{padding:'8px 10px',color:'var(--text-2)'}}>{r.quarter||'—'}</td>
                          <td style={{padding:'8px 10px'}}>{r.effort?<Badge cls="b-gray" label={r.effort}/>:'—'}</td>
                          <td style={{padding:'8px 10px',color:r.impact?'var(--green)':'var(--text-3)',fontSize:12,fontWeight:r.impact?600:400}}>{r.impact||'—'}</td>
                          <td style={{padding:'8px 10px'}}><Badge cls={r.status==='shipped'?'b-green':r.status==='in-progress'?'b-yellow':r.status==='planned'?'b-blue':'b-gray'} label={r.status||'unknown'}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ):(
                <div className="panel" style={{marginBottom:20}}>
                  <div className="panel-hd"><span className="panel-title">Current Roadmap</span></div>
                  <div style={{marginBottom:10}}>
                    <div className="drop-zone" style={{padding:12}} onClick={()=>roadmapRef.current?.click()}>
                      <input ref={roadmapRef} type="file" accept=".docx,.pdf,.txt,.md" style={{display:'none'}} onChange={e=>{setRoadmapFile(e.target.files[0]);setRoadmapText('');}}/>
                      <div style={{fontSize:13,color:roadmapFile?'var(--green)':'var(--text-2)',fontWeight:600}}>{roadmapFile?`✓ ${roadmapFile.name}`:'Upload roadmap file'}</div>
                    </div>
                    <div style={{textAlign:'center',fontSize:11,color:'var(--text-3)',margin:'6px 0'}}>or paste text</div>
                    <textarea value={roadmapText} onChange={e=>{setRoadmapText(e.target.value);setRoadmapFile(null);}} placeholder="Q3 Roadmap&#10;- Feature A&#10;- Feature B" style={{minHeight:80,fontSize:12}}/>
                  </div>
                  <button className="btn btn-secondary" style={{width:'100%'}} onClick={handleParseRoadmap} disabled={parsingRoadmap||(!roadmapFile&&!roadmapText.trim())}>
                    {parsingRoadmap?<><span className="spin">⚙</span> Parsing...</>:'Parse Roadmap'}
                  </button>
                </div>
              )}

              {/* Gaps & conflicts from analysis */}
              {strategicGaps.length>0&&(
                <>
                  <div className="section-hd">Strategic Gaps — Not on your roadmap</div>
                  {strategicGaps.map((g,i)=>(
                    <div key={i} style={{background:'var(--surface)',border:'1px solid var(--border)',borderLeft:'3px solid var(--purple)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}>
                        <div style={{fontWeight:600}}>◈ {g.title}</div>
                        <Badge cls={g.urgency==='high'?'b-red':g.urgency==='medium'?'b-yellow':'b-gray'} label={g.urgency}/>
                      </div>
                      <div style={{fontSize:13,color:'var(--text-2)'}}>{g.evidence}</div>
                    </div>
                  ))}
                  <div className="divider"/>
                </>
              )}
              {roadmapConflicts.length>0&&(
                <>
                  <div className="section-hd">Conflicts</div>
                  {roadmapConflicts.map((c,i)=>{
                    const item=roadmapItems.find(r=>r.id===c.roadmapItemId);
                    return(
                      <div key={i} style={{background:'var(--surface)',border:'1px solid var(--border)',borderLeft:'3px solid var(--red)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}>
                          <div style={{fontWeight:600}}>{item?.item||`Item ${c.roadmapItemId}`}</div>
                          <Badge cls="b-red" label={c.recommendation}/>
                        </div>
                        <div style={{fontSize:13,color:'var(--text-2)'}}>{c.issue}</div>
                      </div>
                    );
                  })}
                </>
              )}
              {!roadmapParsed&&strategicGaps.length===0&&roadmapConflicts.length===0&&(
                <div className="empty"><div className="empty-icon">🗺</div><div className="empty-title">No roadmap data yet</div><div className="empty-sub">Upload your roadmap above, then run analysis to see gaps and conflicts.</div></div>
              )}
            </div>
          )}

          {/* ── SESSIONS ── */}
          {view==='sessions'&&(
            <div className="page fade-in">
              <h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Saved Sessions</h1>
              <p style={{fontSize:13,color:'var(--text-3)',marginBottom:22}}>Load a previous session to continue your work.</p>
              {sessions.length===0&&<div className="empty"><div className="empty-icon">💾</div><div className="empty-title">No saved sessions</div><div className="empty-sub">Run an analysis and save it to store your work.</div></div>}
              {sessions.map(s=>(
                <div key={s.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
                  <div>
                    <div style={{fontWeight:600,marginBottom:3}}>{new Date(s.created_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
                    <div style={{fontSize:12,color:'var(--text-3)'}}>{s.themes?.length||0} themes · {s.recommendations?.length||0} recommendations</div>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-primary btn-sm" onClick={()=>loadSession(s)}>Load</button>
                    <button className="btn-ghost" style={{color:'var(--red)'}} onClick={()=>deleteSession(s.id).then(()=>setSessions(ss=>ss.filter(x=>x.id!==s.id)))}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── LOGS ── */}
          {view==='logs'&&(
            <div className="page fade-in">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                <div><h1 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Activity Log</h1><p style={{fontSize:13,color:'var(--text-2)'}}>All changes recorded to database</p></div>
                <button className="btn btn-secondary btn-sm" onClick={loadLogs}>↻ Refresh</button>
              </div>
              {logsLoading&&<div style={{textAlign:'center',padding:40,color:'var(--text-3)'}}>Loading...</div>}
              {!logsLoading&&logs.length===0&&<div className="empty"><div className="empty-icon">📜</div><div className="empty-title">No logs yet</div><div className="empty-sub">Actions are recorded here as you use the tool.</div></div>}
              <div className="panel" style={{padding:0}}>
                {logs.map((log,i)=>(
                  <div key={log.id||i} className="log-row" style={{padding:'10px 16px'}}>
                    <div className="log-time">{new Date(log.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
                    <div style={{flex:1}}>
                      <div className="log-action" style={{marginBottom:2}}>{log.action?.replace(/_/g,' ').toUpperCase()}</div>
                      <div className="log-detail">{log.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
