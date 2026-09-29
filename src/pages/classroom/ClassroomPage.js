/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { upload as blobUpload } from '@vercel/blob/client';
import styles from './ClassroomPage.module.css';
import { API } from '../../lib/api';


// Files upload straight to Vercel Blob from the browser (serverless functions
// cap request bodies well under the 50MB this app allows) — this only sends
// metadata to our API, never the file bytes.
async function uploadFilesToBlob(classroomId, files) {
  if (!files || files.length === 0) return [];
  return Promise.all(
    files.map(async (file) => {
      const blob = await blobUpload(file.name, file, {
        access: 'public',
        handleUploadUrl: `${API}/api/classrooms/${classroomId}/blob-upload`,
      });
      return { name: file.name, url: blob.url, pathname: blob.pathname, size: file.size, mime: file.type };
    }),
  );
}

const THEMES = {
  cyan:   { accent:'#00e5ff', bg:'linear-gradient(135deg,#020c14 0%,#061828 60%,#0a2438 100%)', border:'rgba(0,229,255,0.2)', muted:'rgba(0,229,255,0.1)', glow:'rgba(0,229,255,0.12)', card:'rgba(0,229,255,0.05)' },
  violet: { accent:'#b197fc', bg:'linear-gradient(135deg,#06030f 0%,#110824 60%,#1c0f3a 100%)', border:'rgba(177,151,252,0.2)', muted:'rgba(177,151,252,0.1)', glow:'rgba(177,151,252,0.12)', card:'rgba(177,151,252,0.05)' },
  green:  { accent:'#10e88a', bg:'linear-gradient(135deg,#020c08 0%,#051a10 60%,#082818 100%)', border:'rgba(16,232,138,0.2)', muted:'rgba(16,232,138,0.1)', glow:'rgba(16,232,138,0.12)', card:'rgba(16,232,138,0.05)' },
  amber:  { accent:'#ffbe3c', bg:'linear-gradient(135deg,#0e0902 0%,#1c1205 60%,#2a1c08 100%)', border:'rgba(255,190,60,0.2)',  muted:'rgba(255,190,60,0.1)',  glow:'rgba(255,190,60,0.12)',  card:'rgba(255,190,60,0.05)' },
  rose:   { accent:'#ff7eb3', bg:'linear-gradient(135deg,#0e0208 0%,#1c0412 60%,#2a061c 100%)', border:'rgba(255,126,179,0.2)', muted:'rgba(255,126,179,0.1)', glow:'rgba(255,126,179,0.12)', card:'rgba(255,126,179,0.05)' },
};

const fmtSize  = b => b>1e6?`${(b/1e6).toFixed(1)} MB`:b>1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
const fmtDate  = d => d?new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
const fmtTime  = d => d?new Date(d).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
const fmtRel   = d => { if(!d) return ''; const s=(Date.now()-new Date(d))/1000; if(s<60) return 'just now'; if(s<3600) return `${Math.floor(s/60)}m ago`; if(s<86400) return `${Math.floor(s/3600)}h ago`; return fmtDate(d); };
const fmtDur   = (s,e) => { if(!s||!e) return '—'; const m=Math.round((new Date(e)-new Date(s))/60000); return m<60?`${m}m`:`${Math.floor(m/60)}h ${m%60}m`; };
const isOverdue= d => d && new Date(d)<new Date();
const isSoon   = d => d && !isOverdue(d) && (new Date(d)-Date.now())<172800000;
const pct      = (a,b) => b?Math.round((a/b)*100):0;
const gradeColor=g => g>=90?'#10e88a':g>=80?'#60a5fa':g>=70?'#ffbe3c':g>=60?'#fb923c':'#ff4a5e';
const gradeLetter=g => g>=90?'A':g>=80?'B':g>=70?'C':g>=60?'D':'F';
const avatarBg = name=>{const h=[...(name||'?')].reduce((a,c)=>a+c.charCodeAt(0),0)%360;return`hsl(${h},50%,38%)`;};
const fileIcon = mime=>{
  if(!mime) return '📎';
  if(mime.startsWith('image/')) return '🖼️';
  if(mime.startsWith('video/')) return '🎬';
  if(mime.startsWith('audio/')) return '🎵';
  if(mime.includes('pdf'))      return '📄';
  if(mime.includes('word')||mime.includes('document')) return '📝';
  if(mime.includes('sheet')||mime.includes('excel'))   return '📊';
  if(mime.includes('zip')||mime.includes('rar'))       return '🗜️';
  if(mime.includes('presentation')||mime.includes('powerpoint')) return '📊';
  return '📎';
};
function getUserId(){let id=localStorage.getItem('qm_userId');if(!id){id=crypto.randomUUID();localStorage.setItem('qm_userId',id);}return id;}

