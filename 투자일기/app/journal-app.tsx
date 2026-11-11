'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {Home,Users,Heart,Trophy,UserRound,ArrowDownWideNarrow,ArrowUpRight,ArrowRight,BookOpen,Bookmark,CalendarDays,ChartNoAxesCombined,Check,CheckCheck,ChevronDown,ChevronLeft,ChevronRight,Copy,Download,Feather,History,Leaf,Lightbulb,LockKeyhole,LoaderCircle,MessageCircle,MoreHorizontal,Pencil,Plus,Search,Settings2,ShieldCheck,SlidersHorizontal,Sparkles,Star,Trash2,Undo2,Wallet,X} from 'lucide-react';
import UsefulSites from './useful-sites';
import CommunitySpace from './community-space';
import CashTargetCard from './cash-target-card';
import './community.css';
import {FavoritesEmpty,FavoritesIntro} from './favorites-ui';
import {DiaryImages,ImageAttachmentsEditor} from './image-attachments';
import DiaryInsight from './diary-insight';
import {blankDiary,dateLabel,EMOTIONS,SENTIMENTS,seoulToday,weekday,type Diary,type Sentiment} from './lib/model';
const entryKey = (entry: Diary) => entry.id ?? entry.date;
const draftKey = (entry: Diary) => entry.id ?? 'new:' + entry.date;
const recentFirst = (a: Diary, b: Diary) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || entryKey(b).localeCompare(entryKey(a));
const CNN='https://edition.cnn.com/markets/fear-and-greed';
type User={id?:string;name:string;email:string}|null;
type Revision={version:number;savedAt:string;entry:Diary};
const styleFor=(value:Sentiment|null):CSSProperties=>{const s=SENTIMENTS.find(x=>x.value===value);return {'--sentiment':s?.color||'#b9c0b2','--sentiment-light':s?.light||'#f3f5ef'} as CSSProperties;};
async function request(url:string,init?:RequestInit){const r=await fetch(url,{...init,cache:'no-store',headers:{'Content-Type':'application/json',...init?.headers}});const data=await r.json().catch(()=>({error:'서버 응답을 확인할 수 없어요.'})) as {error?:string;entries:Diary[];entry:Diary;revisions:Revision[];trashCount:number;favoriteDates:string[];favoriteIds:string[];communityFavoriteCount:number;entryId:string;date:string;favorite:boolean};if(!r.ok)throw new Error(data.error||'요청에 실패했어요. 잠시 후 다시 시도해 주세요.');return data;}
export default function JournalApp({user}:{user:User}){
  const [entries,setEntries]=useState<Diary[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [demo,setDemo]=useState(false),[view,setView]=useState<'home'|'journal'|'community'|'top'|'sentiment'|'profile'|'review'|'links'|'favorites'>('home'),[modal,setModal]=useState<'editor'|'settings'|'history'|'delete'|'trash'|null>(null);
  const [search,setSearch]=useState(''),[sentimentFilter,setSentimentFilter]=useState(''),[emotionFilter,setEmotionFilter]=useState(''),[order,setOrder]=useState('desc');
  const [rangeOpen,setRangeOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState(''),[selectedDate,setSelectedDate]=useState('');
  const [calendarMonth,setCalendarMonth]=useState(seoulToday().slice(0,7)),[editor,setEditor]=useState<Diary>(blankDiary(seoulToday())),[saving,setSaving]=useState(false),[imageUploading,setImageUploading]=useState(false),[formError,setFormError]=useState('');
  const [toast,setToast]=useState(''),[revisions,setRevisions]=useState<Revision[]>([]),[historyEntry,setHistoryEntry]=useState<Diary|null>(null),[historyLoading,setHistoryLoading]=useState(false);
  const [deleteCandidate,setDeleteCandidate]=useState<Diary|null>(null),[trashEntries,setTrashEntries]=useState<Diary[]>([]),[trashCount,setTrashCount]=useState(0),[trashLoading,setTrashLoading]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<string[]>([]),[favoritePending,setFavoritePending]=useState<string[]>([]),[favoriteError,setFavoriteError]=useState('');
  const [communityFavoriteCount,setCommunityFavoriteCount]=useState(0);
  const favoriteLocks=useRef(new Set<string>());
  const drafts=useRef<Record<string,Diary>>({}),pending=useRef<{fingerprint:string;id:string}|null>(null);const [today,setToday]=useState(seoulToday());
  useEffect(()=>{const tick=setInterval(()=>setToday(seoulToday()),1000);return()=>clearInterval(tick);},[]);
  async function load(initial=false){setLoading(true);setError('');try{const d=await request('/api/entries');setEntries(d.entries);setFavoriteIds(d.favoriteIds||[]);setCommunityFavoriteCount(d.communityFavoriteCount||0);setTrashCount(d.trashCount||0);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{if(user)void load(true);else setLoading(false);const params=new URLSearchParams(location.search);const date=params.get('date');if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date){setView('journal');setSelectedDate(date);setCalendarMonth(date.slice(0,7));}},[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{if(!modal)return;const before=document.body.style.overflow;document.body.style.overflow='hidden';const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!saving)closeModal();};document.addEventListener('keydown',esc);return()=>{document.body.style.overflow=before;document.removeEventListener('keydown',esc);};},[modal,saving,editor,imageUploading]);
  useEffect(()=>{if(!modal)return;const previous=document.activeElement as HTMLElement|null;const dialog=document.querySelector<HTMLElement>('.modal');dialog?.querySelector<HTMLElement>('button')?.focus();const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab'||!dialog)return;const elements=Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length&&!el.closest('[inert]'));const first=elements[0],last=elements[elements.length-1];if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}};document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};},[modal]);
  useEffect(()=>{const h=(e:BeforeUnloadEvent)=>{if(modal==='editor'&&(editor.body.trim()||editor.title.trim()||editor.insight?.trim()||editor.images?.length||imageUploading)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[modal,editor,imageUploading]);
  function closeModal() {
    if (saving || imageUploading) return;
    if (modal === 'editor') drafts.current[draftKey(editor)] = editor;
    setModal(null);
    setFormError('');
  }

  async function openEditor(date = today, entryId?: string) {
    if (!user) { window.dispatchEvent(new Event('onki-auth')); return; }
    let entry: Diary | undefined;
    if (entryId) {
      try {
        const latest = await request('/api/entries?date='+encodeURIComponent(date));
        entry = latest.entries.find((record: Diary) => record.id === entryId);
        if (entry) upsertEntry(entry);
      } catch (error) { setToast((error as Error).message); return; }
    }
    if (entryId && !entry) {
      setToast('일기를 찾지 못했어요. 일기 목록을 새로고침해 주세요.');
      return;
    }
    const initial = entry ?? blankDiary(date);
    const draft = drafts.current[draftKey(initial)];
    setEditor(draft ? {...draft,commentCount:initial.commentCount,commentsEnabled:(initial.commentCount ?? 0)>0 ? true : draft.commentsEnabled} : {
      ...initial,
      shareEmotion: initial.visibility === 'sentiment' && initial.sharingVersion !== undefined && initial.shareEmotion === true,
    });
    setFormError('');
    setModal('editor');
  }

  function changeDate(date: string) {
    if (!date || imageUploading || editor.id) return;
    delete drafts.current[draftKey(editor)];
    setEditor(current => ({ ...current, date }));
    setFormError('');
  }

  function upsertEntry(entry: Diary) {
    setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)].sort(recentFirst));
  }
  const patch=(data:Partial<Diary>)=>setEditor(prev=>({...prev,...data}));
  async function saveEditor(){if(saving||imageUploading)return;if(editor.visibility!=='sentiment'&&!editor.body.trim()){setFormError('일기 내용을 입력해 주세요.');return;}if(editor.fearGreed&&(!Number.isFinite(editor.fearGreed.value)||editor.fearGreed.value<0||editor.fearGreed.value>100)){setFormError('CNN 지수는 0~100 사이로 입력해 주세요.');return;}
    if (editor.visibility === 'sentiment' && !editor.sentiment) {
      setFormError('공유할 시장 분위기를 선택해 주세요.');
      return;
    }

    setSaving(true);
    setFormError('');
    const { version, createdAt, updatedAt, date, deletedAt, publishedAt, sharingVersion, publishedImageIds, commentCount, id, ...data } = editor;
    const visibility = editor.visibility ?? 'private';
    const payload = {
      operation: id ? 'save' : 'create',
      ...(id ? { entryId: id } : {}),
      date,
      expectedVersion: version,
      sharingVersion: 4,
      data: {
        ...data,
        visibility,
        images: editor.images ?? [],
        shareEmotion: visibility === 'sentiment' && Boolean(editor.emotion) && editor.shareEmotion === true,
      },
    };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    try{const d=await request('/api/entries',{method:'POST',body:JSON.stringify({...payload,requestId:pending.current!.id})});upsertEntry(d.entry);delete drafts.current[draftKey(editor)];pending.current=null;setModal(null);setDemo(false);setSelectedDate('');setToast(`${dateLabel(d.entry.date)} 일기를 저장했어요.`);window.dispatchEvent(new Event('onki-data'));}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}
  async function showHistory(entry: Diary) {
    setHistoryEntry(entry);
    setRevisions([]);
    setFormError('');
    setModal('history');
    setHistoryLoading(true);
    try {
      const query = new URLSearchParams(entry.id ? { entryId: entry.id } : { date: entry.date });
      setRevisions((await request('/api/history?' + query)).revisions);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function restore(revision: Revision) {
    if (!historyEntry) return;
    setSaving(true);
    setFormError('');
    const current = entries.find(entry => entry.id === historyEntry.id) ?? historyEntry;
    const payload = {
      operation: 'restore', entryId: current.id, date: current.date,
      expectedVersion: current.version, revisionVersion: revision.version,
    };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await request('/api/entries', {
        method: 'POST', body: JSON.stringify({ ...payload, requestId: pending.current.id }),
      });
      upsertEntry(result.entry);
      delete drafts.current[draftKey(current)];
      pending.current = null;
      setModal(null);
      setToast(`버전 ${revision.version}의 내용으로 복구했어요.`);
      window.dispatchEvent(new Event('onki-data'));
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function askDelete(entry:Diary){setDeleteCandidate(entry);setFormError('');setModal('delete');}
  async function showTrash(){setTrashEntries([]);setFormError('');setModal('trash');setTrashLoading(true);try{const d=await request('/api/entries?trash=true');setTrashEntries(d.entries);setTrashCount(d.trashCount||0);}catch(e){setFormError((e as Error).message);}finally{setTrashLoading(false);}}
  async function moveToTrash(){if(!deleteCandidate)return;setSaving(true);setFormError('');const entry=deleteCandidate;const payload={operation:'delete',entryId:entry.id,date:entry.date,expectedVersion:entry.version};const fingerprint=JSON.stringify(payload);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};try{await request('/api/entries',{method:'POST',body:JSON.stringify({...payload,requestId:pending.current!.id})});setEntries(prev=>prev.filter(e=>e.id!==entry.id));setTrashCount(count=>count+1);delete drafts.current[draftKey(entry)];pending.current=null;setDemo(false);setSelectedDate('');setModal(null);setDeleteCandidate(null);setToast('일기를 삭제했어요. 휴지통에서 언제든 복구할 수 있어요.');window.dispatchEvent(new Event('onki-data'));}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}
  async function restoreDeleted(entry:Diary){setSaving(true);setFormError('');const payload={operation:'undelete',entryId:entry.id,date:entry.date,expectedVersion:entry.version};const fingerprint=JSON.stringify(payload);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};try{const d=await request('/api/entries',{method:'POST',body:JSON.stringify({...payload,requestId:pending.current!.id})});upsertEntry(d.entry);setTrashEntries(prev=>prev.filter(e=>e.id!==entry.id));setTrashCount(count=>Math.max(0,count-1));delete drafts.current[draftKey(entry)];pending.current=null;setDemo(false);void refreshFavorites();setToast(dateLabel(entry.date)+' 일기를 복구했어요.');window.dispatchEvent(new Event('onki-data'));}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}
  async function refreshFavorites() {
    try {
      const result = await request('/api/entries');
      setFavoriteIds(result.favoriteIds ?? []);
      setCommunityFavoriteCount(result.communityFavoriteCount ?? 0);
    } catch (error) {
      setFavoriteError((error as Error).message);
    }
  }
  useEffect(() => {
    if (!user) return;
    const refresh = () => void refreshFavorites();
    window.addEventListener('onki-bookmarks', refresh);
    return () => window.removeEventListener('onki-bookmarks', refresh);
  }, [user?.id]);

  async function toggleFavorite(entry: Diary) {
    const key = entryKey(entry);
    if (favoriteLocks.current.has(key)) return;
    favoriteLocks.current.add(key);
    setFavoritePending(current => [...current, key]);
    setFavoriteError('');
    try {
      const result = await request('/api/favorites', {
        method: 'POST', body: JSON.stringify({ entryId: entry.id, favorite: !favoriteIds.includes(key) }),
      });
      setFavoriteIds(current => result.favorite ? [...new Set([...current,key])] : current.filter(id => id !== key));
      setToast(result.favorite ? '즐겨찾기에 담았어요.' : '즐겨찾기를 해제했어요.');
    } catch (error) {
      setFavoriteError((error as Error).message);
    } finally {
      favoriteLocks.current.delete(key);
      setFavoritePending(current => current.filter(id => id !== key));
    }
  }
  async function copy(text:string){try{await navigator.clipboard.writeText(text);setToast('복사했어요.');}catch{setToast('브라우저에서 복사를 허용해 주세요.');}}
  function exportData(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),entries,favoriteIds, favoriteDates:[...new Set(entries.filter(e=>favoriteIds.includes(entryKey(e))).map(e=>e.date))]},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`온기-투자일기-${today}.json`;a.click();URL.revokeObjectURL(url);setToast('내 일기를 내보냈어요.');}
  const shown=entries;
  const favoriteEntries=useMemo(()=>entries.filter(e=>favoriteIds.includes(entryKey(e))),[entries,favoriteIds]);
  const emotionOptions=useMemo(()=>Array.from(new Set([...EMOTIONS.map(e=>e.value),...entries.flatMap(e=>e.emotion?[e.emotion]:[])])),[entries]);
  const activeFilters=Boolean(search||sentimentFilter||emotionFilter||from||to||selectedDate);
  const filtered=useMemo(()=>(view==='favorites'?favoriteEntries:shown).filter(e=>(!search||(e.title+' '+e.body+' '+(e.insight||'')+' '+e.trades.map(t=>t.symbol).join(' ')).toLowerCase().includes(search.toLowerCase()))&&(!sentimentFilter||e.sentiment===sentimentFilter)&&(!emotionFilter||(emotionFilter==='__empty__'?!e.emotion:e.emotion===emotionFilter))&&(!from||e.date>=from)&&(!to||e.date<=to)&&(!selectedDate||e.date===selectedDate)).sort((a,b)=>order==='desc'?recentFirst(a,b):recentFirst(b,a)),[shown,favoriteEntries,view,search,sentimentFilter,emotionFilter,from,to,selectedDate,order]);
  const latestWithCash = shown.find(entry => entry.cashRatio !== null);
  const latestCash = latestWithCash && { cashRatio: latestWithCash.cashRatio!, date: latestWithCash.date };
  const averageCash=shown.filter(x=>x.cashRatio!==null);const cash=averageCash.length?Math.round(averageCash.reduce((s,x)=>s+(x.cashRatio||0),0)/averageCash.length):null;
  const resetFilters=()=>{setSearch('');setSentimentFilter('');setEmotionFilter('');setFrom('');setTo('');setSelectedDate('');setRangeOpen(false);};
  const goJournal=()=>{if(view==='favorites')resetFilters();setView('journal');setSelectedDate('');};
  const goFavorites=()=>{resetFilters();setDemo(false);setView('favorites');window.scrollTo({top:0,behavior:'auto'});};
  const titles:Record<string,[string,string,string]>={home:['TOGETHER, ONE DAY AT A TIME','오늘의 생각을, 잊혀지지 않도록 간직해보세요',`${user?.name?user.name+'님, ':''}나의 투자 생각을 기록하고, 다른 투자자들의 마음을 이해하는 공간.`],journal:['A LITTLE RECORD, A BETTER INVESTOR','나의 투자 일기','시장의 흐름을 읽고, 나의 마음을 기록하는 시간.'],community:['DIFFERENT THOUGHTS, SHARED WARMTH','함께 읽는 투자 일기','시장을 바라보는 서로 다른 시선에 공감을 남겨 주세요.'],top:['TODAY’S MOST RESONANT THOUGHTS','오늘의 TOP 10','오늘, 가장 많은 공감을 받은 투자 생각을 만나보세요.'],sentiment:['HOW THE MARKET FEELS','우리가 바라보는 시장','매일의 기록이 모여, 시장의 마음을 보여줍니다.'],profile:['MY OWN PACE, MY OWN SPACE','마이페이지','나의 소개와 공개 범위를 차분히 살펴보세요.'],favorites:['MOMENTS WORTH COMING BACK TO','즐겨찾는 나의 기록','그때의 마음과 지금의 나를, 한 페이지에서 만나 보세요.'],review:['FINDING MY INVESTMENT RHYTHM','기록이 쌓이면, 나의 기준이 됩니다','숫자와 감정 사이에서 나의 투자 습관을 발견해 보세요.'],links:['A FEW TOOLS, A WIDER PERSPECTIVE','유용한 사이트','시장을 살펴보고 생각을 정리할 때, 자주 찾는 투자 도구들.']};
  const navItems=[{id:'home',label:'홈',icon:Home},{id:'journal',label:'나의 투자 일기',icon:BookOpen},{id:'community',label:'커뮤니티',icon:Users},{id:'top',label:'오늘의 TOP 10',icon:Trophy},{id:'sentiment',label:'시장 심리',icon:ChartNoAxesCombined},{id:'profile',label:'마이페이지',icon:UserRound}] as const;
  return <div className="app">
    <aside className="sidebar"><a className="brand" href="/" aria-label="온기 홈"><span className="brand-mark"><Leaf size={20} strokeWidth={1.6}/></span><div><div className="brand-name">온기</div><div className="brand-en">ON:GI JOURNAL</div></div></a><div className="nav-label">OUR INVESTMENT SPACE</div><nav className="nav" aria-label="주 메뉴">{navItems.map(item=><button key={item.id} className={view===item.id?'active':''} aria-current={view===item.id?'page':undefined} onClick={()=>{setView(item.id);window.scrollTo({top:0,behavior:'auto'});}}><item.icon size={17}/>{item.label}</button>)}</nav><div className="nav-label secondary-nav-label">나의 기록 서랍</div><nav className="nav secondary-nav" aria-label="기록 서랍"><button className={view==='favorites'?'active':''} onClick={goFavorites}><Star size={17}/>즐겨찾기<small>{favoriteEntries.length+communityFavoriteCount}</small></button><button className={view==='review'?'active':''} onClick={()=>setView('review')}><History size={17}/>기록 돌아보기</button><button className={view==='links'?'active':''} onClick={()=>setView('links')}><Bookmark size={17}/>유용한 사이트</button></nav><div className="sidebar-note"><Feather size={24} strokeWidth={1.2}/><p>좋은 투자는<br/>나를 이해하는 일에서<br/>시작됩니다.</p><small>하루의 생각을, 차곡차곡.</small></div><button className="sidebar-bottom profile-shortcut" onClick={()=>user?setView('profile'):window.dispatchEvent(new Event('onki-auth'))}><span className="avatar">{user?.name?.[0]?.toUpperCase()||'온'}</span><div className="profile-text"><strong>{user?.name||'온기에 오신 것을 환영해요'}</strong><span>{user?'나의 기록과 설정':'로그인하고 기록 시작하기'}</span></div><ChevronRight size={13}/></button></aside>
    <div className="shell"><header className="topbar"><div className="breadcrumbs">온기 <ChevronRight size={11}/><b>{titles[view][1]}</b></div><a href="/" className="mobile-brand"><span className="brand-mark"><Leaf size={15}/></span>온기</a><div className="topbar-right"><span>{dateLabel(today)}</span>{user&&<button className="mobile-favorites icon-button" type="button" onClick={goFavorites} aria-label="즐겨찾기"><Star size={16}/></button>}{user?<button className="top-profile" onClick={()=>setView('profile')} aria-label="마이페이지"><span className="avatar">{user.name?.[0]||'나'}</span></button>:<button className="secondary" onClick={()=>window.dispatchEvent(new Event('onki-auth'))}>로그인 · 회원가입</button>}</div></header>
    <main className="content"><div className="page-heading"><div><div className="eyebrow">{titles[view][0]}</div><h1>{titles[view][1]}</h1><p>{titles[view][2]}</p></div>{view!=='community'&&view!=='top'&&<button className="primary" onClick={()=>openEditor()}><Plus size={15}/>오늘 일기 작성</button>}</div>
    {(['home','community','top','sentiment','profile'] as string[]).includes(view)?<CommunitySpace mode={view as 'home'|'community'|'top'|'sentiment'|'profile'} user={user} entries={entries} onNavigate={setView} onEdit={openEditor} onSettings={()=>setModal('settings')}/>:view==='links'?<UsefulSites/>:!user?<div className="signin aside-card"><Leaf size={32}/><h2>나만의 투자 기록을 시작하세요</h2><p>로그인하면 나에게만 보이는 일기를 안전하게 보관하고,<br/>나누고 싶은 생각을 직접 골라 공유할 수 있어요.</p><button onClick={()=>window.dispatchEvent(new Event('onki-auth'))} className="primary">로그인 · 회원가입 <ArrowRight size={14}/></button></div>:<>
    {view==='favorites'?<FavoritesIntro count={favoriteEntries.length+communityFavoriteCount}/>:<div className="stats"><div className="stat-card"><div className="stat-label">차곡차곡 쌓인 기록 {demo&&<small>· 예시</small>}</div><span className="stat-icon"><BookOpen size={15}/></span><div className="stat-value">{String(shown.length).padStart(2,'0')}<small>개의 기록</small></div><div className="stat-footer">하루 한 번, 나를 돌아보기</div></div><CashTargetCard recent={latestCash}/><div className="stat-card stat-last"><div className="stat-label">최근 시장 분위기의 흐름 {demo&&<small>· 예시</small>}</div><div className="sentiment-mini">{[...shown].sort((a,b)=>a.date.localeCompare(b.date)).slice(-14).map(e=><i key={entryKey(e)} title={`${e.date} ${SENTIMENTS.find(s=>s.value===e.sentiment)?.ko||'미선택'}`} style={{background:SENTIMENTS.find(s=>s.value===e.sentiment)?.color||'#d5dcce'}}/>)}{!shown.length&&<span className="helper">첫 기록부터 흐름이 시작됩니다.</span>}</div><div className="trend-caption">{shown.length?'오래된 기록에서 최근 기록 순으로':'시장을 바라보는 나의 시선'}</div></div></div>}
    {error&&<div role="alert" className="error-banner">{error}<button onClick={()=>load()}>다시 시도</button></div>}
    {favoriteError&&<div className="error-banner" role="alert">{favoriteError}<button onClick={()=>setFavoriteError('')}>닫기</button></div>}
    {loading?<div className="loading"><LoaderCircle className="spin" size={22}/>일기를 불러오고 있어요.</div>:(view==='journal'||view==='favorites')?<div className="main-grid"><section aria-label={view==='favorites'?'즐겨찾는 투자 일기':'날짜별 투자 일기'}><div className="timeline-header"><div className="section-name">{view==='favorites'?'별을 남긴 기록':'일기의 흐름'} <span>{demo?'예시 ':''}{filtered.length}개의 기록</span></div><div className="timeline-actions"><button className="trash-button" aria-label="휴지통 열기" onClick={()=>showTrash()}><Trash2 size={12}/>휴지통{trashCount>0&&<span>{trashCount}</span>}</button><select aria-label="일기 정렬" value={order} onChange={e=>setOrder(e.target.value)}><option value="desc">최신 날짜순</option><option value="asc">오래된 날짜순</option></select><button className="icon-button" aria-label="기간 선택" aria-expanded={rangeOpen} onClick={()=>setRangeOpen(!rangeOpen)}><SlidersHorizontal size={13}/></button></div></div>
      <div className="filters journal-filters"><div className="search"><Search size={13}/><input aria-label="일기 검색" placeholder="어떤 생각을 기록했나요?" value={search} onChange={e=>setSearch(e.target.value)}/></div><select aria-label="시장 분위기 필터" className="filter-select" value={sentimentFilter} onChange={e=>setSentimentFilter(e.target.value)}><option value="">모든 시장 분위기</option>{SENTIMENTS.map(s=><option value={s.value} key={s.value}>{s.ko}</option>)}</select><select aria-label="나의 감정 필터" className="filter-select" value={emotionFilter} onChange={e=>setEmotionFilter(e.target.value)}><option value="">모든 나의 감정</option>{emotionOptions.map(value=><option value={value} key={value}>{EMOTIONS.find(e=>e.value===value)?.emoji} {value}</option>)}<option value="__empty__">감정 미입력</option></select></div>
      {rangeOpen&&<div className="date-filters"><label>시작 <input aria-label="조회 시작일" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><span>~</span><label>종료 <input type="date" aria-label="조회 종료일" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label><button className="text-btn" onClick={()=>{setFrom('');setTo('');setSelectedDate('');}}>초기화</button></div>}
      {selectedDate&&<div className="demo-banner"><CalendarDays size={12}/>{dateLabel(selectedDate)}의 기록<button onClick={()=>setSelectedDate('')}>전체 보기</button></div>}
      {demo&&<div className="demo-banner"><Sparkles size={12}/><span>화면을 살펴보기 위한 예시예요. 실제 투자 기록이 아닙니다.</span><button onClick={()=>setDemo(false)}>내 기록 보기</button></div>}
      {!filtered.length?view==='favorites'?<FavoritesEmpty hasFilters={activeFilters} onReset={resetFilters} onBrowse={goJournal}/>:<div className="empty"><Feather size={33} strokeWidth={1.2}/><h3>{activeFilters?'이 조건에 맞는 기록이 없어요':trashCount>0?'삭제한 기록은 휴지통에 보관돼 있어요':'오늘의 생각이, 내일의 기준이 되도록'}</h3><p>{activeFilters?'다른 날짜와 조건으로 일기를 찾아보세요.':trashCount>0?'복구하면 원래 날짜의 일기를 다시 볼 수 있어요.':'첫 투자 일기를 남겨 보세요. 짧은 한 문장도 괜찮아요.'}</p><button className="primary" onClick={()=>!entries.length&&trashCount>0?showTrash():openEditor(selectedDate||today)}>{!entries.length&&trashCount>0?<Undo2 size={14}/>:<Plus size={14}/>} {!entries.length&&trashCount>0?'휴지통에서 복구하기':selectedDate?'이 날짜 일기 작성':'첫 일기 작성하기'}</button></div>:filtered.map((entry,i)=><div key={entryKey(entry)}>{(i===0||entry.date.slice(0,7)!==filtered[i-1].date.slice(0,7))&&<div className="month-divider">{entry.date.slice(0,4)}년 {Number(entry.date.slice(5,7))}월 <small>차분히 돌아보는 나의 기록</small></div>}<DiaryCard entry={entry} demo={demo} favorite={favoriteIds.includes(entryKey(entry))} favoritePending={favoritePending.includes(entryKey(entry))} onFavorite={()=>toggleFavorite(entry)} onEdit={()=>openEditor(entry.date,entry.id)} onHistory={()=>showHistory(entry)} onDelete={()=>askDelete(entry)}/></div>)}
    {view==='favorites'&&<CommunitySpace mode="favorites" user={user} entries={entries} onNavigate={setView} onEdit={openEditor} onSettings={()=>setModal('settings')}/>}
    </section><aside className="right-aside"><div className="aside-card"><div className="aside-title">{calendarMonth.slice(0,4)}년 {Number(calendarMonth.slice(5))}월<div className="calendar-nav"><button aria-label="이전 달" onClick={()=>{const d=new Date(calendarMonth+'-01T12:00:00');d.setMonth(d.getMonth()-1);setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}}><ChevronLeft size={13}/></button><button aria-label="다음 달" onClick={()=>{const d=new Date(calendarMonth+'-01T12:00:00');d.setMonth(d.getMonth()+1);setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}}><ChevronRight size={13}/></button></div></div><Calendar month={calendarMonth} entries={view==='favorites'?favoriteEntries:shown} selected={selectedDate} onSelect={d=>setSelectedDate(selectedDate===d?'':d)}/><div className="calendar-foot"><i/>{demo?'예시 일기가':'일기가'} 기록된 날</div></div><div className="aside-card"><div className="aside-title">시장을 바라보는 나의 시선<Leaf size={12} color="#a1b295"/></div><div className="legend">{SENTIMENTS.map(s=><div className="legend-row" key={s.value}><i style={{background:s.color}}/>{s.ko}<span>{s.en}</span></div>)}</div><p className="aside-note">색으로 이어지는 나의 판단.<br/>시장의 분위기와 나의 감정은 따로 기록해요.</p></div><div className="aside-card sharing-note"><Heart size={20}/><h3>나의 속도로, 함께</h3><p>일기는 기본적으로 비공개예요.<br/>나누고 싶은 생각만 커뮤니티에 공유하세요.</p><button className="text-btn" onClick={()=>setView('community')}>다른 투자자의 마음 읽기 <ArrowRight size={12}/></button></div></aside></div>:<Review entries={shown} demo={demo} cash={cash}/>}
    </>}
    <footer className="footer"><span><Leaf size={11}/>나만의 속도로, 함께 읽는 투자 기록.</span><span><LockKeyhole size={10}/>공개 범위는 직접 선택해요 · Asia/Seoul</span></footer></main></div>
    {modal&&<div className={`modal-backdrop${modal==='editor'?' diary-editor-backdrop':''}`} onMouseDown={e=>{if(e.target===e.currentTarget)closeModal();}}><div className={`modal ${modal==='editor'?'diary-editor':'small'}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><h2 id="modal-title">{modal==='editor'?(editor.version?'일기 수정하기':'하루의 생각 남기기'):modal==='history'?'이전 기록 돌아보기':modal==='delete'?'일기를 삭제할까요?':modal==='trash'?'휴지통':'나의 기록 설정'}</h2><p>{modal==='editor'?'시장의 흐름과 나의 마음을 함께 담아보세요.':modal==='history'&&historyEntry?dateLabel(historyEntry.date):'온기 · 나만의 투자 공간'}</p></div><button className="close" aria-label="창 닫기" onClick={closeModal} disabled={saving||imageUploading}><X size={19}/></button></div>
    {modal==='delete'?<><div className="info-section delete-content"><div className="delete-symbol"><Trash2 size={23}/></div><p className="delete-date">{deleteCandidate&&dateLabel(deleteCandidate.date)}</p><h3>{deleteCandidate?.title||'오늘의 투자 생각'}</h3><p>일기 목록에서 지우고 휴지통으로 이동합니다.<br/>본문과 이미지, 수정 이력은 보관되며, 언제든 복구할 수 있어요.</p>{formError&&<div className="error-banner" role="alert">{formError}<button disabled={saving} onClick={()=>{setModal(null);void load();}}>목록 새로고침</button></div>}</div><div className="modal-footer"><button className="secondary" disabled={saving} onClick={closeModal}>취소</button><button className="danger-button" disabled={saving} onClick={moveToTrash}>{saving?<LoaderCircle size={13} className="spin"/>:<Trash2 size={13}/>}휴지통으로 이동</button></div></>:modal==='trash'?<div className="info-section trash-content"><p className="trash-intro">삭제한 일기는 이곳에 보관됩니다. 복구하면 원래 날짜의 일기 목록으로 돌아갑니다.</p>{trashLoading?<div className="loading"><LoaderCircle size={20} className="spin"/>휴지통을 불러오고 있어요.</div>:<>{formError&&<div className="error-banner" role="alert">{formError}<button disabled={saving} onClick={()=>showTrash()}>다시 불러오기</button></div>}{!trashEntries.length&&!formError?<div className="trash-empty"><Trash2 size={29} strokeWidth={1.3}/><h3>휴지통이 비어 있어요</h3><p>일기에서 삭제한 기록이 여기에 표시됩니다.</p></div>:trashEntries.map(entry=><article className="trash-entry" key={entryKey(entry)}><div className="trash-entry-heading"><span>{dateLabel(entry.date)}</span><button className="secondary" disabled={saving} aria-label={entry.date+' 삭제한 일기 복구'} onClick={()=>restoreDeleted(entry)}><Undo2 size={12}/>복구</button></div><h3>{entry.title||'오늘의 투자 생각'}</h3><p className="trash-preview">{entry.body}</p><DiaryInsight text={entry.insight}/><DiaryImages images={entry.images}/>{entry.deletedAt&&<small>{new Date(entry.deletedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} 삭제</small>}</article>)}</>}</div>:modal==='editor'?<><div className="form-body" inert={saving}><div className="field"><label htmlFor="diary-date">기록할 날짜</label><div className="date-field"><input id="diary-date" type="date" disabled={imageUploading||Boolean(editor.id)} value={editor.date} onChange={e=>changeDate(e.target.value)}/><span>{editor.date?weekday(editor.date):''}</span>{editor.version>0&&<span className="status">기존 일기 · 버전 {editor.version}</span>}</div></div><div className="field"><div className="field-label">내가 바라본 시장 분위기 <span className="optional">선택</span><button className="text-btn" onClick={()=>patch({sentiment:null})}>미선택</button></div><div className="mood-options">{SENTIMENTS.map(s=><button key={s.value} className={`mood-option ${editor.sentiment===s.value?'selected':''}`} aria-pressed={editor.sentiment===s.value} style={styleFor(s.value)} onClick={()=>patch({sentiment:s.value})}>{s.ko}<small>{s.en}</small></button>)}</div><p className="helper">그날 시장을 어떻게 판단했나요? CNN 지수와 별도로 저장됩니다.</p></div>
    <div className="form-two"><div className="field"><div className="field-label">나의 감정 상태 <span className="optional">선택</span></div><div className="emotion-options">{EMOTIONS.map(e=><button key={e.value} className={`emotion-option ${editor.emotion===e.value?'selected':''}`} aria-pressed={editor.emotion===e.value} onClick={()=>patch({emotion:editor.emotion===e.value?null:e.value})}>{e.emoji} {e.value}</button>)}</div></div><div className="field"><label htmlFor="cash">나의 현금 비중 <span className="optional">선택</span></label><div className="cash-field"><input aria-label="현금 비중 슬라이더" type="range" min="0" max="100" value={editor.cashRatio??0} onChange={e=>patch({cashRatio:Number(e.target.value)})}/><input id="cash" type="number" min="0" max="100" placeholder="미입력" value={editor.cashRatio??''} onChange={e=>patch({cashRatio:e.target.value===''?null:Number(e.target.value)})}/><span>%</span></div><p className="helper">전체 투자 자산 중 현금이 차지하는 비중이에요. 현금 비중은 공개되지 않아요.</p></div></div>
    <div className="field"><div className="field-label">매수 / 매도한 종목 <span className="optional">선택</span></div>{editor.trades.map((t,i)=><div className="trade-row" key={i}><select aria-label={`${i+1}번째 거래 구분`} value={t.side} onChange={e=>patch({trades:editor.trades.map((v,j)=>j===i?{...v,side:e.target.value as 'buy'|'sell'}:v)})}><option value="buy">매수</option><option value="sell">매도</option></select><input aria-label={`${i+1}번째 종목명`} placeholder="종목명 또는 티커" value={t.symbol} onChange={e=>patch({trades:editor.trades.map((v,j)=>j===i?{...v,symbol:e.target.value}:v)})}/><input aria-label={`${i+1}번째 거래 메모`} placeholder="매매 이유 (선택)" value={t.note||''} onChange={e=>patch({trades:editor.trades.map((v,j)=>j===i?{...v,note:e.target.value}:v)})}/><button className="close" aria-label={`${i+1}번째 거래 삭제`} onClick={()=>patch({trades:editor.trades.filter((_,j)=>j!==i)})}><X size={13}/></button></div>)}<button className="secondary" onClick={()=>patch({trades:[...editor.trades,{side:'buy',symbol:''}]})}><Plus size={12}/>종목 추가</button></div>
    <div className="field fg-inputs"><div className="fg-top"><span>CNN FEAR &amp; GREED INDEX · 수동 기록</span><a href={CNN} target="_blank" rel="noreferrer" className="link">CNN에서 확인 ↗</a></div><div className="fg-value-field"><label htmlFor="fg-value">지수 (0–100)</label><input id="fg-value" type="number" min="0" max="100" placeholder="선택 입력" value={editor.fearGreed?.value??''} onChange={e=>patch({fearGreed:e.target.value===''?null:{value:Number(e.target.value),source:'manual',sourceUrl:CNN,recordedAt:new Date().toISOString()}})}/></div><p className="helper">CNN에서 확인한 지수를 입력해 주세요. 비워 두어도 일기를 저장할 수 있어요.</p></div>
    <SharingSettings editor={editor} onChange={patch}/>
    <div className="field"><label htmlFor="title">오늘의 한 줄 <span className="optional">선택</span></label><input id="title" className="title-input" placeholder="오늘의 생각에 제목을 붙여보세요" maxLength={200} value={editor.title} onChange={e=>patch({title:e.target.value})}/></div><div className="field"><label htmlFor="body">나의 투자 일기 {editor.visibility==='sentiment'&&<span className="optional">선택</span>}</label><textarea id="body" className="body-input" placeholder={'오늘 시장을 어떻게 바라봤나요?\n\n나의 판단과 그 이유, 다음에 확인하고 싶은 것을 자유롭게 적어보세요. 내가 이해한 사실과 생각을 차분히 남겨보세요.'} value={editor.body} onChange={e=>patch({body:e.target.value})}/><p className="helper">{editor.body.length.toLocaleString()}자 · 줄바꿈과 문단이 그대로 저장돼요.</p></div><div className="field insight-field"><label htmlFor="insight"><Lightbulb size={14}/>이날 얻은 인사이트 <span className="optional">선택</span></label><textarea id="insight" className="insight-input" rows={4} maxLength={6000} placeholder="오늘 새롭게 알게 된 점이나, 다음 투자에서 기억하고 싶은 기준을 적어보세요." value={editor.insight||''} onChange={e=>patch({insight:e.target.value})}/><p className="helper">{(editor.insight||'').length.toLocaleString()} / 6,000자 · 선택한 일기 날짜와 함께 저장돼요.</p></div><ImageAttachmentsEditor key={draftKey(editor)} images={editor.images||[]} onAdd={images=>setEditor(prev=>({...prev,images:[...(prev.images||[]),...images].slice(0,3)}))} onRemove={id=>setEditor(prev=>({...prev,images:(prev.images||[]).filter(image=>image.id!==id)}))} onBusyChange={setImageUploading} disabled={saving}/>{formError&&<div className="error-banner" role="alert">{formError}</div>}</div><div className="modal-footer"><span><LockKeyhole size={10} style={{display:'inline'}}/> {editor.visibility==='public'?'전체 공개':editor.visibility==='sentiment'?'시장 분위기만 공유':'나에게만 보이는 기록'}</span><button className="secondary" onClick={closeModal} disabled={saving||imageUploading}>닫기</button><button className="primary" disabled={saving||imageUploading} onClick={saveEditor}>{saving||imageUploading?<LoaderCircle className="spin" size={14}/>:<Check size={14}/>} {imageUploading?'이미지 업로드 중':'일기 저장하기'}</button></div></>:modal==='settings'?<div className="info-section"><h3>기록의 공개 범위</h3><p>로그인과 서버의 사용자별 접근 확인으로 일기를 보호합니다. 일기와 수정 이력은 서버 데이터베이스에 보관되어 다른 기기에서도 이어서 볼 수 있어요.</p><span className="status"><ShieldCheck size={12}/>새 일기는 기본 비공개</span><h3>기록 내보내기</h3><p>저장된 나의 일기 {entries.length}개를 JSON 파일로 내려받습니다. 나의 기록만 포함해요. 이미지 정보가 포함되며, 이미지 파일 자체는 포함되지 않습니다.</p><button className="secondary" onClick={exportData}><Download size={13}/>내 일기 내보내기</button><h3>시장 데이터</h3><p>CNN의 공개 API와 이용 조건을 확인하지 못해 자동 조회는 연결하지 않았습니다. CNN 공식 페이지에서 확인한 지수를 직접 입력할 수 있습니다. 과거 기록의 값은 자동으로 교체되지 않습니다.</p><a className="link" href={CNN} target="_blank" rel="noreferrer">CNN Fear & Greed Index 보기 ↗</a><h3>로그인 계정</h3><p>{user?.email}</p><button className="secondary" onClick={async()=>{const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});const data=await r.json() as {redirect?:string};if(data.redirect)window.top!.location.href=data.redirect;else location.reload();}}>로그아웃</button></div>:<div className="info-section">{historyLoading?<div className="loading"><LoaderCircle className="spin" size={20}/></div>:!revisions.length?<p>보관된 수정 이력이 없어요.</p>:revisions.slice().sort((a,b)=>b.version-a.version).map(r=><div key={r.version} className="history-item"><h4>버전 {r.version}<small>{r.savedAt?new Date(r.savedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):''}</small></h4><b>{r.entry.title}</b><p>{r.entry.body}</p><DiaryInsight text={r.entry.insight}/><DiaryImages images={r.entry.images}/><p>분위기: {SENTIMENTS.find(s=>s.value===r.entry.sentiment)?.ko||'미선택'} · 감정: {r.entry.emotion||'미입력'} · 현금: {r.entry.cashRatio===null?'미입력':r.entry.cashRatio+'%'}<br/>CNN: {r.entry.fearGreed?`${r.entry.fearGreed.value}${r.entry.fearGreed.asOf?` · ${r.entry.fearGreed.asOf}`:''}`:'미입력'} · 거래 {r.entry.trades.length}건</p><button className="secondary" disabled={saving} onClick={()=>restore(r)}><History size={12}/>이 버전으로 복구</button></div>)}{formError&&<div role="alert" className="error-banner">{formError}</div>}</div>}
    </div></div>}
    {toast&&<div className="toast" role="status"><CheckCheck size={15}/>{toast}</div>}
  </div>;
}

const VISIBILITY_OPTIONS = [
  { value: 'private', label: '비공개', detail: '나에게만 보이는 기록', icon: LockKeyhole },
  { value: 'sentiment', label: '시장 분위기만 공유', detail: '커뮤니티 카드와 시장 심리 통계', icon: ChartNoAxesCombined },
  { value: 'public', label: '전체 공개', detail: '커뮤니티에 일기와 생각 공유', icon: Users },
] as const;

function SharingSettings({ editor, onChange }: { editor: Diary; onChange: (patch: Partial<Diary>) => void }) {
  const visibility = editor.visibility ?? 'private';

  return (
    <div className="field sharing-field">
      <div className="field-label" id="sharing-heading">
        <ShieldCheck size={14}/>이 기록을 누구와 나눌까요?
      </div>
      <div className="visibility-options" role="group" aria-labelledby="sharing-heading">
        {VISIBILITY_OPTIONS.map(option => (
          <button
            type="button"
            key={option.value}
            className={visibility === option.value ? 'selected' : ''}
            aria-pressed={visibility === option.value}
            onClick={() => {
              if (visibility !== option.value) onChange({ visibility: option.value, shareEmotion: false });
            }}
          >
            <option.icon size={15}/>
            <strong>{option.label}</strong>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      <div className="sensitive-settings">
        <label><input type="checkbox" checked={editor.commentsEnabled !== false} disabled={(editor.commentCount ?? 0) > 0} onChange={event => onChange({commentsEnabled:event.target.checked})}/>댓글 허용</label>
        <small>{(editor.commentCount ?? 0) > 0 ? '댓글이 달린 일기는 댓글 기능을 비활성화할 수 없어요.' : '공개한 게시글에 다른 투자자들이 댓글을 남길 수 있어요. 댓글이 달린 뒤에는 비활성화할 수 없어요.'}</small>
      </div>
      {visibility === 'sentiment' && (
        <div className="sensitive-settings">
          <p>저장하면 시장 분위기가 닉네임, 기록 날짜와 함께 커뮤니티에 표시되고, 시장 심리 통계에도 반영돼요.</p>
          <label>
            <input
              type="checkbox"
              disabled={!editor.emotion}
              checked={Boolean(editor.emotion) && editor.shareEmotion === true}
              onChange={event => onChange({ shareEmotion: event.target.checked })}
            />
            나의 감정도 함께 공유
          </label>
          <small>
            {editor.emotion ? '선택하면 기록한 감정도 커뮤니티 카드에 표시돼요.' : '감정을 기록하면 함께 공유할 수 있어요.'}
            {' '}제목, 본문, 인사이트, CNN 지수, 현금 비중, 거래 내역과 첨부 이미지는 비공개로 보관됩니다.
          </small>
        </div>
      )}
      {visibility === 'public' && (
        <div className="sensitive-settings">
          <p>저장하면 입력한 감정과 CNN Fear &amp; Greed 지수, 첨부한 원본 이미지가 커뮤니티에 공개돼요. 현금 비중은 비공개로 보관됩니다.</p>
          <label>
            <input
              type="checkbox"
              checked={editor.shareTrades === true}
              onChange={event => onChange({ shareTrades: event.target.checked })}
            />
            매매 종목 및 메모 공개
          </label>
          <small>본문에 직접 적은 투자 정보는 공개되니 저장 전에 확인해 주세요.</small>
        </div>
      )}
    </div>
  );
}

function DiaryCard({entry,demo,favorite,favoritePending,onFavorite,onEdit,onHistory,onDelete}:{entry:Diary;demo:boolean;favorite:boolean;favoritePending:boolean;onFavorite:()=>void;onEdit:()=>void;onHistory:()=>void;onDelete:()=>void}){const [expanded,setExpanded]=useState(false);const s=SENTIMENTS.find(s=>s.value===entry.sentiment);const emotion=EMOTIONS.find(e=>e.value===entry.emotion);const fg=entry.fearGreed;return <article className="diary-card" style={styleFor(entry.sentiment)} id={'diary-'+entryKey(entry)}><div className="card-head"><div><div className="date-line"><strong>{entry.date.replaceAll('-','.')}</strong><span>{weekday(entry.date)}</span>{entry.date===seoulToday()&&<span className="today">오늘</span>}{!demo&&<button type="button" className={`favorite-toggle ${favorite?'is-favorite':''}`} aria-label={entry.date+' 즐겨찾기 '+(favorite?'해제':'추가')} aria-pressed={favorite} title={favorite?'즐겨찾기 해제':'즐겨찾기 추가'} disabled={favoritePending} onClick={onFavorite}>{favoritePending?<LoaderCircle size={16} className="spin"/>:<Star size={17} fill={favorite?'currentColor':'none'} strokeWidth={1.6}/>}</button>}</div><div className="sentiment-badge"><i/>{s?.ko||'미선택'}<span>{s?.en||'Not selected'}</span></div></div><div className="fg-card"><div className="fg-caption">CNN FEAR & GREED</div><div className="fg-number">{fg?.value??'—'}<small>{fg?' / 100':'확인 필요'}</small></div><span className="fg-bar"><i style={{width:fg?fg.value+'%':'0%'}}/></span><div className="fg-note">{fg?(fg.asOf?`수동 입력 · ${new Date(fg.asOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} 기준`:'수동 입력'):'미입력 · 자동 조회 미연동'}</div>{fg&&expanded&&<div className="fg-note"><a className="link" href={fg.sourceUrl} target="_blank" rel="noreferrer">CNN 출처 ↗</a> · 기록 {new Date(fg.recordedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</div>}</div></div><h2>{entry.title||'오늘의 투자 생각'}</h2><p id={'diary-body-'+entryKey(entry)} className={`diary-body ${expanded?'':'collapsed'}`}>{entry.body}</p><button type="button" className="diary-read-toggle" aria-expanded={expanded} aria-controls={'diary-body-'+entryKey(entry)} aria-label={dateLabel(entry.date)+' 일기 '+(expanded?'접기':'더보기')} onClick={()=>setExpanded(!expanded)}>{expanded?'-접기-':'-더보기-'}</button><DiaryInsight text={entry.insight}/><DiaryImages images={entry.images}/><div className="card-meta"><span className="meta-pill">{emotion?.emoji||'◌'} 나의 마음 <b>{entry.emotion||'미입력'}</b></span><span className="meta-pill"><Wallet size={11}/>현금 비중 <b>{entry.cashRatio===null?'미입력':entry.cashRatio+'%'}</b></span>{entry.trades.map((t,i)=><span key={i} className={`meta-pill trade-${t.side}`} title={t.note}><b>{t.side==='buy'?'매수':'매도'}</b>{t.symbol}{expanded&&t.note&&` · ${t.note}`}</span>)}</div><div className="entry-timestamps">작성 {entry.createdAt?new Date(entry.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—'} · 수정 {entry.updatedAt?new Date(entry.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—'}</div><div className="card-bottom"><span className="card-origin"><span className="visibility-tag">{entry.visibility==='public'?'전체 공개':entry.visibility==='sentiment'?'분위기만 공유':'비공개'}</span>{demo?<><Sparkles size={10}/>예시 기록</>:<><Feather size={10}/>나의 기록 · v{entry.version}</>}</span><div className="card-controls">{!demo&&<><button aria-label={`${entry.date} 수정 이력`} onClick={onHistory}><History size={11}/>이력</button><button aria-label={`${entry.date} 일기 수정`} onClick={onEdit}><Pencil size={11}/>수정</button><button className="danger-link" aria-label={entry.date+' 일기 삭제'} onClick={onDelete}><Trash2 size={11}/>삭제</button></>}</div></div></article>;}
function Calendar({month,entries,selected,onSelect}:{month:string;entries:Diary[];selected:string;onSelect:(d:string)=>void}){const first=new Date(month+'-01T12:00:00').getDay();const total=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();return <div className="calendar-grid">{['일','월','화','수','목','금','토'].map(d=><span className="weekday" key={d}>{d}</span>)}{Array.from({length:first},(_,i)=><span key={'blank'+i}/>)}{Array.from({length:total},(_,i)=>{const d=month+'-'+String(i+1).padStart(2,'0');const entry=entries.find(x=>x.date===d);return <button aria-label={`${dateLabel(d)}${entry?' 일기 있음':' 일기 없음'}`} aria-pressed={selected===d} key={d} onClick={()=>onSelect(d)} className={`${d===seoulToday()?'today-date':''} ${selected===d?'selected-date':''} ${(first+i)%7===0?'sunday':''}`}>{i+1}{entry&&<i className="dot" style={{background:SENTIMENTS.find(s=>s.value===entry.sentiment)?.color||'#b4bda9'}}/>}</button>;})}</div>;}
function Review({entries,demo,cash}:{entries:Diary[];demo:boolean;cash:number|null}){const sorted=[...entries].sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);const cashEntries=sorted.filter(e=>e.cashRatio!==null);return <>{demo&&<div className="demo-banner"><Sparkles size={12}/>예시 기록을 바탕으로 한 미리보기입니다.</div>}<div className="review-layout"><div><div className="review-card"><h3>시장을 바라본 마음의 변화</h3><p>최근 30개 기록 · 색상과 높이로 살펴보는 시장 분위기</p>{!sorted.length?<p>일기를 기록하면 흐름이 여기에 나타나요.</p>:<div className="chart-bars">{sorted.map(e=>{const s=SENTIMENTS.find(s=>s.value===e.sentiment);const index=SENTIMENTS.findIndex(s=>s.value===e.sentiment);return <div key={entryKey(e)} title={`${dateLabel(e.date)} ${s?.ko||'미선택'}`}><i style={{height:e.sentiment?(5-index)*22+'px':'5px',background:s?.color||'#d8dfd0'}}/><span>{e.date.slice(5).replace('-','.')}</span></div>;})}</div>}<div className="legend" style={{flexDirection:'row',flexWrap:'wrap'}}>{SENTIMENTS.map(s=><div className="legend-row" key={s.value}><i style={{background:s.color}}/>{s.ko}</div>)}</div></div><div className="review-card"><h3>현금이 만들어 주는 여유</h3><p>기록한 날의 평균 현금 비중 {cash===null?'미입력':cash+'%'}</p>{cashEntries.length?<><svg className="review-cash" viewBox="0 0 600 160" role="img" aria-label="날짜별 현금 비중 그래프"><line x1="10" y1="140" x2="590" y2="140" stroke="#e6ecdf"/><line x1="10" y1="75" x2="590" y2="75" stroke="#f0f3ec"/><polyline fill="none" stroke="#91aa7e" strokeWidth="3" strokeLinejoin="round" points={cashEntries.map((e,i)=>`${cashEntries.length===1?300:20+i/(cashEntries.length-1)*560},${140-(e.cashRatio||0)*1.2}`).join(' ')}/>{cashEntries.map((e,i)=><circle key={entryKey(e)} cx={cashEntries.length===1?300:20+i/(cashEntries.length-1)*560} cy={140-(e.cashRatio||0)*1.2} r="5" fill="#527647"><title>{e.date} · {e.cashRatio}%</title></circle>)}</svg><div className="cash-axis"><span>{cashEntries[0].date}</span><span>{cashEntries[cashEntries.length-1].date}</span></div></>:<p>선택 항목인 현금 비중을 입력하면 변화를 확인할 수 있어요.</p>}</div></div><div className="review-card"><h3>나는 어떤 마음이었을까</h3><p>기록에 남겨 둔 감정 상태</p>{EMOTIONS.map(em=>{const count=entries.filter(e=>e.emotion===em.value).length;return <div className="emotion-row" key={em.value}><span>{em.emoji} {em.value}</span><div className="track"><i style={{width:entries.length?count/entries.length*100+'%':'0%'}}/></div><small>{count}건</small></div>;})}<p className="aside-note">기록하지 않은 감정은 미입력으로 보존돼요.<br/>시장에 대한 판단과 내 마음을 함께 돌아보세요.</p></div></div></>;}
