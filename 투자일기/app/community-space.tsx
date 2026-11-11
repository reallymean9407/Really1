'use client';
import {useCallback,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {ArrowRight,ArrowUpRight,ChartNoAxesCombined,Check,ChevronRight,Feather,Heart,Image as ImageIcon,Leaf,LoaderCircle,LockKeyhole,Medal,Pencil,RefreshCw,Settings2,ShieldCheck,Star,Trophy,X} from 'lucide-react';
import {EMOTIONS,SENTIMENTS,seoulToday,dateLabel,type Diary,type DiaryImage,type Sentiment,type Trade,type FearGreed} from './lib/model';

type Mode='home'|'community'|'top'|'sentiment'|'profile'|'favorites';
type Navigation=Mode|'journal'|'review'|'links';
const RANK_PERIODS = [['daily','일간'],['weekly','주간'],['monthly','월간'],['yearly','연간']] as const;
type RankPeriod = typeof RANK_PERIODS[number][0];
type FeedPage = {posts:Post[];total:number;range?:{from:string;to:string}};
const FEED_LIMIT = 20;
type User={id?:string;name:string;email:string}|null;
type Profile={id:string;nickname:string;avatarUrl:string;bio:string;isAdmin?:boolean};
type Post = {
  id: string;
  author: Profile;
  date: string;
  sentiment: Sentiment | null;
  emotion: string | null;
  publishedAt: string;
  updatedAt: string;
  likes: number;
  liked: boolean;
  bookmarked: boolean;
  isMine: boolean;
  hidden?: boolean;
  moderationReason?: string;
} & (
  | { visibility: 'sentiment' }
  | { visibility: 'public'; title: string; body: string; insight: string; fearGreed: FearGreed | null; trades: Trade[]; images?: DiaryImage[] }
);
const postTitle = (post: Post) => post.visibility === 'sentiment' ? '시장 분위기만 공유' : post.title || '오늘의 투자 생각';
type EmotionCount = { emotion: string; count: number; percent: number };
type Distribution = {
  date: string;
  total: number;
  dominant: Sentiment[];
  counts: { sentiment: Sentiment; count: number; percent: number }[];
  emotionTotal?: number;
  emotions?: EmotionCount[];
};
type MoodData={today:string;selected:Distribution;history:Distribution[]};
const MOODS=[...SENTIMENTS].reverse();
const moodStyle=(sentiment:Sentiment|null):CSSProperties=>{const s=MOODS.find(x=>x.value===sentiment);return {'--sentiment':s?.color||'#8d938f','--sentiment-light':s?.light||'#f1f3f1'} as CSSProperties;};
const auth=()=>window.dispatchEvent(new Event('onki-auth'));
async function api<T>(path:string,options?:RequestInit):Promise<T>{const response=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options?.headers}});const data=await response.json() as Record<string,unknown>;if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'잠시 후 다시 시도해 주세요.');return data as T;}
function timeLabel(value:string){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';}
function Avatar({profile}:{profile:Pick<Profile,'nickname'|'avatarUrl'>}){return profile.avatarUrl?<img className="community-avatar" src={profile.avatarUrl} alt="" referrerPolicy="no-referrer"/>:<span className="community-avatar">{profile.nickname?.[0]||'온'}</span>;}
function Badge({value}:{value:Sentiment|null}){return <span className="sentiment-badge" style={moodStyle(value)}><i/>{MOODS.find(s=>s.value===value)?.ko||'미선택'}</span>;}
function Empty({title,children,icon='leaf'}:{title:string;children:ReactNode;icon?:'leaf'|'heart'}){return <div className="empty community-empty">{icon==='heart'?<Heart size={30}/>:<Feather size={30}/>}<h3>{title}</h3><p>{children}</p></div>;}

export default function CommunitySpace({mode,user,entries,onNavigate,onEdit,onSettings}:{mode:Mode;user:User;entries:Diary[];onNavigate:(view:Navigation)=>void;onEdit:(date:string,entryId?:string)=>void;onSettings:()=>void}){
  const [today,setToday]=useState(seoulToday()),[date,setDate]=useState(seoulToday()),[feedDate,setFeedDate]=useState(''),[sort,setSort]=useState('latest'),[filter,setFilter]=useState('');
  const [period,setPeriod]=useState('30'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[posts,setPosts]=useState<Post[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
  const [rankPeriod,setRankPeriod] = useState<RankPeriod>('daily');
  const [topDiary, setTopDiary] = useState<{ date: string; post: Post | null } | null>(null);
  const [rankedFeed, setRankedFeed] = useState<(FeedPage & { date: string; period: RankPeriod }) | null>(null);
  const [moods,setMoods]=useState<MoodData|null>(null),[profile,setProfile]=useState<Profile|null>(null),[profileTab,setProfileTab]=useState('public'),[adminPosts,setAdminPosts]=useState<Post[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[detail,setDetail]=useState<Post|null>(null),[authorDetail,setAuthorDetail]=useState<Profile|null>(null),[pending,setPending]=useState<string[]>([]);
  const [communityFeed,setCommunityFeed] = useState<FeedPage & {offset:number}>({posts:[],total:0,offset:0});
  const [feedLoading,setFeedLoading] = useState(false);
  const [feedRevision,setFeedRevision] = useState(0);
  const feedController = useRef<AbortController | null>(null);
  const feedLock = useRef(false);
  const feedEnd = useRef<HTMLDivElement>(null);
  const bookmarkLock = useRef(new Set<string>());
  const [bookmarkPending,setBookmarkPending] = useState<string[]>([]);
  const likesLock=useRef(new Set<string>()),[refresh,setRefresh]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>{const next=seoulToday();setToday(previous=>{if(previous!==next)setDate(d=>d===previous?next:d);return next;});setRefresh(v=>v+1);},15000);const changed=()=>{setRefresh(v=>v+1);setFeedRevision(v=>v+1);};window.addEventListener('onki-data',changed);return()=>{clearInterval(timer);window.removeEventListener('onki-data',changed);};},[]);
  useEffect(()=>{setOffset(0);},[mode,feedDate,date,sort,filter,profileTab,rankPeriod]);
  useEffect(()=>{if(!user)return;let alive=true;api<{profile:Profile}>('/api/profile').then(d=>{if(alive)setProfile(d.profile);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[user?.email]);
  const feedParams = new URLSearchParams({ sort, limit: String(FEED_LIMIT), ...(feedDate ? {date:feedDate} : {}), ...(filter ? {sentiment:filter} : {}) }).toString();

  useEffect(() => {
    if (mode !== 'community') return;
    const controller = new AbortController();
    feedController.current = controller;
    feedLock.current = true;
    setError('');
    setFeedLoading(true);
    setCommunityFeed({posts:[],total:0,offset:0});
    api<FeedPage>('/api/community?' + feedParams, {signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) setCommunityFeed({...result,offset:result.posts.length}); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => {
        if (!controller.signal.aborted) { feedLock.current = false; setFeedLoading(false); }
      });
    return () => controller.abort();
  }, [mode,feedParams,feedRevision,user?.id]);

  const loadMore = useCallback(async () => {
    const controller = feedController.current;
    if (!controller || controller.signal.aborted || feedLock.current || communityFeed.offset >= communityFeed.total) return;
    feedLock.current = true;
    setFeedLoading(true);
    setError('');
    try {
      const result = await api<FeedPage>('/api/community?' + feedParams + '&offset=' + communityFeed.offset, {signal:controller.signal});
      if (!controller.signal.aborted) setCommunityFeed(current => {
        const combined = new Map(current.posts.map(post => [post.id,post]));
        result.posts.forEach(post => combined.set(post.id,post));
        return {posts:[...combined.values()],total:result.total,offset:result.posts.length ? current.offset+result.posts.length : result.total};
      });
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) { feedLock.current = false; setFeedLoading(false); }
    }
  }, [feedParams,communityFeed.offset,communityFeed.total]);

  useEffect(() => {
    if (mode !== 'community' || feedLoading || error || !feedEnd.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore();
    }, { rootMargin: '300px' });
    observer.observe(feedEnd.current);
    return () => observer.disconnect();
  }, [mode,feedLoading,error,loadMore]);

  useEffect(() => {
    if (mode === 'community') return;
    let alive = true;
    setError('');
    setBusy(true);
    const jobs: Promise<unknown>[] = [];

    if (mode === 'home') {
      const topQuery = new URLSearchParams({ sort: 'top', date: today, limit: '1' });
      jobs.push(api<{posts: Post[]}>('/api/community?' + topQuery).then(result => {
        if (!alive) return;
        const post = result.posts.find(item => item.visibility === 'public') ?? null;
        setTopDiary({ date: today, post });
      }));
    } else if (mode === 'top' || mode === 'favorites' || (mode === 'profile' && user && profile && ['public', 'liked'].includes(profileTab))) {
      const query = new URLSearchParams({
        limit: mode === 'top' ? '10' : '20',
        offset: String(offset),
        sort: mode === 'top' ? 'top' : sort,
      });

      if (mode === 'top') { query.set('date', date); query.set('period',rankPeriod); }
      if (mode === 'favorites') { query.set('bookmarked','true'); query.set('others','true'); }
      if (mode === 'profile') {
        if (feedDate) query.set('date', feedDate);
        if (filter) query.set('sentiment', filter);
      }
      if (mode === 'profile') {
        if (profileTab === 'liked') query.set('liked', 'true');
        else if (profile?.id) query.set('author', profile.id);
      }

      jobs.push(api<FeedPage>('/api/community?' + query).then(result => {
        if (!alive) return;
        if (mode === 'top') {
          setRankedFeed({
            ...result, date, period: rankPeriod,
            posts: result.posts.filter(post => post.visibility === 'public'),
          });
        } else {
          setPosts(result.posts);
          setTotal(result.total);
        }
      }));
    }

    if (mode === 'home' || mode === 'sentiment') {
      const query = new URLSearchParams({ date: mode === 'home' ? today : date });
      if (mode === 'sentiment' && period === 'custom') {
        if (from) query.set('from', from);
        if (to) query.set('to', to);
      } else {
        query.set('days', mode === 'home' ? '7' : period);
      }
      jobs.push(api<MoodData>('/api/sentiment?' + query).then(result => {
        if (alive) setMoods(result);
      }));
    }

    if (mode === 'profile' && profileTab === 'admin' && profile?.isAdmin) {
      jobs.push(api<{posts: Post[]}>('/api/admin').then(result => {
        if (alive) setAdminPosts(result.posts);
      }));
    }
    Promise.all(jobs).catch(error => {
      if (alive) setError(error.message);
    }).finally(() => {
      if (alive) setBusy(false);
    });
    return () => { alive = false; };
  }, [mode, today, date, feedDate, sort, filter, period, rankPeriod, from, to, profileTab, profile?.id, profile?.isAdmin, offset, refresh, user?.email]);
  useEffect(()=>{if(!detail)return;let alive=true;api<{posts:Post[];total:number}>('/api/community?id='+encodeURIComponent(detail.id)).then(result=>{if(!alive)return;const current=result.posts.find(post=>post.id===detail.id);if(current)setDetail(current);else{setDetail(null);setNotice('이 기록의 공개 상태가 변경되었어요.');}}).catch(()=>{if(alive)setDetail(null);});return()=>{alive=false;};},[detail?.id,refresh]);
  const retry=()=>{if(mode==='community')setFeedRevision(v=>v+1);else setRefresh(v=>v+1);};
  async function like(post: Post) {
    if (!user) { auth(); return; }
    if (post.isMine || likesLock.current.has(post.id)) return;
    likesLock.current.add(post.id);
    setPending(ids => [...ids, post.id]);
    setError('');
    try {
      const result = await api<{liked: boolean; likes: number}>('/api/likes', {
        method: 'PUT',
        body: JSON.stringify({ postId: post.id, liked: !post.liked }),
      });
      const update = (candidate: Post) => candidate.id === post.id ? { ...candidate, ...result } : candidate;
      setPosts(items => items.map(update));
      setCommunityFeed(current => ({ ...current, posts: current.posts.map(update) }));
      setRankedFeed(current => current ? { ...current, posts: current.posts.map(update) } : current);
      setTopDiary(current => current?.post ? { ...current, post: update(current.post) } : current);
      setDetail(current => current ? update(current) : current);
      if (mode !== 'community') window.dispatchEvent(new Event('onki-data'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      likesLock.current.delete(post.id);
      setPending(ids => ids.filter(id => id !== post.id));
    }
  }
  async function bookmark(post: Post) {
    if (!user) { auth(); return; }
    if (bookmarkLock.current.has(post.id)) return;
    bookmarkLock.current.add(post.id);
    setBookmarkPending(ids => [...ids,post.id]);
    try {
      const result = await api<{favorite:boolean}>('/api/favorites', {
        method:'POST', body:JSON.stringify({entryId:post.id,favorite:!post.bookmarked}),
      });
      const update = (item: Post) => item.id === post.id ? {...item,bookmarked:result.favorite} : item;
      setPosts(items => items.map(update).filter(item => mode !== 'favorites' || item.bookmarked));
      setCommunityFeed(current => ({...current,posts:current.posts.map(update)}));
      setRankedFeed(current => current ? {...current,posts:current.posts.map(update)} : current);
      setTopDiary(current => current?.post ? {...current,post:update(current.post)} : current);
      setDetail(current => current ? update(current) : current);
      setNotice(result.favorite ? '즐겨찾기에 담았어요.' : '즐겨찾기를 해제했어요.');
      window.dispatchEvent(new Event('onki-bookmarks'));
      if (mode === 'favorites') setRefresh(value => value+1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      bookmarkLock.current.delete(post.id);
      setBookmarkPending(ids => ids.filter(id => id !== post.id));
    }
  }
  async function showAuthor(author:Profile){setAuthorDetail(author);try{const result=await api<{profile:Profile}>('/api/profile?id='+encodeURIComponent(author.id));setAuthorDetail(result.profile);}catch{}}
  async function moderate(post:Post,hidden:boolean){const reason=hidden?window.prompt('게시물을 숨기는 이유를 남겨 주세요. (작성자 기록은 보존됩니다.)'):post.moderationReason||'운영 검토 후 다시 공개';if(hidden&&!reason?.trim())return;try{await api('/api/admin',{method:'PUT',body:JSON.stringify({postId:post.id,hidden,reason})});setDetail(null);setNotice(hidden?'공개 게시물을 숨겼어요.':'게시물을 다시 공개했어요.');retry();window.dispatchEvent(new Event('onki-data'));}catch(e){setError((e as Error).message);}}
  function postCard(post: Post, rank?: number) {
    return (
      <PublicCard
        key={post.id}
        post={post}
        rank={rank}
        pending={pending.includes(post.id)}
        onOpen={() => setDetail(post)}
        onLike={() => like(post)}
        bookmarkPending={bookmarkPending.includes(post.id)}
        onBookmark={() => bookmark(post)}
        onAuthor={() => showAuthor(post.author)}
        onEdit={() => onEdit(post.date,post.id)}
      />
    );
  }
  const todayMood = moods?.selected.date === today ? moods.selected : null;
  const todayTop = topDiary?.date === today ? topDiary.post : null;
  const selectedRanking = rankedFeed?.date === date && rankedFeed.period === rankPeriod ? rankedFeed : null;
  const communityPosts = mode === 'top' ? selectedRanking?.posts ?? [] : communityFeed.posts;
  const communityBusy = mode === 'top' ? busy : feedLoading;
  const privateEntries=entries.filter(e=>(e.visibility||'private')!=='public');
  return <div className="community-space">
    {error&&<div className="error-banner" role="alert">{error}<button className="text-btn" onClick={retry}>다시 시도</button></div>}{notice&&<div className="community-notice" role="status"><Check size={14}/>{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    {mode === 'home' ? <div className="home-dashboard">
      <section className="home-top-diary" aria-labelledby="home-top-title">
        <div className="community-section-heading">
          <div><h2 id="home-top-title"><Trophy size={17}/>오늘의 TOP 일기</h2><p>오늘 가장 많은 공감을 받은 전체 공개 일기</p></div>
          <button className="text-btn" onClick={() => onNavigate('top')}>TOP 10 보기 <ChevronRight size={13}/></button>
        </div>
        {todayTop
          ? postCard(todayTop, 1)
          : busy ? <Loading/> : <Empty title="오늘의 TOP 일기를 기다리고 있어요">아직 오늘 공개된 투자 일기가 없어요.</Empty>}
      </section>

      <div className="home-overviews">
        <section className="mood-panel" aria-labelledby="home-market-title">
          <div className="community-section-heading">
            <div><h2 id="home-market-title">오늘의 투자 심리</h2><p>{dateLabel(today)}</p></div>
            <button className="text-btn" onClick={() => onNavigate('sentiment')}>자세히 보기 <ChevronRight size={13}/></button>
          </div>
          {todayMood ? <MoodSummary distribution={todayMood}/> : <Loading/>}
        </section>

        <section className="mood-panel emotion-panel" aria-labelledby="home-emotions-title">
          <div className="community-section-heading">
            <div><h2 id="home-emotions-title">오늘의 감정 상태</h2><p>{dateLabel(today)} · 공유된 감정</p></div>
          </div>
          {todayMood ? <EmotionSummary distribution={todayMood}/> : <Loading/>}
        </section>
      </div>
    </div>:mode==='sentiment'?<>
      <div className="community-toolbar"><label className="toolbar-date">살펴볼 날짜<input aria-label="시장 심리 날짜" type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button className="secondary" onClick={()=>setDate(today)}>오늘</button><span className="toolbar-info">한국 시간 기준 · 15초마다 갱신</span><button className="icon-button" aria-label="시장 심리 새로고침" onClick={retry}><RefreshCw size={14}/></button></div>
      <section className="mood-panel"><div className="community-section-heading"><div><h2>{date===today?'오늘의':'이날의'} 투자 심리</h2><p>{dateLabel(date)} · 하루에 한 사람, 한 번의 마음</p></div><span className="subtle-badge"><ShieldCheck size={12}/>실제 공유 기록으로 집계</span></div>{moods?<MoodSummary distribution={moods.selected}/>:<Loading/>}</section>
      <section className="mood-panel history-panel"><div className="community-section-heading"><div><h2>시간에 따라 달라지는 마음</h2><p>날짜마다 비관에서 낙관까지, 마음의 구성을 비교해 보세요.</p></div></div><div className="history-controls"><div className="segmented">{['7','30','90','custom'].map(value=><button key={value} className={period===value?'active':''} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value==='custom'?'직접 선택':`최근 ${value}일`}</button>)}</div>{period==='custom'&&<div className="history-dates"><label>시작일<input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><span>~</span><label>종료일<input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label></div>}</div><div className="chart-legend">{MOODS.map(m=><span key={m.value}><i style={{background:m.color}}/>{m.ko}</span>)}</div>{moods?.history?.length?<div className="history-chart" role="img" aria-label="날짜별 투자 심리 비율 누적 막대그래프">{moods.history.map(d=><div key={d.date} className="history-row"><span>{d.date.slice(5).replace('-','.')}</span><StackedBar distribution={d}/><span>{d.total}명</span><strong>{d.total?d.dominant.map(value=>MOODS.find(m=>m.value===value)?.ko).join(' · '):'참여 없음'}</strong></div>)}</div>:<Empty title="이 기간의 마음을 기다리고 있어요">공유된 시장 분위기가 쌓이면 날짜별 변화를 볼 수 있어요.</Empty>}<p className="chart-footnote">각 막대는 해당 날짜 참여자 대비 비율입니다. 비공개·삭제·운영자 숨김 기록은 제외합니다.</p></section>
    </>:mode==='favorites'?<section className="saved-community" aria-label="즐겨찾기한 커뮤니티 일기">
      <div className="community-section-heading"><h2>즐겨찾기한 커뮤니티 일기</h2><button className="text-btn" onClick={()=>onNavigate('community')}>커뮤니티 보기 <ChevronRight size={13}/></button></div>
      {busy && !posts.length ? <Loading/> : posts.length
        ? <><div className="public-feed">{posts.map(post => postCard(post))}</div><Pagination total={total} offset={offset} onChange={setOffset}/></>
        : <Empty title="다시 읽고 싶은 글을 모아보세요">커뮤니티나 TOP 10에서 별을 누른 글이 이곳에 표시됩니다.</Empty>}
    </section>:mode==='profile'?<>
      {!user?<Empty title="나만의 투자 공간을 열어보세요"><button className="primary" onClick={auth}>로그인 · 회원가입 <ArrowRight size={14}/></button></Empty>:<>
        <ProfileEditor profile={profile} email={user.email} onSaved={p=>{setProfile(p);setNotice('나의 소개를 저장했어요.');}} onSettings={onSettings}/>
        <div className="profile-tabs" role="tablist" aria-label="나의 기록 보기">{[{value:'public',label:'커뮤니티 공유 기록'},{value:'private',label:'비공개 · 분위기 공유'},{value:'liked',label:'공감한 기록'},...(profile?.isAdmin?[{value:'admin',label:'공개 게시물 관리'}]:[])].map(tab=><button key={tab.value} role="tab" aria-selected={profileTab===tab.value} className={profileTab===tab.value?'active':''} onClick={()=>setProfileTab(tab.value)}>{tab.label}</button>)}</div>
        {profileTab==='private'?privateEntries.length?<div className="profile-private-list">{privateEntries.map(e=><button key={e.id??e.date} onClick={()=>onEdit(e.date,e.id)}><LockKeyhole size={17}/><div><small>{dateLabel(e.date)} · {e.visibility==='sentiment'?'시장 분위기만 공유':'비공개'}</small><h3>{e.title||'오늘의 투자 생각'}</h3><p>{e.body}</p></div><Pencil size={15}/></button>)}</div>:<Empty title="아직 보관된 기록이 없어요">내 마음을 정리하는 첫 일기를 남겨보세요.</Empty>:profileTab==='admin'?<div className="admin-list">{adminPosts.map(post=><div className="admin-row" key={post.id}><div><small>{post.author.nickname} · {post.date}</small><h3>{postTitle(post)}</h3><p>{post.hidden?`숨김 · ${post.moderationReason}`:'커뮤니티에 공개 중'}</p></div><button className="secondary" onClick={()=>moderate(post,!post.hidden)}>{post.hidden?'다시 공개':'게시물 숨기기'}</button></div>)}{!adminPosts.length&&<Empty title="관리할 공개 게시물이 없어요">공개 게시물을 숨겨도 작성자의 개인 기록은 보존됩니다.</Empty>}</div>:busy&&!posts.length?<Loading/>:posts.length?<><div className="public-feed">{posts.map(post => postCard(post))}</div><Pagination total={total} offset={offset} onChange={setOffset}/></>:<Empty icon="heart" title={profileTab==='liked'?'공감한 기록을 모아둘게요':'나누고 싶은 생각을 기다려요'}>{profileTab==='liked'?'다른 투자자의 기록에 하트를 남기면 이곳에서 다시 볼 수 있어요.':'전체 공개 일기와 시장 분위기만 공유한 기록이 표시됩니다.'}</Empty>}
      </>}
    </>:<>
      <div className="community-toolbar"><div className="toolbar-group"><label className={mode==='community'?'toolbar-date community-date':'toolbar-date'}>{mode==='top'?'순위를 살펴볼 날짜':'일기 날짜'}<input type="date" aria-label={mode==='top'?'TOP 10 날짜':'커뮤니티 일기 날짜'} value={mode==='top'?date:feedDate} onChange={e=>mode==='top'?(e.target.value&&setDate(e.target.value)):setFeedDate(e.target.value)}/></label>{mode==='top'?<button className="secondary" onClick={()=>setDate(today)}>오늘</button>:feedDate&&<button className="text-btn" onClick={()=>setFeedDate('')}>전체 날짜</button>}</div>{mode==='community'&&<div className="toolbar-group"><select aria-label="커뮤니티 분위기 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">모든 시장 분위기</option>{MOODS.map(m=><option key={m.value} value={m.value}>{m.ko}</option>)}</select><select aria-label="커뮤니티 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="latest">최신순</option><option value="oldest">오래된 순</option><option value="popular">공감 많은 순</option></select></div>}<button className="icon-button" aria-label="커뮤니티 새로고침" onClick={retry}><RefreshCw size={14}/></button></div>
      {mode === 'top' && <>
        <div className="segmented ranking-period" role="group" aria-label="순위 조회 기간">
          {RANK_PERIODS.map(([value,label]) => (
            <button key={value} type="button" className={rankPeriod===value?'active':''} aria-pressed={rankPeriod===value} onClick={()=>setRankPeriod(value)}>{label}</button>
          ))}
        </div>
        <div className="ranking-note">
          <Trophy size={19}/>
          <div>
            <strong>{selectedRanking?.range && selectedRanking.range.from !== selectedRanking.range.to
              ? `${selectedRanking.range.from.replaceAll('-','.') } ~ ${selectedRanking.range.to.replaceAll('-','.')}`
              : dateLabel(date)}</strong>
            <span>좋아요가 많은 순 · 동점은 공동 순위</span>
          </div>
          <span className="subtle-badge">{Math.min(selectedRanking?.total ?? 0,10)}개의 기록</span>
        </div>
      </>}
      <div className="community-feed-layout">
        <section aria-label={mode==='top'?'인기 투자 일기 순위':'공개 투자 일기 피드'}>
          {communityBusy && !communityPosts.length ? <Loading/> : communityPosts.length ? (
            <>
              <div className="public-feed">{communityPosts.map((post,index)=><div key={post.id}>
                {mode==='community' && (index===0 || communityPosts[index-1].date!==post.date) && <div className="feed-date-divider"><time dateTime={post.date}>{dateLabel(post.date)}</time></div>}
                {postCard(post,mode==='top'?1+communityPosts.filter(candidate=>candidate.likes>post.likes).length:undefined)}
              </div>)}</div>
              {mode==='community' && communityFeed.offset < communityFeed.total && (
                <div ref={feedEnd} className="feed-more">
                  {feedLoading ? <Loading/> : <button className="secondary" onClick={()=>void loadMore()}>이전 기록 더 보기</button>}
                </div>
              )}
            </>
          ) : <Empty title={mode==='top'?'이 기간의 공개 일기가 아직 없어요':'아직 이곳에 나눈 기록이 없어요'}>
            {mode==='top'?'전체 공개 일기가 이곳에 표시됩니다.':'전체 공개 일기와 공유한 시장 분위기가 이곳에 표시됩니다.'}
          </Empty>}
        </section>
        <aside className="community-feed-aside">
          <div className="aside-card"><div className="aside-title">시장을 바라보는 다섯 마음</div><div className="legend">{MOODS.map(m=><div className="legend-row" key={m.value}><i style={{background:m.color}}/>{m.ko}<span>{m.en}</span></div>)}</div></div>
        </aside>
      </div>
    </>}
    {detail && (
      <Dialog title={detail.visibility === 'sentiment' ? '공유한 시장 분위기' : '함께 읽는 투자 일기'} summary={<PostIndicators post={detail}/>} onClose={() => setDetail(null)}>
        <div className="post-detail">
          <button className="author-button" onClick={() => showAuthor(detail.author)}>
            <Avatar profile={detail.author}/>
            <div><strong>{detail.author.nickname}</strong><small>{detail.date.replaceAll('-', '.')} · {timeLabel(detail.publishedAt)} 게시</small></div>
            <ChevronRight size={13}/>
          </button>
          <Badge value={detail.sentiment}/>
          {detail.visibility === 'sentiment' ? <SentimentShareLabel/> : (
            <>
              <h2>{postTitle(detail)}</h2>
              <p className="full-diary-body">{detail.body}</p>
              <PublicAttachments post={detail}/>
              {detail.insight && <div className="public-insight"><strong>이날 얻은 인사이트</strong><p>{detail.insight}</p></div>}
            </>
          )}
          <div className="public-sensitive">
            {detail.visibility === 'public' && detail.trades.map((trade, index) => (
              <span key={index} className={`meta-pill trade-${trade.side}`}><b>{trade.side === 'buy' ? '매수' : '매도'}</b>{trade.symbol}{trade.note && ` · ${trade.note}`}</span>
            ))}
          </div>
          <div className="post-detail-footer">
            <BookmarkButton post={detail} pending={bookmarkPending.includes(detail.id)} onClick={()=>void bookmark(detail)}/>
            <LikeButton post={detail} pending={pending.includes(detail.id)} onClick={() => like(detail)}/>
            <small>{timeLabel(detail.updatedAt)} 수정</small>
            {detail.isMine && <button className="text-btn" onClick={() => { setDetail(null); onEdit(detail.date,detail.id); }}><Pencil size={12}/>내 일기 수정</button>}
            {profile?.isAdmin && <button className="text-btn danger-link" onClick={() => moderate(detail, true)}>게시물 숨기기</button>}
          </div>
          <Comments key={detail.id} postId={detail.id} user={user}/>
        </div>
      </Dialog>
    )}
    {authorDetail&&<Dialog title="투자자의 작은 소개" onClose={()=>setAuthorDetail(null)}><div className="public-profile"><Avatar profile={authorDetail}/><h2>{authorDetail.nickname}</h2><p>{authorDetail.bio||'아직 소개를 남기지 않았어요.'}</p></div></Dialog>}
  </div>;
}
function Loading(){return <div className="loading"><LoaderCircle size={18} className="spin"/>마음을 모으고 있어요.</div>;}
function LikeButton({post,pending,onClick}:{post:Post;pending:boolean;onClick:()=>void}){return <button className={`like-button ${post.liked?'liked':''}`} type="button" aria-pressed={post.liked} aria-label={`좋아요 ${post.likes}개${post.isMine?' · 본인 일기는 공감할 수 없어요':post.liked?' · 취소':' · 공감하기'}`} title={post.isMine?'본인의 일기에는 공감을 남길 수 없어요':post.liked?'공감 취소':'이 생각에 공감하기'} disabled={post.isMine||pending} onClick={onClick}>{pending?<LoaderCircle className="spin" size={15}/>:<Heart size={15} fill={post.liked?'currentColor':'none'}/>}<span>{post.likes}</span></button>;}
function SentimentShareLabel() {
  return <span className="sentiment-share-label"><ChartNoAxesCombined size={16} aria-hidden="true"/>시장 분위기만 공유</span>;
}

function EmotionPill({ emotion }: { emotion: string }) {
  const selected = EMOTIONS.find(item=>item.value===emotion);
  return <span className="meta-pill emotion-indicator"><span aria-hidden="true">{selected?.emoji}</span><span><span className="sr-only">감정 </span><b>{emotion}</b></span></span>;
}

function BookmarkButton({post,pending,onClick}:{post:Post;pending:boolean;onClick:()=>void}) {
  return <button type="button" className={`favorite-toggle community-bookmark ${post.bookmarked?'is-favorite':''}`}
    aria-label={post.bookmarked?'즐겨찾기 해제':'즐겨찾기 추가'} aria-pressed={post.bookmarked}
    title={post.bookmarked?'즐겨찾기 해제':'즐겨찾기 추가'} disabled={pending} onClick={onClick}>
    {pending?<LoaderCircle size={16} className="spin"/>:<Star size={17} fill={post.bookmarked?'currentColor':'none'}/>}
  </button>;
}

function PublicCard({ post, rank, pending, bookmarkPending, onOpen, onLike, onBookmark, onAuthor, onEdit }: {
  post: Post; rank?: number; pending: boolean; bookmarkPending: boolean; onOpen: () => void; onLike: () => void; onBookmark: () => void; onAuthor: () => void; onEdit: () => void;
}) {
  return (
    <article className="diary-card public-card" style={moodStyle(post.sentiment)}>
      {rank && <PostRank rank={rank}/>}
      <div className="public-card-top">
        <button className="author-button" onClick={onAuthor}>
          <Avatar profile={post.author}/>
          <div><strong>{post.author.nickname}</strong><small>{post.date.replaceAll('-', '.')}의 기록</small></div>
        </button>
        <PostIndicators post={post}/>
        <Badge value={post.sentiment}/>
      </div>
      {post.visibility === 'sentiment' ? (
        <button className="post-read-button mood-post-summary" onClick={onOpen}>
          <SentimentShareLabel/>
        </button>
      ) : (
        <button className="post-read-button public-diary-preview" onClick={onOpen}>
          <span className="public-diary-preview-copy">
            <span className="public-diary-title">{postTitle(post)}</span>
            <span className="public-diary-excerpt">{post.body}</span>
            <span className="public-diary-read-link">기록 읽기 <ArrowRight size={12}/></span>
          </span>
          {post.images?.length ? (
            <span className="public-card-thumbnail">
              <img
                src={publicImagePath(post.images[0], post.id)}
                alt=""
                width={112}
                height={82}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
              />
              <span><ImageIcon size={11} aria-hidden="true"/>{post.images.length}장</span>
            </span>
          ) : null}
        </button>
      )}
      <div className="public-card-bottom">
        <span>
          {timeLabel(post.publishedAt)} 게시{post.isMine && ' · 나의 기록'}
        </span>
        <div className="community-card-actions">{post.isMine && <button type="button" className="text-btn community-edit" aria-label={postTitle(post)+' 수정'} onClick={onEdit}><Pencil size={12}/>수정</button>}<BookmarkButton post={post} pending={bookmarkPending} onClick={onBookmark}/><LikeButton post={post} pending={pending} onClick={onLike}/></div>
      </div>
    </article>
  );
}
const MEDALS = [
  { className: 'ranking-gold', label: '금메달' },
  { className: 'ranking-silver', label: '은메달' },
  { className: 'ranking-bronze', label: '동메달' },
];

function PostRank({ rank }: { rank: number }) {
  const medal = MEDALS[rank - 1];
  if (!medal) return <span className="ranking-number">{rank}위</span>;
  return (
    <span className={`ranking-number ranking-medal ${medal.className}`} role="img" aria-label={`좋아요 순위 ${rank}위 · ${medal.label}`}>
      <Medal size={19} aria-hidden="true"/>
    </span>
  );
}

function publicImagePath(image: DiaryImage, postId: string) {
  return '/api/images/' + encodeURIComponent(image.id) + '?postId=' + encodeURIComponent(postId);
}

function PublicAttachments({ post }: { post: Extract<Post, { visibility: 'public' }> }) {
  if (!post.images?.length) return null;

  return (
    <section className="public-attachments" aria-label={`첨부 이미지 ${post.images.length}장`}>
      <h3><ImageIcon size={14} aria-hidden="true"/>첨부 이미지 <small>{post.images.length}장</small></h3>
      <div className="public-attachment-grid">
        {post.images.map((image, index) => {
          const url = publicImagePath(image, post.id);
          return (
            <a key={image.id} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt={`공개 일기 첨부 이미지 ${index + 1}`} loading="lazy" decoding="async"/>
              <span>크게 보기 <ArrowUpRight size={12}/></span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

const EMOTION_COLORS = ['#708f76', '#b49364', '#9a87ad', '#6d89a8', '#be836c'];

function EmotionSummary({ distribution }: { distribution: Distribution }) {
  const total = distribution.emotionTotal ?? 0;
  const buckets = EMOTIONS.map((emotion, index) => {
    const item = distribution.emotions?.find(bucket => bucket.emotion === emotion.value);
    return {
      ...emotion,
      color: EMOTION_COLORS[index],
      count: item?.count ?? 0,
      percent: item?.percent ?? 0,
    };
  });

  return (
    <>
      <div className="mood-overview">
        <div><span>오늘 감정을 나눈 사람</span><strong>{total}<small>명</small></strong></div>
        {!total && <div><b>아직 공개된 감정이 없어요</b></div>}
      </div>
      <div
        className={`mood-stacked ${total ? '' : 'is-empty'}`}
        role="img"
        aria-label={total ? buckets.map(bucket => `${bucket.value} ${bucket.percent.toFixed(1)}%`).join(', ') : '공유 감정 0명'}
      >
        {buckets.map(bucket => (
          <span
            key={bucket.value}
            title={`${bucket.value} ${bucket.count}명`}
            style={{ width: `${bucket.percent}%`, background: bucket.color }}
          />
        ))}
      </div>
      <div className="mood-table emotion-table">
        {buckets.map(bucket => (
          <div key={bucket.value}>
            <span><span aria-hidden="true">{bucket.emoji}</span>{bucket.value}</span>
            <strong>{bucket.count}<small>명</small></strong>
            <b>{bucket.percent.toFixed(1)}<small>%</small></b>
          </div>
        ))}
      </div>
      <p className="mood-explanation">공유에 동의한 감정만 집계하며, 각 비율은 감정을 나눈 사람을 기준으로 계산해요.</p>
    </>
  );
}

function StackedBar({distribution}:{distribution:Distribution}){return <div className={`mood-stacked ${!distribution.total?'is-empty':''}`} role="img" aria-label={distribution.total?MOODS.map(m=>`${m.ko} ${distribution.counts.find(c=>c.sentiment===m.value)?.percent||0}%`).join(', '):'참여자 0명'}>{MOODS.map(m=>{const item=distribution.counts.find(c=>c.sentiment===m.value);return <span key={m.value} title={`${m.ko}: ${item?.count||0}명 (${item?.percent||0}%)`} style={{width:`${item?.percent||0}%`,background:m.color}}/>;})}</div>;}
function MoodSummary({distribution}:{distribution:Distribution}){const label=distribution.total?distribution.dominant.map(v=>MOODS.find(m=>m.value===v)?.ko).join(' · '):'아직 나눈 마음이 없어요';return <><div className="mood-overview"><div><span>함께 나눈 마음</span><strong>{distribution.total}<small>명</small></strong></div><div><span>{distribution.dominant.length>1?'가장 많은 마음 · 공동':'오늘 가장 많은 마음'}</span><b>{label}</b></div></div><StackedBar distribution={distribution}/><div className="mood-scale"><span>비관적인 시선</span><span>낙관적인 시선</span></div><div className="mood-table">{MOODS.map(m=>{const item=distribution.counts.find(c=>c.sentiment===m.value);return <div key={m.value}><span><i style={{background:m.color}}/>{m.ko}</span><strong>{item?.count||0}<small>명</small></strong><b>{Number(item?.percent||0).toFixed(1)}<small>%</small></b></div>;})}</div><p className="mood-explanation">시장 분위기만 공유하거나 전체 공개한 일기를 집계해요. 참여가 없는 항목도 항상 표시합니다.</p></>;}
function Pagination({total,offset,onChange}:{total:number;offset:number;onChange:(offset:number)=>void}){if(total<=20)return null;return <div className="feed-pagination"><button className="secondary" disabled={offset===0} onClick={()=>onChange(Math.max(0,offset-20))}>이전</button><span>{offset+1}–{Math.min(offset+20,total)} / {total}</span><button className="secondary" disabled={offset+20>=total} onClick={()=>onChange(offset+20)}>다음</button></div>;}
function ProfileEditor({profile,email,onSaved,onSettings}:{profile:Profile|null;email:string;onSaved:(p:Profile)=>void;onSettings:()=>void}){const [nickname,setNickname]=useState(''),[avatarUrl,setAvatarUrl]=useState(''),[bio,setBio]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');useEffect(()=>{if(profile){setNickname(profile.nickname);setAvatarUrl(profile.avatarUrl||'');setBio(profile.bio||'');}},[profile?.id,profile?.nickname]);async function submit(){setSaving(true);setError('');try{const d=await api<{profile:Profile}>('/api/profile',{method:'PUT',body:JSON.stringify({nickname,avatarUrl,bio})});onSaved(d.profile);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}return <section className="profile-editor"><div className="profile-intro"><Avatar profile={{nickname:nickname||'나',avatarUrl}}/><div><h2>{profile?.nickname||'나의 투자 공간'}</h2><p>{email}</p><span><ShieldCheck size={12}/>새 투자 일기는 기본 비공개</span></div><button className="secondary" onClick={onSettings}><Settings2 size={13}/>계정 · 기록 설정</button></div><div className="profile-fields"><div className="field"><label htmlFor="profile-nickname">닉네임</label><input id="profile-nickname" maxLength={24} placeholder="다른 투자자들이 부를 이름" value={nickname} onChange={e=>setNickname(e.target.value)}/><p className="helper">다른 회원과 겹치지 않는 닉네임을 사용해요.</p></div><div className="field"><label htmlFor="profile-avatar">프로필 이미지 주소 <span className="optional">선택</span></label><input id="profile-avatar" type="url" placeholder="https://" value={avatarUrl} onChange={e=>setAvatarUrl(e.target.value)}/></div><div className="field profile-bio"><label htmlFor="profile-bio">나의 소개 <span className="optional">선택</span></label><textarea id="profile-bio" maxLength={300} rows={3} placeholder="어떤 생각으로 투자하고 있나요?" value={bio} onChange={e=>setBio(e.target.value)}/></div></div>{error&&<div role="alert" className="error-banner">{error}</div>}<div className="profile-save"><small>닉네임과 소개는 공개한 기록에 함께 표시됩니다.</small><button className="primary" onClick={submit} disabled={saving||!profile}>{saving?<LoaderCircle size={13} className="spin"/>:<Check size={13}/>}프로필 저장</button></div></section>;}
function Dialog({title,summary,children,onClose}:{title:string;summary?:ReactNode;children:ReactNode;onClose:()=>void}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const old=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.querySelector<HTMLButtonElement>('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();onClose();}if(e.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select')||[]).filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus();};},[]);return <div className="modal-backdrop community-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal community-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="modal-header"><h2>{title}</h2>{summary}<button className="close" aria-label="닫기" onClick={onClose}><X size={18}/></button></div><div className="community-modal-body">{children}</div></div></div>;}


type Comment = {id:string;body:string;version:number;createdAt:string;updatedAt:string;isMine:boolean;author:{nickname:string;avatarUrl:string}};
type CommentPage = {enabled:boolean;total:number;comments:Comment[]};
function Comments({postId,user}:{postId:string;user:User}) {
  const [page,setPage] = useState<CommentPage|null>(null);
  const [body,setBody] = useState(''),[editing,setEditing] = useState<Comment|null>(null),[editBody,setEditBody] = useState('');
  const [busy,setBusy] = useState(false),[loading,setLoading] = useState(true),[error,setError] = useState('');
  const [deleting,setDeleting] = useState<string|null>(null);
  const createRequest = useRef<{id:string;body:string}|null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    api<CommentPage>('/api/comments?postId='+encodeURIComponent(postId),{signal:controller.signal})
      .then(setPage).catch(error => {if(!controller.signal.aborted)setError(error.message);})
      .finally(() => {if(!controller.signal.aborted)setLoading(false);});
    return () => controller.abort();
  },[postId,user?.id]);
  async function reload(more=false) {
    setError('');
    setLoading(true);
    try {
      const result = await api<CommentPage>('/api/comments?postId='+encodeURIComponent(postId)+(more?'&offset='+page!.comments.length:''));
      setPage(previous => more && previous ? {...result,comments:[...previous.comments,...result.comments]} : result);
    } catch(error) {setError((error as Error).message);}
    finally {setLoading(false);}
  }
  async function submit(action:'create'|'edit'|'delete',comment?:Comment) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    const text = action==='edit'?editBody.trim():body.trim();
    if(action==='create' && createRequest.current?.body!==text)createRequest.current={id:crypto.randomUUID(),body:text};
    try {
      await api('/api/comments',{method:'POST',body:JSON.stringify({action,postId,id:comment?.id??createRequest.current!.id,
        ...(action!=='delete'?{body:text}:{}),...(comment?{version:comment.version}:{})})});
      if(action==='create'){setBody('');createRequest.current=null;}
      setEditing(null);setDeleting(null);
      await reload();
      window.dispatchEvent(new Event('onki-data'));
    } catch(error) {setError((error as Error).message);}
    finally {lock.current=false;setBusy(false);}
  }
  return <section className="post-comments" aria-label="댓글">
    <h3>댓글 {page?.total??0}</h3>
    {error&&<div role="alert" className="error-banner">{error}<button type="button" className="text-btn" disabled={loading||busy} onClick={()=>void reload()}>새로 확인</button></div>}
    {!page&&loading?<Loading/>:page&&<>
      {!page.enabled?<p className="helper">작성자가 댓글 기능을 비활성화했어요.</p>:<>
        {page.comments.length===0&&<p className="helper">첫 댓글을 남겨 보세요.</p>}
        <div className="comment-list">{page.comments.map(comment=><article className="comment-item" key={comment.id}>
          <div className="comment-author"><Avatar profile={comment.author}/><strong>{comment.author.nickname}</strong><time>{timeLabel(comment.createdAt)}{comment.version>1?' · 수정됨':''}</time></div>
          {editing?.id===comment.id?<div className="comment-form"><label htmlFor="edit-comment">댓글 수정</label><textarea id="edit-comment" maxLength={2000} value={editBody} onChange={event=>setEditBody(event.target.value)} disabled={busy}/><div className="comment-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setEditing(null)}>취소</button><button type="button" className="primary" disabled={busy||!editBody.trim()} onClick={()=>void submit('edit',comment)}>수정 저장</button></div></div>:<p className="comment-body">{comment.body}</p>}
          {comment.isMine&&editing?.id!==comment.id&&<div className="comment-actions">
            {deleting===comment.id?<><span>이 댓글을 삭제할까요?</span><button type="button" className="text-btn" disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button type="button" className="text-btn danger-link" disabled={busy} onClick={()=>void submit('delete',comment)}>삭제 확인</button></>:<><button type="button" className="text-btn" disabled={busy} onClick={()=>{setEditing(comment);setEditBody(comment.body);setDeleting(null);}}>수정</button><button type="button" className="text-btn danger-link" disabled={busy} onClick={()=>setDeleting(comment.id)}>삭제</button></>}
          </div>}
        </article>)}</div>
        {page.comments.length<page.total&&<button type="button" className="secondary" disabled={loading||busy} onClick={()=>void reload(true)}>댓글 더 보기</button>}
        {user?<form className="comment-form" onSubmit={event=>{event.preventDefault();void submit('create');}}><label htmlFor="new-comment">댓글 남기기</label><textarea id="new-comment" maxLength={2000} rows={3} placeholder="이 기록에 대한 생각을 나눠 주세요." value={body} disabled={busy} onChange={event=>setBody(event.target.value)}/><div className="comment-actions"><small>{body.length} / 2,000자</small><button className="primary" disabled={busy||!body.trim()}>{busy?'저장 중':'댓글 등록'}</button></div></form>:<button type="button" className="secondary" onClick={auth}>로그인하고 댓글 남기기</button>}
      </>}
    </>}
  </section>;
}

function PostIndicators({post}:{post:Post}) {
  return <div className="post-indicators">
    {post.visibility==='public' && post.fearGreed && <span className="meta-pill fear-greed-indicator" aria-label={'CNN Fear & Greed 지수 '+post.fearGreed.value+' / 100'} title={'CNN Fear & Greed'+(post.fearGreed.asOf?' · '+timeLabel(post.fearGreed.asOf)+' 기준':'')}>F&amp;G <b>{post.fearGreed.value}</b></span>}
    {post.emotion && <EmotionPill emotion={post.emotion}/>}
  </div>;
}