// ── Tiny reusable UI ────────────────────────────────────────────────────────────
function Avatar({name,size=34}){
  return <div style={{width:size,height:size,borderRadius:'50%',background:avatarBg(name),color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.round(size*.38),fontWeight:800,flexShrink:0,textTransform:'uppercase',boxShadow:'0 0 0 2px rgba(255,255,255,0.08)'}}>{(name||'?')[0]}</div>;
}
function StatCard({icon,label,value,color='#64748b',sub,onClick}){
  return <div className={styles.statCard} onClick={onClick} style={{cursor:onClick?'pointer':undefined}}><div className={styles.statIcon} style={{background:`${color}18`,border:`1px solid ${color}30`,color}}>{icon}</div><div className={styles.statBody}><div className={styles.statValue} style={{color}}>{value}</div><div className={styles.statLabel}>{label}</div>{sub&&<div className={styles.statSub}>{sub}</div>}</div></div>;
}
function GradeBar({value,max=100,thin}){
  const p=Math.min(Math.round((value/max)*100),100);const c=gradeColor(p);
  return <div className={styles.gradeBarWrap}><div className={styles.gradeBarTrack} style={thin?{height:3}:{}}><div className={styles.gradeBarFill} style={{width:`${p}%`,background:c}}/></div>{!thin&&<span style={{fontSize:10,fontWeight:700,color:c,minWidth:30,textAlign:'right',fontFamily:'var(--font-mono)'}}>{p}%</span>}</div>;
}
function FileCard({file,classroomId,onRemove}){
  const href=file.url?`${API}/api/classrooms/${classroomId}/download?url=${encodeURIComponent(file.url)}`:undefined;
  return <a className={styles.fileCard} href={href} target="_blank" rel="noreferrer" onClick={!href?e=>e.preventDefault():undefined}>
    <span className={styles.fileCardIcon}>{fileIcon(file.mime||file.type)}</span>
    <div className={styles.fileCardInfo}><span className={styles.fileCardName}>{file.name}</span>{file.size&&<span className={styles.fileCardSize}>{fmtSize(file.size)}</span>}</div>
    {href&&<span className={styles.fileCardDl}>↓</span>}
    {onRemove&&<button className={styles.fileCardRemove} onClick={e=>{e.preventDefault();e.stopPropagation();onRemove();}}>✕</button>}
  </a>;
}
function FileDrop({files,setFiles,label='Drop files or click to attach'}){
  const ref=useRef(null);const[drag,setDrag]=useState(false);
  const add=list=>setFiles(p=>[...p,...Array.from(list).filter(f=>!p.find(x=>x.name===f.name&&x.size===f.size))]);
  return <div>
    <div className={`${styles.fileDropzone} ${drag?styles.fileDropzoneDragging:''}`}
      onClick={()=>ref.current?.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);add(e.dataTransfer.files);}}>
      <div className={styles.fileDropzoneText}><span>📎</span><span>{label} — <strong>Browse</strong></span><small>Any file type · up to 500 MB each</small></div>
      <input ref={ref} type="file" multiple style={{display:'none'}} onChange={e=>{add(e.target.files);e.target.value='';}}/>
    </div>
    {files.length>0&&<div className={styles.fileList}>{files.map((f,i)=><FileCard key={i} file={f} onRemove={()=>setFiles(p=>p.filter((_,j)=>j!==i))}/>)}</div>}
  </div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function ClassroomPage(){
  const{classroomId}=useParams();const navigate=useNavigate();
  const userId=getUserId();const userName=localStorage.getItem('qm_userName')||'Unknown';
  const[classroom,setClassroom]=useState(null);
  const[tab,setTab]=useState('stream');
  const[loading,setLoading]=useState(true);
  const[posts,setPosts]=useState([]);
  const[sessions,setSessions]=useState([]);
  const[editMode,setEditMode]=useState(false);
  const[editForm,setEditForm]=useState({});
  const[saving,setSaving]=useState(false);
  const[codeCopied,setCodeCopied]=useState(false);
  const[toast,setToast]=useState(null);
  const showToast=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};
  const isTeacher=classroom?.creatorId===userId||classroom?.members?.find(m=>m.userId===userId)?.role==='teacher';
  const th=THEMES[classroom?.theme||'cyan'];
  const fetchClassroom=useCallback(async()=>{try{const r=await fetch(`${API}/api/classrooms/${classroomId}`);setClassroom(await r.json());}catch{}},[classroomId]);
  const fetchPosts=useCallback(async()=>{try{const r=await fetch(`${API}/api/classrooms/${classroomId}/posts`);const d=await r.json();setPosts(Array.isArray(d)?d:[]);}catch{}},[classroomId]);
  const fetchSessions=useCallback(async()=>{try{const r=await fetch(`${API}/api/classrooms/${classroomId}/sessions`);const d=await r.json();setSessions(Array.isArray(d)?d:[]);}catch{}},[classroomId]);
  useEffect(()=>{Promise.all([fetchClassroom(),fetchPosts(),fetchSessions()]).finally(()=>setLoading(false));},[]);
  const startSession=async()=>{
    try{
      const res=await fetch(`${API}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,hostName:userName,isPublic:false,title:`${classroom?.name} – Live`,classroomId,accountUserId:userId})});
      const data=await res.json();
      const roomId=data.roomId;
      if(data.hostToken) localStorage.setItem(`qm_room_token_${roomId}`,data.hostToken);
      await fetch(`${API}/api/classrooms/${classroomId}/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,hostName:userName,classroomId})});
      localStorage.setItem(`qm_host_${roomId}`,'1');navigate(`/room/${roomId}?classroom=${classroomId}`);
    }catch(e){console.error(e);}
  };
  const copyCode=()=>{navigator.clipboard.writeText(classroom?.inviteCode||'');setCodeCopied(true);setTimeout(()=>setCodeCopied(false),2000);showToast('Invite code copied!');};
  const handleSaveEdit=async()=>{setSaving(true);try{await fetch(`${API}/api/classrooms/${classroomId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...editForm,userId})});await fetchClassroom();setEditMode(false);showToast('Classroom updated!');}catch{}finally{setSaving(false);}};
  if(loading) return <div className={styles.loadPage}><div className={styles.loadSpinner}/><span>Loading…</span></div>;
  if(!classroom) return <div className={styles.loadPage}><span style={{fontSize:52}}>😕</span><h2>Classroom not found</h2><button className={styles.backBtn} onClick={()=>navigate('/classrooms')}>← Back</button></div>;
  const TABS=[
    {id:'stream',icon:'📢',label:'Stream'},
    {id:'assignments',icon:'📋',label:'Assignments'},
    {id:'grades',icon:'📊',label:'Grades',teacherOnly:true},
    {id:'analytics',icon:'📈',label:'Analytics',teacherOnly:true},
    {id:'attendance',icon:'✅',label:'Attendance',teacherOnly:true},
    {id:'materials',icon:'📚',label:'Materials'},
    {id:'quizzes',icon:'🧠',label:'Quizzes'},
    {id:'people',icon:'👥',label:'People'},
    {id:'sessions',icon:'🎥',label:'Sessions'},
  ];
  const students=classroom.members?.filter(m=>m.role==='student')||[];
  const assignmentPosts=posts.filter(p=>p.type==='assignment');
  const pendingAssign=isTeacher?null:assignmentPosts.filter(a=>!a.mySubmission&&!isOverdue(a.dueDate)).length;
  return(
    <div className={styles.page}>
      {toast&&<div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}><span>{toast.type==='error'?'✕':toast.type==='info'?'ℹ':'✓'}</span>{toast.msg}</div>}
      {/* ── BANNER ── */}
      <div className={styles.banner}>
        <div className={styles.bannerBg} style={{background:th.bg}}/>
        <div className={styles.bannerGlow} style={{background:`radial-gradient(ellipse 70% 80% at 15% 50%, ${th.glow}, transparent)`}}/>
        <div className={styles.bannerNoise}/>
        <div className={styles.bannerContent}>
          <div className={styles.bannerTop}>
            <button className={styles.backBtn} onClick={()=>navigate('/classrooms')}>← Classrooms</button>
            <div className={styles.bannerActions}>
              {isTeacher&&!editMode&&<button className={styles.editClassBtn} onClick={()=>{setEditMode(true);setEditForm({name:classroom.name,description:classroom.description,subject:classroom.subject,section:classroom.section,theme:classroom.theme});}}>✏️ Edit</button>}
              {isTeacher&&<button className={styles.startSessionBtn} style={{background:th.accent,color:'#000'}} onClick={startSession}>🎥 Start Session</button>}
            </div>
          </div>
          {editMode?(
            <div className={styles.editBanner}>
              <div className={styles.editRow}>
                <input className={styles.editInput} placeholder="Class name" value={editForm.name||''} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}/>
                <input className={styles.editInput} placeholder="Subject" value={editForm.subject||''} onChange={e=>setEditForm(f=>({...f,subject:e.target.value}))}/>
                <input className={styles.editInput} placeholder="Section" value={editForm.section||''} onChange={e=>setEditForm(f=>({...f,section:e.target.value}))}/>
              </div>
              <textarea className={styles.editTextarea} placeholder="Description" rows={2} value={editForm.description||''} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))}/>
              <div className={styles.themeRow}>{Object.entries(THEMES).map(([t,v])=><button key={t} className={`${styles.themeChip} ${editForm.theme===t?styles.themeChipActive:''}`} style={{borderColor:v.accent,color:v.accent,background:editForm.theme===t?v.muted:''}} onClick={()=>setEditForm(f=>({...f,theme:t}))}>{t}</button>)}</div>
              <div className={styles.editBtns}><button className={styles.cancelBtn} onClick={()=>setEditMode(false)}>Cancel</button><button className={styles.saveEditBtn} style={{background:th.accent,color:'#000'}} onClick={handleSaveEdit} disabled={saving}>{saving?'Saving…':'Save Changes'}</button></div>
            </div>
          ):(
            <div className={styles.bannerInfo}>
              <h1 className={styles.bannerTitle}>{classroom.name}</h1>
              {(classroom.subject||classroom.section)&&<p className={styles.bannerMeta}>{[classroom.subject,classroom.section].filter(Boolean).join(' · ')}</p>}
              {classroom.description&&<p className={styles.bannerDesc}>{classroom.description}</p>}
              <div className={styles.bannerStatsRow}>
                <div className={styles.bannerStatChip}><span>👥</span><strong>{students.length}</strong><span>Students</span></div>
                <div className={styles.bannerStatChip}><span>📋</span><strong>{assignmentPosts.length}</strong><span>Assignments</span></div>
                <div className={styles.bannerStatChip}><span>🎥</span><strong>{sessions.length}</strong><span>Sessions</span></div>
                {isTeacher&&<div className={styles.bannerStatChip} style={{background:'rgba(0,0,0,.2)',borderColor:th.border,color:th.accent}}><span>👑</span><strong>Teacher</strong></div>}
              </div>
            </div>
          )}
          <div className={styles.inviteBar} style={{background:'rgba(0,0,0,.25)',border:`1px solid ${th.border}`}}>
            <span className={styles.inviteLabel}>Invite Code</span>
            <code className={styles.inviteCode} style={{color:th.accent}}>{classroom.inviteCode}</code>
            <button className={styles.copyCodeBtn} onClick={copyCode} style={{background:th.muted,borderColor:th.border,color:th.accent}}>{codeCopied?'✓ Copied':'📋 Copy'}</button>
          </div>
        </div>
      </div>
      {/* ── TABS ── */}
      <div className={styles.tabBar}>
        {TABS.filter(t=>!t.teacherOnly||isTeacher).map(t=>(
          <button key={t.id} className={`${styles.tab} ${tab===t.id?styles.tabActive:''}`}
            style={tab===t.id?{color:th.accent,borderBottomColor:th.accent}:{}}
            onClick={()=>setTab(t.id)}>
            {t.icon} {t.label}
            {t.id==='assignments'&&pendingAssign>0&&<span className={styles.tabBadge}>{pendingAssign}</span>}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {tab==='stream'      &&<StreamTab classroomId={classroomId} posts={posts} setPosts={setPosts} fetchPosts={fetchPosts} isTeacher={isTeacher} userId={userId} userName={userName} th={th} showToast={showToast} classroom={classroom}/>}
        {tab==='assignments' &&<AssignmentsTab classroomId={classroomId} posts={posts} setPosts={setPosts} fetchPosts={fetchPosts} isTeacher={isTeacher} userId={userId} userName={userName} th={th} classroom={classroom} showToast={showToast}/>}
        {tab==='grades'      &&isTeacher&&<GradeBookTab classroomId={classroomId} classroom={classroom} th={th} showToast={showToast} posts={posts}/>}
        {tab==='analytics'   &&isTeacher&&<AnalyticsTab classroomId={classroomId} classroom={classroom} th={th} posts={posts}/>}
        {tab==='attendance'  &&isTeacher&&<AttendanceTab classroomId={classroomId} classroom={classroom} sessions={sessions} th={th} showToast={showToast}/>}
        {tab==='materials'   &&<MaterialsTab classroomId={classroomId} posts={posts} setPosts={setPosts} isTeacher={isTeacher} userId={userId} userName={userName} th={th} fetchPosts={fetchPosts} showToast={showToast}/>}
        {tab==='quizzes'     &&<QuizzesTab classroomId={classroomId} posts={posts} setPosts={setPosts} isTeacher={isTeacher} userId={userId} userName={userName} th={th} showToast={showToast}/>}
        {tab==='people'      &&<PeopleTab classroom={classroom} setClassroom={setClassroom} isTeacher={isTeacher} userId={userId} th={th} fetchClassroom={fetchClassroom} classroomId={classroomId} showToast={showToast}/>}
        {tab==='sessions'    &&<SessionsTab sessions={sessions} th={th} navigate={navigate} classroomId={classroomId}/>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STREAM TAB
// ══════════════════════════════════════════════════════════════════════════════
function StreamTab({classroomId,posts,setPosts,fetchPosts,isTeacher,userId,userName,th,showToast,classroom}){
  const[compose,setCompose]=useState(false);
  const[type,setType]=useState('announcement');
  const[body,setBody]=useState('');
  const[title,setTitle]=useState('');
  const[files,setFiles]=useState([]);
  const[posting,setPosting]=useState(false);
  const[scheduleDate,setScheduleDate]=useState('');
  const[scheduled,setScheduled]=useState([]);
  const[comments,setComments]=useState({});
  const[commentInput,setCommentInput]=useState({});
  const[expanded,setExpanded]=useState({});
  const students=classroom?.members?.filter(m=>m.role==='student')||[];
  const upcoming=posts.filter(p=>p.type==='assignment'&&p.dueDate&&!isOverdue(p.dueDate)).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,5);
  const loadScheduled=useCallback(async()=>{
    if(!isTeacher) return;
    try{
      const r=await fetch(`${API}/api/classrooms/${classroomId}/scheduled`);
      const d=await r.json();
      setScheduled(Array.isArray(d)?d:[]);
    }catch{setScheduled([]);}
  },[classroomId,isTeacher]);
  useEffect(()=>{loadScheduled();},[loadScheduled]);
  const handlePost=async()=>{
    if(!body.trim()&&!title.trim()) return;
    setPosting(true);
    try{
      const attachments=await uploadFilesToBlob(classroomId,files);
      if(scheduleDate){
        const r=await fetch(`${API}/api/classrooms/${classroomId}/scheduled`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,body,title:title||undefined,scheduledFor:new Date(scheduleDate).toISOString(),attachments})});
        if(!r.ok) throw new Error('schedule failed');
        await loadScheduled();
        setCompose(false);setBody('');setTitle('');setFiles([]);setScheduleDate('');
        showToast('Scheduled!');
      }else{
        const r=await fetch(`${API}/api/classrooms/${classroomId}/posts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,body,authorId:userId,authorName:userName,title:title||undefined,attachments})});
        const d=await r.json();setPosts(p=>[d,...p]);setCompose(false);setBody('');setTitle('');setFiles([]);setScheduleDate('');showToast('Posted!');
      }
    }catch{}finally{setPosting(false);}
  };
  const cancelScheduled=async(id)=>{
    if(!window.confirm('Cancel this scheduled post?')) return;
    await fetch(`${API}/api/classrooms/${classroomId}/scheduled/${id}`,{method:'DELETE'});
    setScheduled(s=>s.filter(x=>x._id!==id));
    showToast('Schedule cancelled');
  };
  const handlePin=async(postId,pinned)=>{
    await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned:!pinned})});
    setPosts(p=>p.map(x=>x.postId===postId?{...x,pinned:!pinned}:x));showToast(!pinned?'Pinned!':'Unpinned');
  };
  const handleDelete=async(postId)=>{if(!window.confirm('Delete?')) return;await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}`,{method:'DELETE'});setPosts(p=>p.filter(x=>x.postId!==postId));showToast('Deleted');};
  const loadComments=async(postId)=>{
    if(comments[postId]) return;
    const r=await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}/comments`);
    const d=await r.json();setComments(c=>({...c,[postId]:Array.isArray(d)?d:[]}));
  };
  const toggleExpand=async(postId)=>{
    const open=!expanded[postId];setExpanded(e=>({...e,[postId]:open}));
    if(open) await loadComments(postId);
  };
  const sendComment=async(postId)=>{
    const text=commentInput[postId]||'';if(!text.trim()) return;
    const r=await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorId:userId,authorName:userName,text})});
    const d=await r.json();setComments(c=>({...c,[postId]:[...(c[postId]||[]),d]}));setCommentInput(i=>({...i,[postId]:''}));
  };
  const sorted=[...posts].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(new Date(b.createdAt)-new Date(a.createdAt)));
  return(
    <div className={styles.streamLayout}>
      <div>
        {/* Composer */}
        <div className={styles.composerCard}>
          {!compose?(
            <div className={styles.composerBar} onClick={()=>setCompose(true)}>
              <Avatar name={userName} size={32}/>
              <span className={styles.composerInput}>Share something with the class…</span>
              {isTeacher&&<span style={{fontSize:12,color:th.accent,fontWeight:700}}>+ Post</span>}
            </div>
          ):(
            <>
              <div className={styles.composerBar}>
                <Avatar name={userName} size={32}/>
                <span style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>New Post</span>
                <button style={{marginLeft:'auto',background:'none',border:'none',color:'var(--text-2)',fontSize:16,cursor:'pointer'}} onClick={()=>setCompose(false)}>✕</button>
              </div>
              <div className={styles.composerExpanded}>
                {isTeacher&&(
                  <div className={styles.typeTabRow}>
                    {[['announcement','📢 Announce'],['assignment','📋 Assign'],['material','📚 Material'],['quiz','🧠 Quiz']].map(([v,l])=>(
                      <button key={v} className={`${styles.typeTabBtn} ${type===v?styles.typeTabBtnActive:''}`} onClick={()=>setType(v)}>{l}</button>
                    ))}
                  </div>
                )}
                {(type==='assignment'||type==='material'||type==='quiz')&&<input className={styles.formInput} placeholder="Title *" value={title} autoFocus onChange={e=>setTitle(e.target.value)}/>}
                <textarea className={styles.formTextarea} placeholder={type==='announcement'?"Share an announcement with the class…":"Instructions or description…"} rows={4} value={body} autoFocus={type==='announcement'} onChange={e=>setBody(e.target.value)}/>
                <FileDrop files={files} setFiles={setFiles}/>
                {isTeacher&&<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <label style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>SCHEDULE FOR</label>
                  <input type="datetime-local" className={styles.formInput} style={{flex:1,minWidth:160}} value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)}/>
                </div>}
                <div className={styles.formActions}>
                  <button className={styles.cancelBtn} onClick={()=>setCompose(false)}>Cancel</button>
                  <button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={handlePost} disabled={posting||(!body.trim()&&!title.trim())}>{posting?'Posting…':scheduleDate?'Schedule':'Post'}</button>
                </div>
              </div>
            </>
          )}
        </div>
        {isTeacher&&scheduled.length>0&&(
          <div className={styles.postCard} style={{borderStyle:'dashed'}}>
            <div className={styles.sectionLabel} style={{marginBottom:8}}>🕐 Upcoming scheduled ({scheduled.length})</div>
            {scheduled.map(sp=>(
              <div key={sp._id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderTop:'1px solid var(--border, rgba(255,255,255,.06))'}}>
                <span className={`${styles.postTypePill} ${styles[`pill_${sp.type}`]||''}`}>{sp.type}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sp.title||sp.body||'Post'}</div>
                  <div style={{fontSize:11,color:'var(--text-3)'}}>{fmtDate(sp.scheduledFor)} {fmtTime(sp.scheduledFor)}</div>
                </div>
                <button className={styles.deleteIconBtn} title="Cancel schedule" onClick={()=>cancelScheduled(sp._id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Posts */}
        {sorted.length===0&&<div className={styles.emptyState}><span>📢</span><strong>No posts yet</strong><p>{isTeacher?'Start the conversation — share an announcement.':'Your teacher hasn\'t posted anything yet.'}</p></div>}
        {sorted.map(post=>{
          const open=expanded[post.postId];const postComments=comments[post.postId]||[];
          return(
            <div key={post.postId} className={styles.postCard}>
              {post.pinned&&<div className={styles.postPinnedBanner}>📌 Pinned</div>}
              <div className={styles.postCardTop}>
                <Avatar name={post.authorName}/>
                <div className={styles.postCardMeta}>
                  <div className={styles.postAuthorRow}>
                    <span className={styles.postAuthorName}>{post.authorName}</span>
                    <span className={`${styles.postTypePill} ${styles[`pill_${post.type}`]}`}>{post.type}</span>
                    <span className={styles.postTime}>{fmtRel(post.createdAt)}</span>
                    {post.scheduledFor&&new Date(post.scheduledFor)>new Date()&&<span className={styles.scheduledPill}>🕐 Scheduled {fmtDate(post.scheduledFor)}</span>}
                  </div>
                  {post.title&&<div className={styles.postTitle}>{post.title}</div>}
                  {post.body&&<div className={styles.postBody}>{post.body}</div>}
                  {post.dueDate&&<div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span className={`${styles.dueChip} ${isOverdue(post.dueDate)?styles.dueChipOverdue:isSoon(post.dueDate)?styles.dueChipSoon:''}`}>📅 Due {fmtDate(post.dueDate)}</span>
                    {post.points&&<span className={styles.ptChip}>{post.points} pts</span>}
                  </div>}
                </div>
                {isTeacher&&(
                  <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                    <button className={styles.deleteIconBtn} title={post.pinned?'Unpin':'Pin'} onClick={()=>handlePin(post.postId,post.pinned)}>{post.pinned?'📌':'📍'}</button>
                    <button className={styles.deleteIconBtn} title="Delete" onClick={()=>handleDelete(post.postId)}>🗑</button>
                  </div>
                )}
              </div>
              {post.attachments?.length>0&&<div className={styles.fileList}>{post.attachments.map((f,i)=><FileCard key={i} file={f} classroomId={classroomId}/>)}</div>}
              <div className={styles.postCardActions}>
                <button className={styles.postActionBtn} onClick={()=>toggleExpand(post.postId)}>{open?'▲ Hide':'💬 '}{open?'Comments':`Comments${postComments.length?` (${postComments.length})`:''}`}</button>
                {(post.type==='assignment'||post.type==='quiz')&&<button className={styles.postActionBtn} style={{color:th.accent,borderColor:th.border}} onClick={()=>{}}>Open →</button>}
              </div>
              {open&&(
                <div className={styles.commentsArea}>
                  <div className={styles.commentInput}>
                    <Avatar name={userName} size={26}/>
                    <input className={styles.commentInputField} placeholder="Add a class comment…" value={commentInput[post.postId]||''} onChange={e=>setCommentInput(i=>({...i,[post.postId]:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&sendComment(post.postId)}/>
                    <button className={styles.commentSendBtn} onClick={()=>sendComment(post.postId)}>Post</button>
                  </div>
                  {postComments.map(c=>(
                    <div key={c.commentId} className={styles.comment}>
                      <Avatar name={c.authorName} size={26}/>
                      <div className={styles.commentBody}><div className={styles.commentAuthor}>{c.authorName}</div><div className={styles.commentText}>{c.text}</div><div className={styles.commentMeta}>{fmtRel(c.createdAt)}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Sidebar */}
      <div className={styles.streamSidebar}>
        {upcoming.length>0&&(
          <div className={styles.sidebarCard}>
            <div className={styles.sidebarCardTitle}>⏰ Upcoming</div>
            {upcoming.map(a=><div key={a.postId} className={styles.upcomingItem}>
              <div className={`${styles.upcomingDot} ${isSoon(a.dueDate)?styles.dueChipSoon:''}`} style={{background:isSoon(a.dueDate)?'var(--amber)':th.accent}}/>
              <div><div className={styles.upcomingTitle}>{a.title}</div><div className={styles.upcomingDue} style={{color:isSoon(a.dueDate)?'var(--amber)':'var(--text-3)'}}>Due {fmtDate(a.dueDate)}</div></div>
            </div>)}
          </div>
        )}
        <div className={styles.sidebarCard}>
          <div className={styles.sidebarCardTitle}>👥 Class</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:'var(--text-2)'}}>Teacher</span><strong>{classroom?.creatorName}</strong></div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:'var(--text-2)'}}>Students</span><strong>{students.length}</strong></div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:'var(--text-2)'}}>Posts</span><strong>{posts.length}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENTS TAB
// ══════════════════════════════════════════════════════════════════════════════
function AssignmentsTab({classroomId,posts,setPosts,fetchPosts,isTeacher,userId,userName,th,classroom,showToast}){
  const[creating,setCreating]=useState(false);
  const[form,setForm]=useState({title:'',body:'',dueDate:'',points:'',topic:'',allowLateSubmissions:true});
  const[files,setFiles]=useState([]);
  const[posting,setPosting]=useState(false);
  const[selected,setSelected]=useState(null);
  const[filter,setFilter]=useState('all');
  const f=v=>({...form,...v});
  const assignments=posts.filter(p=>p.type==='assignment');
  const now=new Date();
  const filtered=assignments.filter(a=>{
    if(filter==='overdue') return a.dueDate&&new Date(a.dueDate)<now;
    if(filter==='upcoming') return !a.dueDate||new Date(a.dueDate)>=now;
    if(filter==='missing') return isTeacher?false:false;
    return true;
  });
  // Group by topic
  const topics=[...new Set(filtered.map(a=>a.topic||'General'))];
  const handleCreate=async()=>{
    if(!form.title.trim()) return;setPosting(true);
    try{
      const attachments=await uploadFilesToBlob(classroomId,files);
      const r=await fetch(`${API}/api/classrooms/${classroomId}/posts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,type:'assignment',authorId:userId,authorName:userName,attachments,allowLateSubmissions:form.allowLateSubmissions!==false})});
      const d=await r.json();setPosts(p=>[d,...p]);setCreating(false);setForm({title:'',body:'',dueDate:'',points:'',topic:'',allowLateSubmissions:true});setFiles([]);showToast('Assignment created!');
    }catch{}finally{setPosting(false);}
  };
  const handleDelete=async(postId)=>{if(!window.confirm('Delete?')) return;await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}`,{method:'DELETE'});setPosts(p=>p.filter(x=>x.postId!==postId));showToast('Deleted');};
  if(selected){const post=assignments.find(p=>p.postId===selected);if(!post){setSelected(null);return null;}return<AssignmentReviewPanel classroomId={classroomId} post={post} isTeacher={isTeacher} userId={userId} userName={userName} th={th} onBack={()=>setSelected(null)} classroom={classroom} showToast={showToast}/>;}
  return(
    <div>
      <div className={styles.assignHeader}>
        <div className={styles.filterRow}>
          {[['all','All'],['upcoming','Upcoming'],['overdue','Overdue']].map(([v,l])=><button key={v} className={`${styles.filterBtn} ${filter===v?styles.filterBtnActive:''}`} style={filter===v?{background:th.muted,borderColor:th.accent,color:th.accent}:{}} onClick={()=>setFilter(v)}>{l} <span style={{fontSize:10,opacity:.6}}>({v==='all'?assignments.length:v==='upcoming'?assignments.filter(a=>!a.dueDate||new Date(a.dueDate)>=now).length:assignments.filter(a=>a.dueDate&&new Date(a.dueDate)<now).length})</span></button>)}
        </div>
        {isTeacher&&<button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={()=>setCreating(c=>!c)}>{creating?'✕ Cancel':'+ New Assignment'}</button>}
      </div>
      {creating&&(
        <div className={styles.formSection} style={{borderColor:th.border}}>
          <div className={styles.formTitle}>📋 New Assignment</div>
          <input className={styles.formInput} placeholder="Title *" value={form.title} autoFocus onChange={e=>setForm(f(({title:e.target.value})))}/>
          <textarea className={styles.formTextarea} placeholder="Instructions for students…" rows={4} value={form.body} onChange={e=>setForm(f(({body:e.target.value})))} style={{marginTop:8}}/>
          <div className={styles.formGrid} style={{marginTop:10}}>
            <div className={styles.formGroup}><label className={styles.formLabel}>Due Date</label><input className={styles.formInput} type="datetime-local" value={form.dueDate} onChange={e=>setForm(f(({dueDate:e.target.value})))}/></div>
            <div className={styles.formGroup}><label className={styles.formLabel}>Points</label><input className={styles.formInput} type="number" placeholder="100" value={form.points} onChange={e=>setForm(f(({points:e.target.value})))}/></div>
            <div className={styles.formGroup}><label className={styles.formLabel}>Topic / Unit</label><input className={styles.formInput} placeholder="e.g. Chapter 3" value={form.topic} onChange={e=>setForm(f(({topic:e.target.value})))}/></div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,marginTop:10,fontSize:13,cursor:'pointer'}}>
            <input type="checkbox" checked={!!form.allowLateSubmissions} onChange={e=>setForm(f(({allowLateSubmissions:e.target.checked})))}/>
            Allow late submissions after due date
          </label>
          <div style={{marginTop:10}}><FileDrop files={files} setFiles={setFiles} label="Attach reference files for students"/></div>
          <div className={styles.formActions}><button className={styles.cancelBtn} onClick={()=>{setCreating(false);setFiles([])}}>Cancel</button><button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={handleCreate} disabled={posting||!form.title.trim()}>{posting?'Creating…':'Create Assignment'}</button></div>
        </div>
      )}
      {filtered.length===0&&!creating&&<div className={styles.emptyState}><span>📋</span><strong>No assignments</strong><p>{isTeacher?'Create one above.':'No assignments posted yet.'}</p></div>}
      {topics.map(topic=>{
        const topicItems=filtered.filter(a=>(a.topic||'General')===topic);
        if(!topicItems.length) return null;
        return(
          <div key={topic} className={styles.topicGroup}>
            {topics.length>1&&<div className={styles.topicGroupLabel}><span>📁</span>{topic}</div>}
            {topicItems.map(a=>{
              const overdue=isOverdue(a.dueDate);const soon=isSoon(a.dueDate);
              return(
                <div key={a.postId} className={styles.assignCard} style={{borderLeftColor:overdue?'var(--red)':soon?'var(--amber)':th.accent}} onClick={()=>setSelected(a.postId)}>
                  <div className={styles.assignCardTop}>
                    <div className={styles.assignIcon} style={{background:overdue?'rgba(255,74,94,.1)':th.muted,color:overdue?'var(--red)':th.accent}}>📋</div>
                    <div className={styles.assignInfo}>
                      <div className={styles.assignTitle}>{a.title}</div>
                      <div className={styles.assignMeta}>
                        {a.dueDate&&<span className={`${styles.dueChip} ${overdue?styles.dueChipOverdue:soon?styles.dueChipSoon:''}`}>{overdue?'⚠️':soon?'⏰':'📅'} {fmtDate(a.dueDate)}</span>}
                        {a.points&&<span className={styles.ptChip}>{a.points} pts</span>}
                        {a.attachments?.length>0&&<span className={styles.topicChip}>📎 {a.attachments.length} file{a.attachments.length!==1?'s':''}</span>}
                      </div>
                      {a.body&&<div className={styles.assignBody}>{a.body.slice(0,140)}{a.body.length>140?'…':''}</div>}
                    </div>
                    {isTeacher&&<button className={styles.deleteIconBtn} onClick={e=>{e.stopPropagation();handleDelete(a.postId);}}>🗑</button>}
                  </div>
                  <div className={styles.assignCardFooter}>
                    <span style={{color:th.accent,fontSize:11,fontWeight:700}}>Open →</span>
                    {isTeacher&&<span style={{fontSize:11,color:'var(--text-3)'}}>View submissions</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENT REVIEW PANEL
// ══════════════════════════════════════════════════════════════════════════════
function AssignmentReviewPanel({classroomId,post,isTeacher,userId,userName,th,onBack,classroom,showToast}){
  const[submissions,setSubmissions]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selectedSub,setSelectedSub]=useState(null);
  const[filter,setFilter]=useState('all');
  const[search,setSearch]=useState('');
  const[myFiles,setMyFiles]=useState([]);
  const[myComment,setMyComment]=useState('');
  const[submitting,setSubmitting]=useState(false);
  const[resubmit,setResubmit]=useState(false);
  const fetchSubs=useCallback(async()=>{
    setLoading(true);
    try{const r=await fetch(`${API}/api/classrooms/${classroomId}/posts/${post.postId}/submissions?userId=${userId}&role=${isTeacher?'teacher':'student'}`);const d=await r.json();setSubmissions(Array.isArray(d)?d:[]);}
    catch{}finally{setLoading(false);}
  },[classroomId,post.postId,userId,isTeacher]);
  useEffect(()=>{fetchSubs();},[]);
  const mySub=submissions.find(s=>s.studentId===userId);
  const handleSubmit=async()=>{
    if(!myComment.trim()&&myFiles.length===0) return;
    setSubmitting(true);
    const attachments=await uploadFilesToBlob(classroomId,myFiles);
    await fetch(`${API}/api/classrooms/${classroomId}/posts/${post.postId}/submissions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:userId,studentName:userName,comment:myComment,attachments})});
    setMyComment('');setMyFiles([]);setResubmit(false);fetchSubs();setSubmitting(false);showToast('Turned in! ✓','success');
  };
  const handleGrade=async(subId,grade,feedback,privateNote,status)=>{
    await fetch(`${API}/api/classrooms/${classroomId}/posts/${post.postId}/submissions/${subId}/grade`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:Number(grade),feedback,privateNote,status:status||'graded'})});
    fetchSubs();showToast('Grade saved!');
  };
  const handleReturn=async(subId)=>{await fetch(`${API}/api/classrooms/${classroomId}/posts/${post.postId}/submissions/${subId}/return`,{method:'PATCH'});fetchSubs();showToast('Returned to student!');};
  const handleAnnotate=async(subId,annotation)=>{await fetch(`${API}/api/classrooms/${classroomId}/posts/${post.postId}/submissions/${subId}/annotate`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({annotation})});fetchSubs();};
  const students=classroom?.members?.filter(m=>m.role==='student')||[];
  const missingStudents=isTeacher?students.filter(s=>!submissions.find(sub=>sub.studentId===s.userId)):[];
  const filtered=isTeacher?submissions.filter(s=>filter==='all'?true:filter==='graded'?(s.status==='graded'||s.status==='returned'):filter==='pending'?(s.status==='submitted'||s.status==='late'):s.status===filter).filter(s=>!search||s.studentName.toLowerCase().includes(search.toLowerCase())):submissions;
  const graded=submissions.filter(s=>s.grade!=null);
  const stats=isTeacher?{total:submissions.length,missing:missingStudents.length,pending:submissions.filter(s=>s.status==='submitted'||s.status==='late').length,graded:graded.length,late:submissions.filter(s=>s.status==='late').length,avg:graded.length?(graded.reduce((a,s)=>a+s.grade,0)/graded.length).toFixed(1):null,highest:graded.length?Math.max(...graded.map(s=>s.grade)):null}:null;
  if(selectedSub) return<SubmissionDetail sub={selectedSub} post={post} classroomId={classroomId} th={th} onGrade={handleGrade} onReturn={handleReturn} onAnnotate={handleAnnotate} onBack={()=>setSelectedSub(null)} showToast={showToast}/>;
  return(
    <div className={styles.reviewPanel}>
      <button className={styles.backLink} onClick={onBack}>← Back to assignments</button>
      <div className={styles.reviewHeader}>
        <div><h2 className={styles.reviewTitle2}>{post.title}</h2>
          <div className={styles.reviewMeta}>
            {post.dueDate&&<span className={`${styles.dueChip} ${isOverdue(post.dueDate)?styles.dueChipOverdue:isSoon(post.dueDate)?styles.dueChipSoon:''}`}>📅 Due {fmtDate(post.dueDate)} {fmtTime(post.dueDate)}</span>}
            {post.points&&<span className={styles.ptChip}>{post.points} pts</span>}
            {post.topic&&<span className={styles.topicChip}>{post.topic}</span>}
          </div>
        </div>
      </div>
      {post.body&&<div className={styles.reviewBody}>{post.body}</div>}
      {post.attachments?.length>0&&<div className={styles.fileList} style={{marginBottom:16}}>{post.attachments.map((f,i)=><FileCard key={i} file={f} classroomId={classroomId}/>)}</div>}
      {isTeacher&&stats&&(
        <div className={styles.subStatsRow}>
          <StatCard icon="📥" label="Submitted" value={stats.total} color="#60a5fa"/>
          <StatCard icon="⏳" label="Pending" value={stats.pending} color="var(--amber)"/>
          <StatCard icon="✅" label="Graded" value={stats.graded} color="#10e88a"/>
          <StatCard icon="❌" label="Missing" value={stats.missing} color="var(--red)"/>
          {stats.avg&&<StatCard icon="📊" label="Class Avg" value={`${stats.avg}/${post.points||'?'}`} color={th.accent}/>}
          {stats.highest!=null&&<StatCard icon="🏆" label="Highest" value={stats.highest} color="var(--amber)"/>}
        </div>
      )}
      {isTeacher&&(
        <>
          <div className={styles.subFilterRow}>
            <div className={styles.filterRow}>
              {[['all','All'],['pending','Pending'],['graded','Graded'],['returned','Returned'],['late','Late']].map(([v,l])=><button key={v} className={`${styles.filterBtn} ${filter===v?styles.filterBtnActive:''}`} style={filter===v?{background:th.muted,borderColor:th.accent,color:th.accent}:{}} onClick={()=>setFilter(v)}>{l}</button>)}
            </div>
            <input className={styles.searchInput} placeholder="Search student…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {loading&&<div className={styles.loadingRow}><div className={styles.spinnerSm}/>Loading…</div>}
          {!loading&&filtered.length===0&&<div className={styles.emptyState}><span>📭</span><strong>No submissions yet</strong></div>}
          {!loading&&filtered.map(sub=>(
            <div key={sub.submissionId} className={styles.subCard} onClick={()=>setSelectedSub(sub)}>
              <div className={styles.subCardLeft}>
                <Avatar name={sub.studentName}/>
                <div>
                  <span className={styles.subCardName}>{sub.studentName}</span>
                  <span className={styles.subCardDate}>{fmtDate(sub.submittedAt)} at {fmtTime(sub.submittedAt)}</span>
                  {sub.comment&&<span className={styles.subCardComment}>"{sub.comment}"</span>}
                </div>
              </div>
              <div className={styles.subCardRight}>
                {sub.grade!=null&&<div className={styles.subGrade} style={{color:gradeColor(pct(sub.grade,post.points||100))}}><span className={styles.subGradeNum}>{sub.grade}</span><span className={styles.subGradeOf}>/{post.points||'?'}</span><span className={styles.subGradeLetter}>{gradeLetter(pct(sub.grade,post.points||100))}</span></div>}
                <span className={`${styles.subStatusPill} ${styles[`sub_${sub.status}`]}`}>{sub.status}</span>
                {sub.attachments?.length>0&&<span className={styles.subAttachCount}>📎{sub.attachments.length}</span>}
                <span style={{color:th.accent,fontSize:11,fontWeight:700}}>Grade →</span>
              </div>
            </div>
          ))}
          {missingStudents.length>0&&(
            <div className={styles.missingSection}>
              <div className={styles.sectionLabel}>❌ Missing ({missingStudents.length})</div>
              {missingStudents.map(s=><div key={s.userId} className={styles.missingRow}><Avatar name={s.userName} size={28}/><span style={{fontSize:13,fontWeight:600}}>{s.userName}</span><span className={styles.missingTag}>No submission</span></div>)}
            </div>
          )}
        </>
      )}
      {!isTeacher&&(
        <div className={styles.studentSubmitArea}>
          {mySub&&!resubmit?(
            <div className={styles.mySubmission}>
              <h4>✓ Your Submission</h4>
              <span className={styles.subCardDate}>Submitted {fmtDate(mySub.submittedAt)} at {fmtTime(mySub.submittedAt)}</span>
              {mySub.comment&&<div style={{marginTop:8,fontStyle:'italic',color:'var(--text-2)',fontSize:13}}>{mySub.comment}</div>}
              {mySub.attachments?.length>0&&<div className={styles.fileList} style={{marginTop:8}}>{mySub.attachments.map((f,i)=><FileCard key={i} file={f} classroomId={classroomId}/>)}</div>}
              {mySub.grade!=null?(
                <div className={styles.myGradeBox}>
                  <div className={styles.myGradeNum} style={{color:gradeColor(pct(mySub.grade,post.points||100))}}>{mySub.grade}<span style={{fontSize:18,margin:'0 4px'}}>/ {post.points||'?'}</span><span style={{fontSize:22}}>{gradeLetter(pct(mySub.grade,post.points||100))}</span></div>
                  <GradeBar value={mySub.grade} max={post.points||100}/>
                  {mySub.feedback&&<div className={styles.feedbackBox}><strong>Teacher feedback</strong><p>{mySub.feedback}</p></div>}
                  {mySub.annotation&&<div className={styles.annotationBox}><strong>📝 Annotation</strong><p>{mySub.annotation}</p></div>}
                </div>
              ):<div style={{marginTop:8}}><span className={`${styles.subStatusPill} ${styles[`sub_${mySub.status}`]}`}>{mySub.status}</span><span style={{fontSize:12,color:'var(--text-2)',marginLeft:8}}>Waiting for teacher to grade…</span></div>}
              <button className={styles.btnGhost} style={{marginTop:12}} onClick={()=>setResubmit(true)}>↩ Resubmit</button>
            </div>
          ):(
            <div className={styles.submitForm}>
              <h4>{mySub?'Resubmit Work':'📤 Turn In'}</h4>
              {isOverdue(post.dueDate)&&post.allowLateSubmissions===false?(
                <div style={{padding:'8px 12px',background:'rgba(255,74,94,.08)',border:'1px solid rgba(255,74,94,.2)',borderRadius:8,fontSize:12,color:'var(--red)',marginBottom:12}}>⛔ Late submissions are closed for this assignment.</div>
              ):isOverdue(post.dueDate)?(
                <div style={{padding:'8px 12px',background:'rgba(255,74,94,.08)',border:'1px solid rgba(255,74,94,.2)',borderRadius:8,fontSize:12,color:'var(--red)',marginBottom:12}}>⚠️ This assignment is past due — your submission will be marked late.</div>
              ):null}
              {!(isOverdue(post.dueDate)&&post.allowLateSubmissions===false)&&(
              <>
              <textarea className={styles.formTextarea} rows={3} placeholder="Add a note to your teacher…" value={myComment} onChange={e=>setMyComment(e.target.value)}/>
              <div style={{marginTop:10}}><FileDrop files={myFiles} setFiles={setMyFiles} label="Attach your work — multiple files supported"/></div>
              <div className={styles.formActions}>
                {resubmit&&<button className={styles.cancelBtn} onClick={()=>setResubmit(false)}>Cancel</button>}
                <button className={styles.submitBtn} style={{background:th.accent,color:'#000',minWidth:120}} onClick={handleSubmit} disabled={submitting||(!myComment.trim()&&myFiles.length===0)}>{submitting?'Turning in…':'Turn In ✓'}</button>
              </div>
              </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBMISSION DETAIL
// ══════════════════════════════════════════════════════════════════════════════
function SubmissionDetail({sub,post,classroomId,th,onGrade,onReturn,onAnnotate,onBack,showToast}){
  const[grade,setGrade]=useState(sub.grade??'');
  const[feedback,setFeedback]=useState(sub.feedback||'');
  const[note,setNote]=useState(sub.privateNote||'');
  const[annotation,setAnnotation]=useState(sub.annotation||'');
  const[saving,setSaving]=useState(false);
  const[tab,setTab]=useState('grade');
  const pct2=grade!==''&&post.points?pct(Number(grade),post.points):null;
  const save=async(returnAfter=false)=>{setSaving(true);await onGrade(sub.submissionId,grade,feedback,note,returnAfter?'returned':'graded');if(annotation!==sub.annotation) await onAnnotate(sub.submissionId,annotation);setSaving(false);onBack();};
  return(
    <div className={styles.subDetail}>
      <button className={styles.backLink} onClick={onBack}>← Back to submissions</button>
      <div className={styles.subDetailHeader}>
        <Avatar name={sub.studentName} size={52}/>
        <div>
          <h3 className={styles.subDetailName}>{sub.studentName}</h3>
          <div className={styles.subDetailMeta}>
            <span>Submitted {fmtDate(sub.submittedAt)} at {fmtTime(sub.submittedAt)}</span>
            {sub.status==='late'&&<span className={styles.latePill}>⚠️ Late</span>}
            {sub.status==='returned'&&<span className={styles.returnedPill}>✓ Returned</span>}
          </div>
        </div>
        {sub.grade!=null&&<div style={{marginLeft:'auto',textAlign:'right'}}><div style={{fontSize:32,fontWeight:800,fontFamily:'var(--font-head)',color:gradeColor(pct(sub.grade,post.points||100))}}>{sub.grade}/{post.points||'?'}</div><div style={{fontSize:18,fontWeight:800,color:gradeColor(pct(sub.grade,post.points||100))}}>{gradeLetter(pct(sub.grade,post.points||100))}</div></div>}
      </div>
      <div className={styles.subDetailTabs}>
        {[['grade','✏️ Grade'],['files','📎 Files & Work'],['annotation','📝 Annotate']].map(([t,l])=><button key={t} className={`${styles.subDetailTab} ${tab===t?styles.subDetailTabActive:''}`} style={tab===t?{color:th.accent,borderBottomColor:th.accent}:{}} onClick={()=>setTab(t)}>{l}</button>)}
      </div>
      {tab==='files'&&<div>{sub.comment&&<div className={styles.subDetailComment}><strong>Student note: </strong>{sub.comment}</div>}{sub.attachments?.length>0?<div className={styles.subDetailFiles}>{sub.attachments.map((f,i)=><FileCard key={i} file={f} classroomId={classroomId}/>)}</div>:<div className={styles.emptyState}><span>📭</span><strong>No files submitted</strong><p>Student submitted only a text note.</p></div>}</div>}
      {tab==='annotation'&&<div className={styles.formGroup}><label className={styles.formLabel}>📝 Inline annotation (visible after return)</label><textarea className={styles.formTextarea} rows={7} placeholder="Write specific inline feedback…" value={annotation} onChange={e=>setAnnotation(e.target.value)}/><button className={styles.submitBtn} style={{background:'#10e88a',color:'#000',marginTop:8}} onClick={async()=>{await onAnnotate(sub.submissionId,annotation);showToast('Annotation saved!');}}>Save Annotation</button></div>}
      {tab==='grade'&&(
        <div className={styles.gradeFormFull} style={{borderColor:th.border}}>
          <div className={styles.gradeInputRow}>
            <div className={styles.formGroup} style={{maxWidth:200}}>
              <label className={styles.formLabel}>Score / {post.points||'?'} pts</label>
              <input className={styles.formInput} type="number" min={0} max={post.points||9999} placeholder="0" style={{fontSize:30,fontWeight:800,color:pct2!=null?gradeColor(pct2):undefined,textAlign:'center'}} value={grade} onChange={e=>setGrade(e.target.value)}/>
            </div>
            {pct2!=null&&<div className={styles.gradeBigDisplay} style={{color:gradeColor(pct2)}}><span className={styles.gradePct}>{pct2}%</span><span className={styles.gradeLtr}>{gradeLetter(pct2)}</span><GradeBar value={Number(grade)} max={post.points||100}/></div>}
          </div>
          <div className={styles.formGroup}><label className={styles.formLabel}>💬 Feedback (visible to student)</label><textarea className={styles.formTextarea} rows={4} placeholder="Detailed feedback for the student…" value={feedback} onChange={e=>setFeedback(e.target.value)}/></div>
          <div className={styles.formGroup}><label className={styles.formLabel}>🔒 Private teacher note</label><textarea className={styles.formTextarea} rows={2} placeholder="Internal notes only you can see…" value={note} onChange={e=>setNote(e.target.value)}/></div>
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={onBack}>Cancel</button>
            {sub.status==='graded'&&<button className={styles.returnBtn2} onClick={async()=>{setSaving(true);await onReturn(sub.submissionId);setSaving(false);onBack();}}>↩ Return</button>}
            <button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={()=>save(false)} disabled={saving||grade===''}>Save Grade</button>
            <button className={styles.submitBtn} style={{background:'#10e88a',color:'#000'}} onClick={()=>save(true)} disabled={saving||grade===''}>Save &amp; Return</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GRADE BOOK TAB
// ══════════════════════════════════════════════════════════════════════════════
function GradeBookTab({classroomId,classroom,th,showToast,posts}){
  const[data,setData]=useState({});const[loading,setLoading]=useState(true);const[selectedStudent,setSelectedStudent]=useState(null);
  const assignments=posts.filter(p=>p.type==='assignment');
  const students=classroom?.members?.filter(m=>m.role==='student')||[];
  useEffect(()=>{if(!students.length){setLoading(false);return;}
    Promise.all(assignments.map(async a=>{const r=await fetch(`${API}/api/classrooms/${classroomId}/posts/${a.postId}/submissions?role=teacher&userId=${classroom.creatorId}`);const d=await r.json();return{postId:a.postId,submissions:Array.isArray(d)?d:[]};
    })).then(results=>{const m={};results.forEach(r=>{m[r.postId]=r.submissions;});setData(m);setLoading(false);}).catch(()=>setLoading(false));
  },[]);
  const getSub=(studentId,postId)=>data[postId]?.find(s=>s.studentId===studentId);
  const getAvg=(studentId)=>{const graded=assignments.filter(a=>getSub(studentId,a.postId)?.grade!=null);if(!graded.length) return null;return(graded.reduce((sum,a)=>sum+getSub(studentId,a.postId).grade,0)/graded.length).toFixed(1);};
  const handleInlineSave=async(postId,subId,grade)=>{
    await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}/submissions/${subId}/grade`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:Number(grade),status:'graded'})});
    setData(d=>({...d,[postId]:d[postId]?.map(s=>s.submissionId===subId?{...s,grade:Number(grade),status:'graded'}:s)||[]}));
    showToast('Grade saved!');
  };
  const exportCSV=()=>{
    const rows=[['Student',...assignments.map(a=>a.title),'Average']];
    students.forEach(st=>{const row=[st.userName,...assignments.map(a=>getSub(st.userId,a.postId)?.grade??''),getAvg(st.userId)??''];rows.push(row);});
    const csv=rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=`${classroom.name}-grades.csv`;a.click();showToast('Grades exported!');
  };
  if(loading) return<div className={styles.loadingRow}><div className={styles.spinnerSm}/>Loading grade book…</div>;
  if(!students.length) return<div className={styles.emptyState}><span>👥</span><strong>No students yet</strong></div>;
  if(selectedStudent){
    const st=students.find(s=>s.userId===selectedStudent);
    return(
      <div>
        <button className={styles.backLink} onClick={()=>setSelectedStudent(null)}>← Grade Book</button>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}><Avatar name={st.userName} size={48}/><div><h3 style={{fontSize:20,fontWeight:800,fontFamily:'var(--font-head)'}}>{st.userName}</h3><div style={{fontSize:13,color:'var(--text-2)'}}>Avg: <strong style={{color:getAvg(st.userId)?gradeColor(Number(getAvg(st.userId))):'var(--text-3)'}}>{getAvg(st.userId)||'—'}</strong></div></div></div>
        {assignments.map(a=>{const sub=getSub(st.userId,a.postId);return(
          <div key={a.postId} className={styles.subCard} style={{cursor:'default'}}>
            <div className={styles.subCardLeft}><div style={{fontSize:13,fontWeight:700}}>{a.title}</div>{a.dueDate&&<span className={`${styles.dueChip} ${isOverdue(a.dueDate)?styles.dueChipOverdue:''}`}>Due {fmtDate(a.dueDate)}</span>}</div>
            <div className={styles.subCardRight}>
              {sub?(<><div className={styles.subGrade} style={{color:sub.grade!=null?gradeColor(pct(sub.grade,a.points||100)):'var(--text-2)'}}><span className={styles.subGradeNum}>{sub.grade??'—'}</span><span className={styles.subGradeOf}>/{a.points||'?'}</span></div><span className={`${styles.subStatusPill} ${styles[`sub_${sub.status}`]}`}>{sub.status}</span></>):<span className={styles.missingTag}>Missing</span>}
            </div>
          </div>
        );})}
      </div>
    );
  }
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:800}}>📊 Grade Book</h3>
        <button className={styles.btnGhost} onClick={exportCSV}>⬇ Export CSV</button>
      </div>
      <div className={styles.gradeBookLayout}>
        <div className={styles.studentList}>
          <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:1}}>Students ({students.length})</div>
          {students.map(st=>{const avg=getAvg(st.userId);return(
            <div key={st.userId} className={`${styles.studentListItem} ${selectedStudent===st.userId?styles.studentListItemActive:''}`} onClick={()=>setSelectedStudent(st.userId)}>
              <Avatar name={st.userName} size={30}/>
              <span className={styles.studentListName}>{st.userName}</span>
              {avg&&<span className={styles.studentListAvg} style={{color:gradeColor(Number(avg))}}>{avg}</span>}
            </div>
          );})}
        </div>
        <div style={{overflowX:'auto'}}>
          <table className={styles.gradeTable}>
            <thead><tr><th>Student</th>{assignments.map(a=><th key={a.postId} title={a.title}>{a.title.length>14?a.title.slice(0,14)+'…':a.title}<br/><span style={{fontSize:9,opacity:.6}}>{a.points?`/${a.points}`:''}</span></th>)}<th>Avg</th></tr></thead>
            <tbody>{students.map(st=>{const avg=getAvg(st.userId);return(
              <tr key={st.userId}>
                <td style={{fontWeight:600,fontSize:13,whiteSpace:'nowrap'}}><span style={{cursor:'pointer',color:th.accent}} onClick={()=>setSelectedStudent(st.userId)}>{st.userName}</span></td>
                {assignments.map(a=>{const sub=getSub(st.userId,a.postId);return(
                  <td key={a.postId}>
                    {sub?(
                      <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'center'}}>
                        <input className={styles.inlineGradeInput}
                          type="number" min={0} max={a.points||9999}
                          defaultValue={sub.grade??''} placeholder="—"
                          style={{color:sub.grade!=null?gradeColor(pct(sub.grade,a.points||100)):undefined}}
                          onBlur={e=>{const v=e.target.value;if(v!==''&&v!==(sub.grade?.toString()||'')) handleInlineSave(a.postId,sub.submissionId,v);}}/>
                        {sub.grade!=null&&<GradeBar value={sub.grade} max={a.points||100} thin/>}
                      </div>
                    ):<span style={{color:'var(--text-4)',fontSize:12}}>—</span>}
                  </td>
                );})}
                <td className={styles.gradeCell} style={{color:avg?gradeColor(Number(avg)):'var(--text-4)'}}>{avg??'—'}</td>
              </tr>
            );})}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({classroomId,classroom,th,posts}){
  const[analytics,setAnalytics]=useState(null);const[loading,setLoading]=useState(true);
  useEffect(()=>{fetch(`${API}/api/classrooms/${classroomId}/analytics`).then(r=>r.json()).then(setAnalytics).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const assignments=posts.filter(p=>p.type==='assignment');const students=classroom?.members?.filter(m=>m.role==='student')||[];
  if(loading) return<div className={styles.loadingRow}><div className={styles.spinnerSm}/>Loading analytics…</div>;
  const gradeDistribution=[{label:'A (90-100)',color:'#10e88a'},{label:'B (80-89)',color:'#60a5fa'},{label:'C (70-79)',color:'var(--amber)'},{label:'D (60-69)',color:'#fb923c'},{label:'F (<60)',color:'var(--red)'}];
  const submissionRate=analytics?.submissionRate||0;const avgGrade=analytics?.averageGrade||0;const totalPosts=posts.length;
  return(
    <div data-testid="analytics-root">
      <div className={styles.statsGrid}>
        <StatCard icon="👥" label="Students" value={students.length} color="#60a5fa"/>
        <StatCard icon="📋" label="Assignments" value={assignments.length} color={th.accent}/>
        <StatCard icon="📊" label="Avg Grade" value={avgGrade?`${avgGrade}%`:'—'} color={avgGrade?gradeColor(avgGrade):'#64748b'}/>
        <StatCard icon="📥" label="Submit Rate" value={submissionRate?`${submissionRate}%`:'—'} color="#10e88a"/>
        <StatCard icon="📢" label="Total Posts" value={totalPosts} color="#b197fc"/>
      </div>
      <div className={styles.analyticsGrid}>
        <div className={styles.analyticsCard}>
          <div className={styles.analyticsTitle}>📊 Submissions by Assignment</div>
          {assignments.slice(0,6).map(a=>{const rate=analytics?.byAssignment?.[a.postId]?.submissionRate||0;return(
            <div key={a.postId} className={styles.barChartRow}>
              <div className={styles.barChartLabel} title={a.title}>{a.title.length>12?a.title.slice(0,12)+'…':a.title}</div>
              <div className={styles.barChartBar}><div className={styles.barChartFill} style={{width:`${rate}%`,background:`linear-gradient(90deg,${th.accent},${th.accent}88)`}}/></div>
              <div className={styles.barChartVal}>{rate}%</div>
            </div>
          );})}
          {!assignments.length&&<div style={{fontSize:12,color:'var(--text-3)',textAlign:'center',padding:'20px 0'}}>No assignments yet</div>}
        </div>
        <div className={styles.analyticsCard}>
          <div className={styles.analyticsTitle}>🏅 Grade Distribution</div>
          <div className={styles.donutWrap}>
            {gradeDistribution.map(g=>{const count=analytics?.gradeDistribution?.[g.label]||0;return(
              <div key={g.label} className={styles.donutRow}>
                <div className={styles.donutDot} style={{background:g.color}}/>
                <div className={styles.donutLabel}>{g.label}</div>
                <div className={styles.donutVal} style={{color:g.color}}>{count}</div>
                <div style={{flex:1,height:6,background:'var(--surface3)',borderRadius:3,overflow:'hidden',marginLeft:8}}><div style={{height:'100%',background:g.color,width:`${Math.min(count*10,100)}%`,borderRadius:3,transition:'width .5s'}}/></div>
              </div>
            );})}
          </div>
        </div>
        <div className={styles.analyticsCard}>
          <div className={styles.analyticsTitle}>📈 Activity Timeline</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {posts.slice(0,8).map(p=><div key={p.postId} style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
              <span style={{fontSize:14}}>{p.type==='assignment'?'📋':p.type==='material'?'📚':p.type==='quiz'?'🧠':'📢'}</span>
              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--text-2)'}}>{p.title||p.body?.slice(0,30)||'—'}</span>
              <span style={{fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)',flexShrink:0}}>{fmtDate(p.createdAt)}</span>
            </div>)}
            {!posts.length&&<div style={{fontSize:12,color:'var(--text-3)',textAlign:'center',padding:'20px 0'}}>No activity yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ══════════════════════════════════════════════════════════════════════════════
function AttendanceTab({classroomId,classroom,sessions,th,showToast}){
  const[selected,setSelected]=useState(sessions[0]?._id||null);const[records,setRecords]=useState([]);const[saving,setSaving]=useState(false);const[loading,setLoading]=useState(false);
  const students=classroom?.members?.filter(m=>m.role==='student')||[];
  useEffect(()=>{if(!selected) return;setLoading(true);
    fetch(`${API}/api/classrooms/${classroomId}/attendance?sessionId=${selected}`).then(r=>r.json()).then(d=>{setRecords(Array.isArray(d)?d:[]);}).catch(()=>setRecords([])).finally(()=>setLoading(false));
  },[selected]);
  const getStatus=(studentId)=>records.find(r=>r.studentId===studentId)?.status||null;
  const markAll=(status)=>{setRecords(students.map(s=>({studentId:s.userId,studentName:s.userName,status})));};
  const mark=(studentId,studentName,status)=>{setRecords(p=>{const idx=p.findIndex(r=>r.studentId===studentId);if(idx>=0){const n=[...p];n[idx]={...n[idx],status};return n;}return[...p,{studentId,studentName,status}];});};
  const save=async()=>{setSaving(true);try{await fetch(`${API}/api/classrooms/${classroomId}/attendance`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:selected,records})});showToast('Attendance saved!');}catch{}finally{setSaving(false);};};
  const fromPresence=async()=>{
    if(!selected) return;
    const sess=sessions.find(s=>s._id===selected);
    if(!sess?.roomId){showToast('Session has no room');return;}
    setLoading(true);
    try{
      const r=await fetch(`${API}/api/classrooms/${classroomId}/attendance/from-presence`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:selected,roomId:sess.roomId})});
      const d=await r.json();
      if(Array.isArray(d?.records)) setRecords(d.records);
      else if(Array.isArray(d)) setRecords(d);
      showToast('Marked from live presence');
    }catch{showToast('Could not load presence');}
    finally{setLoading(false);}
  };
  const present=records.filter(r=>r.status==='present').length;const absent=records.filter(r=>r.status==='absent').length;const late=records.filter(r=>r.status==='late').length;
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <select className={styles.formInput} style={{flex:'0 0 auto',minWidth:200}} value={selected||''} onChange={e=>setSelected(e.target.value)}>
          {sessions.map(s=><option key={s._id} value={s._id}>{fmtDate(s.startedAt)} – {s.hostName}</option>)}
        </select>
        {records.length>0&&<div className={styles.attendanceSummary}><span style={{color:'#10e88a'}}>✓ {present}</span><span style={{color:'var(--red)'}}>✕ {absent}</span><span style={{color:'var(--amber)'}}>⏱ {late}</span></div>}
        <button className={styles.btnGhost} onClick={()=>markAll('present')}>All Present</button>
        <button className={styles.btnGhost} onClick={fromPresence} disabled={!selected||loading}>From live presence</button>
        <button className={styles.btnDanger} onClick={()=>markAll('absent')}>All Absent</button>
        <button className={styles.submitBtn} style={{background:th.accent,color:'#000',marginLeft:'auto'}} onClick={save} disabled={saving}>{saving?'Saving…':'Save Attendance'}</button>
      </div>
      {!sessions.length&&<div className={styles.emptyState}><span>📅</span><strong>No sessions yet</strong><p>Start a live session to track attendance.</p></div>}
      {sessions.length>0&&loading&&<div className={styles.loadingRow}><div className={styles.spinnerSm}/>Loading…</div>}
      {sessions.length>0&&!loading&&(
        <div className={styles.attendanceGrid}>
          {students.map(st=>{const status=getStatus(st.userId);return(
            <div key={st.userId} className={styles.attendanceCard}>
              <Avatar name={st.userName}/>
              <span style={{fontSize:13,fontWeight:600,flex:1}}>{st.userName}</span>
              <div className={styles.attendanceRight}>
                <button className={`${styles.attendBtn} ${styles.attendBtnP} ${status==='present'?styles.attendBtnActive:''}`} onClick={()=>mark(st.userId,st.userName,'present')}>P</button>
                <button className={`${styles.attendBtn} ${styles.attendBtnA} ${status==='absent'?styles.attendBtnActive:''}`} onClick={()=>mark(st.userId,st.userName,'absent')}>A</button>
                <button className={`${styles.attendBtn} ${styles.attendBtnL} ${status==='late'?styles.attendBtnActive:''}`} onClick={()=>mark(st.userId,st.userName,'late')}>L</button>
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MATERIALS TAB
// ══════════════════════════════════════════════════════════════════════════════
function MaterialsTab({classroomId,posts,setPosts,isTeacher,userId,userName,th,fetchPosts,showToast}){
  const[creating,setCreating]=useState(false);const[form,setForm]=useState({title:'',body:'',topic:''});const[files,setFiles]=useState([]);const[posting,setPosting]=useState(false);
  const materials=posts.filter(p=>p.type==='material');
  const topics=[...new Set(materials.map(m=>m.topic||'General'))];
  const handleCreate=async()=>{if(!form.title.trim()) return;setPosting(true);try{const attachments=await uploadFilesToBlob(classroomId,files);const r=await fetch(`${API}/api/classrooms/${classroomId}/posts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,type:'material',authorId:userId,authorName:userName,attachments})});const d=await r.json();setPosts(p=>[d,...p]);setCreating(false);setForm({title:'',body:'',topic:''});setFiles([]);showToast('Material posted!');}catch{}finally{setPosting(false);};};
  const handleDelete=async(postId)=>{if(!window.confirm('Delete?')) return;await fetch(`${API}/api/classrooms/${classroomId}/posts/${postId}`,{method:'DELETE'});setPosts(p=>p.filter(x=>x.postId!==postId));showToast('Deleted');};
  return(
    <div>
      <div className={styles.assignHeader}>
        <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:800}}>📚 Materials</h3>
        {isTeacher&&<button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={()=>setCreating(c=>!c)}>{creating?'✕ Cancel':'+ Add Material'}</button>}
      </div>
      {creating&&(
        <div className={styles.formSection} style={{borderColor:th.border}}>
          <div className={styles.formTitle}>📚 New Material</div>
          <input className={styles.formInput} placeholder="Title *" value={form.title} autoFocus onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
          <textarea className={styles.formTextarea} placeholder="Description…" rows={3} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} style={{marginTop:8}}/>
          <input className={styles.formInput} placeholder="Topic / Unit" value={form.topic} onChange={e=>setForm(f=>({...f,topic:e.target.value}))} style={{marginTop:8}}/>
          <div style={{marginTop:10}}><FileDrop files={files} setFiles={setFiles}/></div>
          <div className={styles.formActions}><button className={styles.cancelBtn} onClick={()=>{setCreating(false);setFiles([])}}>Cancel</button><button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={handleCreate} disabled={posting||!form.title.trim()}>{posting?'Posting…':'Post Material'}</button></div>
        </div>
      )}
      {materials.length===0&&!creating&&<div className={styles.emptyState}><span>📚</span><strong>No materials yet</strong><p>{isTeacher?'Post study materials for your students.':'Your teacher hasn\'t posted any materials yet.'}</p></div>}
      {topics.map(topic=>{
        const items=materials.filter(m=>(m.topic||'General')===topic);
        if(!items.length) return null;
        return(
          <div key={topic} className={styles.topicGroup}>
            {topics.length>1&&<div className={styles.topicGroupLabel}><span>📁</span>{topic}</div>}
            <div className={styles.materialsGrid}>
              {items.map(m=>(
                <div key={m.postId} className={styles.materialCard} style={{borderColor:th.border}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
                    <div className={styles.materialIcon}>{m.attachments?.length?fileIcon(m.attachments[0]?.mime):'📄'}</div>
                    {isTeacher&&<button className={styles.deleteIconBtn} onClick={()=>handleDelete(m.postId)}>🗑</button>}
                  </div>
                  <div className={styles.materialTitle}>{m.title}</div>
                  {m.topic&&<span className={styles.topicChip}>{m.topic}</span>}
                  {m.body&&<div className={styles.materialMeta}>{m.body.slice(0,100)}</div>}
                  {m.attachments?.length>0&&<div className={styles.fileList}>{m.attachments.map((f,i)=><FileCard key={i} file={f} classroomId={classroomId}/>)}</div>}
                  <div className={styles.materialMeta}>{fmtRel(m.createdAt)} · {m.authorName}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// QUIZZES TAB
// ══════════════════════════════════════════════════════════════════════════════
function QuizzesTab({classroomId,posts,setPosts,isTeacher,userId,userName,th,showToast}){
  const[creating,setCreating]=useState(false);const[form,setForm]=useState({title:'',body:''});const[questions,setQuestions]=useState([{text:'',options:['',''],correct:0,points:1}]);const[posting,setPosting]=useState(false);const[taking,setTaking]=useState(null);
  const quizzes=posts.filter(p=>p.type==='quiz');
  const addQ=()=>setQuestions(q=>[...q,{text:'',options:['',''],correct:0,points:1}]);
  const updQ=(i,v)=>setQuestions(q=>q.map((x,j)=>j===i?{...x,...v}:x));
  const addOpt=(qi)=>setQuestions(q=>q.map((x,j)=>j===qi?{...x,options:[...x.options,'']}:x));
  const updOpt=(qi,oi,v)=>setQuestions(q=>q.map((x,j)=>j===qi?{...x,options:x.options.map((o,k)=>k===oi?v:o)}:x));
  const handleCreate=async()=>{if(!form.title.trim()||!questions.length) return;setPosting(true);try{const r=await fetch(`${API}/api/classrooms/${classroomId}/posts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,type:'quiz',authorId:userId,authorName:userName,quizQuestions:questions.map(q=>({...q,text:q.text}))})});const d=await r.json();setPosts(p=>[d,...p]);setCreating(false);setForm({title:'',body:''});setQuestions([{text:'',options:['',''],correct:0,points:1}]);showToast('Quiz created!');}catch{}finally{setPosting(false);};};
  if(taking){const quiz=quizzes.find(p=>p.postId===taking);if(!quiz){setTaking(null);return null;}return<QuizTake quiz={quiz} classroomId={classroomId} userId={userId} userName={userName} th={th} onBack={()=>setTaking(null)} showToast={showToast}/>;}
  return(
    <div>
      <div className={styles.assignHeader}>
        <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:800}}>🧠 Quizzes</h3>
        {isTeacher&&<button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={()=>setCreating(c=>!c)}>{creating?'✕ Cancel':'+ Create Quiz'}</button>}
      </div>
      {creating&&(
        <div className={styles.formSection} style={{borderColor:th.border}}>
          <div className={styles.formTitle}>🧠 New Quiz</div>
          <input className={styles.formInput} placeholder="Quiz title *" value={form.title} autoFocus onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
          <textarea className={styles.formTextarea} placeholder="Instructions…" rows={2} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} style={{marginTop:8}}/>
          <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:12}}>
            {questions.map((q,qi)=>(
              <div key={qi} style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:16,padding:14}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-3)',fontWeight:700}}>Q{qi+1}</span>
                  <input className={styles.formInput} style={{flex:1}} placeholder="Question text *" value={q.text} onChange={e=>updQ(qi,{text:e.target.value})}/>
                  <input className={styles.formInput} style={{width:60}} type="number" min={1} placeholder="pts" value={q.points} onChange={e=>updQ(qi,{points:Number(e.target.value)})}/>
                  {questions.length>1&&<button className={styles.deleteIconBtn} onClick={()=>setQuestions(qs=>qs.filter((_,j)=>j!==qi))}>🗑</button>}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {q.options.map((o,oi)=>(
                    <div key={oi} style={{display:'flex',alignItems:'center',gap:8}}>
                      <input type="radio" checked={q.correct===oi} onChange={()=>updQ(qi,{correct:oi})} style={{accentColor:th.accent,width:15,height:15,flexShrink:0}}/>
                      <input className={styles.formInput} style={{flex:1}} placeholder={`Option ${String.fromCharCode(65+oi)}`} value={o} onChange={e=>updOpt(qi,oi,e.target.value)}/>
                      {q.options.length>2&&<button className={styles.deleteIconBtn} onClick={()=>updQ(qi,{options:q.options.filter((_,k)=>k!==oi),correct:q.correct>=oi?Math.max(0,q.correct-1):q.correct})}>✕</button>}
                    </div>
                  ))}
                  {q.options.length<6&&<button className={styles.btnGhost} style={{alignSelf:'flex-start',fontSize:11}} onClick={()=>addOpt(qi)}>+ Add Option</button>}
                </div>
              </div>
            ))}
          </div>
          <button className={styles.btnGhost} style={{marginTop:8}} onClick={addQ}>+ Add Question</button>
          <div className={styles.formActions}><button className={styles.cancelBtn} onClick={()=>setCreating(false)}>Cancel</button><button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={handleCreate} disabled={posting||!form.title.trim()}>{posting?'Creating…':'Create Quiz'}</button></div>
        </div>
      )}
      {quizzes.length===0&&!creating&&<div className={styles.emptyState}><span>🧠</span><strong>No quizzes yet</strong><p>{isTeacher?'Create a quiz to test your students.':'No quizzes posted yet.'}</p></div>}
      {quizzes.map(q=>(
        <div key={q.postId} className={styles.quizCard} onClick={()=>setTaking(q.postId)}>
          <div className={styles.quizCardHeader}>
            <span style={{fontSize:26}}>🧠</span>
            <span className={styles.quizCardTitle}>{q.title}</span>
            <span className={styles.quizCountBadge}>{q.quizQuestions?.length||0} Qs</span>
          </div>
          {q.body&&<div style={{fontSize:13,color:'var(--text-2)',marginBottom:8}}>{q.body}</div>}
          <div className={styles.quizCardMeta}><span style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>{fmtDate(q.createdAt)} · {q.authorName}</span>{q.quizQuestions?.reduce((a,x)=>a+(x.points||1),0)>0&&<span className={styles.ptChip}>{q.quizQuestions?.reduce((a,x)=>a+(x.points||1),0)} pts total</span>}</div>
          <div style={{marginTop:8,fontSize:11,color:th.accent,fontWeight:700}}>Take Quiz →</div>
        </div>
      ))}
    </div>
  );
}

function QuizTake({quiz,classroomId,userId,userName,th,onBack,showToast}){
  const[answers,setAnswers]=useState({});const[submitted,setSubmitted]=useState(false);const[score,setScore]=useState(null);const[submitting,setSubmitting]=useState(false);
  const qs=quiz.quizQuestions||[];const total=qs.reduce((a,q)=>a+(q.points||1),0);
  const handleSubmit=async()=>{
    setSubmitting(true);
    const ansArr=qs.map((_,i)=>answers[i]??-1);
    try{
      const r=await fetch(`${API}/api/classrooms/${classroomId}/posts/${quiz.postId}/submissions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quizAnswers:ansArr})});
      const d=await r.json();
      const sc=d.quizScore!=null?d.quizScore:qs.reduce((a,q,i)=>a+(answers[i]===q.correct?(q.points||1):0),0);
      setScore(sc);setSubmitted(true);showToast(`Quiz submitted! Score: ${sc}/${total}`);
    }catch{showToast('Submit failed');}finally{setSubmitting(false);}
  };
  if(submitted&&score!==null){
    const p=Math.round((score/total)*100);const c=gradeColor(p);
    return(
      <div className={styles.quizPanel}>
        <button className={styles.backLink} onClick={onBack}>← Back to Quizzes</button>
        <div className={styles.quizResultBox}><div style={{fontSize:44}}>🎉</div><div className={styles.quizScore} style={{color:c}}>{score}/{total}</div><div className={styles.quizGrade} style={{color:c}}>{p}% — {gradeLetter(p)}</div><GradeBar value={score} max={total}/></div>
        <div style={{marginTop:16}}>
          {qs.map((q,i)=>{const sel=answers[i];const correct=q.correct;const isRight=sel===correct;return(
            <div key={i} className={styles.quizQuestion}><div className={styles.quizQNum}>Question {i+1}</div><div className={styles.quizQText}>{q.text||q.question}</div>
              {q.options.map((o,oi)=>(
                <div key={oi} className={`${styles.quizOption} ${oi===correct?styles.quizOptionCorrect:''} ${sel===oi&&!isRight?styles.quizOptionWrong:''}`}>
                  <div className={styles.quizRadio} style={oi===correct?{background:'#10e88a',borderColor:'#10e88a'}:{}}/>
                  {o} {oi===correct?'✓ Correct':sel===oi&&!isRight?'✗ Your answer':''}
                </div>
              ))}
            </div>
          );})}
        </div>
      </div>
    );
  }
  return(
    <div className={styles.quizPanel}>
      <button className={styles.backLink} onClick={onBack}>← Back to Quizzes</button>
      <h2 style={{fontFamily:'var(--font-head)',fontSize:22,fontWeight:800,marginBottom:4}}>{quiz.title}</h2>
      {quiz.body&&<p style={{fontSize:13,color:'var(--text-2)',marginBottom:16}}>{quiz.body}</p>}
      <div style={{fontSize:12,color:'var(--text-3)',marginBottom:20,fontFamily:'var(--font-mono)'}}>{qs.length} questions · {total} pts total</div>
      {qs.map((q,i)=>(
        <div key={i} className={styles.quizQuestion}><div className={styles.quizQNum}>Question {i+1} · {q.points||1} pt{(q.points||1)!==1?'s':''}</div><div className={styles.quizQText}>{q.text||q.question}</div>
          {q.options.map((o,oi)=>(
            <div key={oi} className={`${styles.quizOption} ${answers[i]===oi?styles.quizOptionSelected:''}`} onClick={()=>setAnswers(a=>({...a,[i]:oi}))}>
              <div className={styles.quizRadio}/><span style={{fontWeight:answers[i]===oi?700:400}}>{o}</span>
            </div>
          ))}
        </div>
      ))}
      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onBack}>Cancel</button>
        <button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={handleSubmit} disabled={submitting||Object.keys(answers).length<qs.length}>{submitting?'Submitting…':`Submit Quiz (${Object.keys(answers).length}/${qs.length} answered)`}</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PEOPLE TAB
// ══════════════════════════════════════════════════════════════════════════════
function PeopleTab({classroom,setClassroom,isTeacher,userId,th,fetchClassroom,classroomId,showToast}){
  const handleKick=async(memberId)=>{if(!window.confirm('Remove this student?')) return;await fetch(`${API}/api/classrooms/${classroomId}/members/${memberId}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId})});fetchClassroom();showToast('Student removed');};
  const teachers=[classroom.creatorId,...(classroom.members?.filter(m=>m.role==='teacher').map(m=>m.userId)||[])];
  const students=classroom.members?.filter(m=>m.role==='student')||[];
  return(
    <div>
      <div style={{marginBottom:24}}>
        <div className={styles.sectionLabel}><span>👑</span>Teacher{teachers.length>1?'s':''}</div>
        <div className={styles.peopleGrid}>
          <div className={styles.personCard} style={{borderColor:th.border}}>
            <div className={styles.ownerBadge}>Owner</div>
            <Avatar name={classroom.creatorName} size={56}/>
            <div className={styles.personName}>{classroom.creatorName}</div>
            <div className={styles.personRole} style={{color:th.accent}}>Teacher</div>
          </div>
          {classroom.members?.filter(m=>m.role==='teacher').map(m=>(
            <div key={m.userId} className={styles.personCard} style={{borderColor:th.border}}>
              <Avatar name={m.userName} size={56}/>
              <div className={styles.personName}>{m.userName}</div>
              <div className={styles.personRole} style={{color:th.accent}}>Teacher</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className={styles.sectionLabel} style={{marginBottom:10}}><span>👥</span>Students ({students.length})</div>
        {students.length===0&&<div className={styles.emptyState}><span>👥</span><strong>No students yet</strong><p>Share the invite code to add students.</p></div>}
        <div className={styles.peopleGrid}>
          {students.map(m=>(
            <div key={m.userId} className={styles.personCard}>
              <Avatar name={m.userName} size={56}/>
              <div className={styles.personName}>{m.userName}</div>
              <div className={styles.personRole} style={{color:'var(--text-3)'}}>Student</div>
              {isTeacher&&m.userId!==userId&&(
                <div className={styles.personCardActions}>
                  <button className={styles.kickBtn} onClick={()=>handleKick(m.userId)}>Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSIONS TAB
// ══════════════════════════════════════════════════════════════════════════════
function SessionsTab({sessions,th,navigate,classroomId}){
  const[expanded,setExpanded]=useState({});
  if(!sessions.length) return<div className={styles.emptyState}><span>🎥</span><strong>No sessions yet</strong><p>Start a live session from the classroom banner.</p></div>;
  return(
    <div>
      <div style={{marginBottom:16,display:'flex',alignItems:'center',gap:10}}><h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:800}}>🎥 Session History</h3><span style={{fontSize:12,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>{sessions.length} session{sessions.length!==1?'s':''}</span></div>
      {[...sessions].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt)).map(s=>{
        const live=!s.endedAt;const dur=fmtDur(s.startedAt,s.endedAt);const chat=s.chatLog||[];const open=expanded[s._id];
        return(
          <div key={s._id} className={styles.sessionCard} style={live?{borderColor:th.border,boxShadow:`0 0 20px ${th.glow}`}:{}}>
            <div className={styles.sessionCardTop}>
              <span style={{fontSize:24}}>🎥</span>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span className={styles.sessionTitle}>{fmtDate(s.startedAt)}</span>
                  {live&&<span className={styles.sessionLivePill}>● LIVE</span>}
                </div>
                <div className={styles.sessionMeta}><span>Host: {s.hostName}</span>{dur&&<span>Duration: {dur}</span>}<span>Started: {fmtTime(s.startedAt)}</span>{s.endedAt&&<span>Ended: {fmtTime(s.endedAt)}</span>}</div>
              </div>
              {live&&<button className={styles.submitBtn} style={{background:th.accent,color:'#000'}} onClick={()=>navigate(`/room/${s.roomId}?classroom=${classroomId}`)}>Join →</button>}
            </div>
            {chat.length>0&&(
              <>
                <button className={styles.postActionBtn} onClick={()=>setExpanded(e=>({...e,[s._id]:!open}))}>{open?'▲ Hide':'💬 View'} Chat Log ({chat.length})</button>
                {open&&<div className={styles.sessionChatLog}>{chat.map((m,i)=><div key={i} className={styles.chatLogLine}><span className={styles.chatLogUser}>{m.userName}</span>: {m.message}</div>)}</div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
