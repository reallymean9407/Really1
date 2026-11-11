import { env } from "cloudflare:workers";
import { currentUser } from "../auth";
import { ApiError, invalid, normalizeEmotion, object, resolvePostId, validDate } from "./server-validation";
import { EMOTIONS, type DiaryImage, type FearGreed, type Sentiment, type Trade } from "./model";

const moods: Sentiment[] = ["very-bearish", "bearish", "neutral", "bullish", "very-bullish"];
const emotions = EMOTIONS.map(emotion => emotion.value);
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const db = () => { const database = (env as unknown as {DB?:D1Database}).DB; if (!database) throw new ApiError(503,"STORAGE_UNAVAILABLE","저장소 연결을 확인해 주세요."); return database; };
function allowedKeys(value: Record<string,unknown>, allowed: string[]) { if (Object.keys(value).some(key=>!allowed.includes(key))) invalid("지원하지 않는 입력 필드가 있습니다."); }
const admin = (id: string, email = "") => {
  const settings = env as unknown as {ADMIN_USER_IDS?:string;ADMIN_EMAILS?:string};
  return (settings.ADMIN_USER_IDS ?? "").split(",").map(v=>v.trim()).filter(Boolean).includes(id) || (!!email && (settings.ADMIN_EMAILS ?? "").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase()));
};
async function requireAdmin() { const user = await currentUser(); if (!user || !admin(user.id,user.email)) throw new ApiError(403,"ADMIN_REQUIRED","운영자만 이용할 수 있습니다."); return user.id; }

type PostRow = {entry_id:string;bookmarked:number;author_id:string;date:string;visibility:"public"|"sentiment";title:string|null;body:string|null;insight:string|null;sentiment:Sentiment|null;fear_greed_json:string|null;emotion:string|null;trades_json:string;images_json:string;published_at:string;updated_at:string;nickname:string|null;avatar_url:string|null;bio:string|null;hidden:number;moderation_reason:string|null;moderated_at:string|null;likes:number;liked:number};
const postColumns = "p.entry_id,p.author_id,p.date,p.visibility,p.title,p.body,p.insight,p.sentiment,p.fear_greed_json,p.emotion,p.trades_json,p.published_at,p.updated_at,p.nickname,p.avatar_url,p.bio,p.hidden,p.moderation_reason,p.moderated_at";
const imageProjection = `CASE WHEN p.visibility='public' THEN (
  SELECT json_group_array(json_object('id',id,'name','첨부 이미지 ' || (position+1),'type',type,'size',size))
  FROM (SELECT id,type,size,position FROM community_public_images
    WHERE entry_id=p.entry_id ORDER BY position)
) ELSE '[]' END AS images_json`;
const publicPost = (row: PostRow, userId: string|null, moderation = false) => ({
  id: row.entry_id, bookmarked: !!row.bookmarked, author:{id:row.author_id,nickname:row.nickname ?? "익명의 기록자",avatarUrl:row.avatar_url ?? "",bio:row.bio ?? ""},
  date: row.date, visibility: row.visibility, sentiment: row.sentiment, emotion: row.emotion,
  ...(row.visibility === "public" ? {
    title: row.title ?? "",
    body: row.body ?? "",
    insight: row.insight ?? "",
    fearGreed: row.fear_greed_json ? JSON.parse(row.fear_greed_json) as FearGreed : null,
    cashRatio: null,
    trades: JSON.parse(row.trades_json) as Trade[],
    images: JSON.parse(row.images_json) as DiaryImage[],
  } : {}),
  publishedAt:row.published_at,updatedAt:row.updated_at,likes:Number(row.likes),liked:!!row.liked,isMine:row.author_id===userId,
  ...(moderation ? {hidden:!!row.hidden,moderationReason:row.moderation_reason??"",moderatedAt:row.moderated_at??""} : {}),
});
function pagination(params:URLSearchParams, top:boolean) {
  const integer=(raw:string|null,fallback:number,max:number)=>{if(raw===null)return fallback; if(!/^\d+$/.test(raw)||Number(raw)>max)invalid("조회 범위를 확인해 주세요."); return Number(raw);};
  const limit = Math.max(1, integer(params.get("limit"), top ? 10 : 20, 50));
  return {limit:top ? Math.min(10, limit) : limit,offset:top?0:integer(params.get("offset"),0,100000)};
}
function rankingRange(date: string, period: string) {
  const day = new Date(date + "T00:00:00Z");
  if (period === "daily") return { from: date, to: date };
  if (period === "weekly") {
    const monday = dayOffset(date,-((day.getUTCDay()+6)%7));
    return { from: monday, to: dayOffset(monday,6) };
  }
  if (period === "monthly") {
    day.setUTCMonth(day.getUTCMonth()+1,0);
    return { from: date.slice(0,7)+"-01", to: day.toISOString().slice(0,10) };
  }
  if (period === "yearly") return { from: date.slice(0,4)+"-01-01", to: date.slice(0,4)+"-12-31" };
  invalid("일간, 주간, 월간, 연간 중 선택해 주세요.");
}
export async function communityFeed(params:URLSearchParams, includeHidden=false) {
  const user=await currentUser();
  if(includeHidden) await requireAdmin();
  const sort=params.get("sort")??"latest";
  if(!["latest","oldest","popular","top"].includes(sort))invalid("정렬 방식을 확인해 주세요.");
  const top=sort==="top";
  const filters:string[]=[includeHidden?"1=1":"p.hidden=0"];
  if (top) filters.push("p.visibility='public'");
  const bindings:(string|number)[]=[];
  const date=params.get("date")||(top?today():"");
  const range = top ? rankingRange(validDate(date),params.get("period") ?? "daily") : null;
  if (range) { filters.push("p.date BETWEEN ? AND ?"); bindings.push(range.from,range.to); }
  else if (date) { filters.push("p.date=?"); bindings.push(validDate(date)); }
  const sentiment=params.get("sentiment");
  if(sentiment){if(!moods.includes(sentiment as Sentiment))invalid("시장 분위기를 확인해 주세요.");filters.push("p.sentiment=?");bindings.push(sentiment);}
  const emotion = normalizeEmotion(params.get("emotion"));
  if (emotion) {
    if (!emotions.includes(emotion)) invalid("감정 상태를 확인해 주세요.");
    filters.push("p.emotion=?");
    bindings.push(emotion);
  }
  const author=params.get("author");
  if(author){if(author.length>256)invalid("작성자를 확인해 주세요.");filters.push("p.author_id=?");bindings.push(author);}
  const postId=params.get("id");
  if (postId) { filters.push("p.entry_id=?"); bindings.push(resolvePostId(postId)); }
  if (params.get("bookmarked") === "true") {
    if (!user) throw new ApiError(401,"SIGN_IN_REQUIRED","로그인한 후 이용해 주세요.");
    filters.push("EXISTS(SELECT 1 FROM journal_favorites f WHERE f.entry_id=p.entry_id AND f.user_id=?)");
    bindings.push(user.id);
    if (params.get("others") === "true") { filters.push("p.author_id<>?"); bindings.push(user.id); }
  }
  if(params.get("liked")==="true") {if(!user)throw new ApiError(401,"SIGN_IN_REQUIRED","로그인한 후 이용해 주세요.");filters.push("EXISTS(SELECT 1 FROM diary_likes x WHERE x.entry_id=p.entry_id AND x.user_id=?)");bindings.push(user.id);}
  const {limit,offset}=pagination(params,top);
  const where=filters.join(" AND ");
  const ordering = sort === "popular" || top
    ? "likes DESC,p.published_at DESC,p.entry_id DESC"
    : sort === "oldest" ? "p.date ASC,p.published_at ASC,p.entry_id ASC" : "p.date DESC,p.published_at DESC,p.entry_id DESC";
  const [rows,count] = await Promise.all([
    db().prepare(`SELECT ${postColumns},${imageProjection},
      (SELECT count(*) FROM diary_likes l WHERE l.entry_id=p.entry_id) AS likes,
      EXISTS(SELECT 1 FROM diary_likes l WHERE l.entry_id=p.entry_id AND l.user_id=?) AS liked,
      EXISTS(SELECT 1 FROM journal_favorites f WHERE f.entry_id=p.entry_id AND f.user_id=?) AS bookmarked
      FROM community_post_projection p WHERE ${where} ORDER BY ${ordering} LIMIT ? OFFSET ?`)
      .bind(user?.id??"",user?.id??"",...bindings,limit,offset).all<PostRow>(),
    db().prepare(`SELECT count(*) AS total FROM community_post_projection p WHERE ${where}`).bind(...bindings).first<{total:number}>(),
  ]);
  return { posts:rows.results.map(row=>publicPost(row,user?.id??null,includeHidden)), total:count?.total??0, ...(range ? {range} : {}) };
}

export async function setLike(userId:string, raw:unknown) {
  const value=object(raw);allowedKeys(value,["postId","liked"]);
  if(typeof value.liked!=="boolean")invalid("좋아요 상태를 확인해 주세요.");
  const entryId = resolvePostId(value.postId);
  const database = db();
  const post = await database.prepare("SELECT author_id FROM community_post_projection WHERE entry_id=? AND hidden=0")
    .bind(entryId).first<{author_id:string}>();
  if (post?.author_id === userId) throw new ApiError(400,"SELF_LIKE_FORBIDDEN","본인의 기록에는 좋아요를 누를 수 없습니다.");
  const write = value.liked
    ? database.prepare(`INSERT INTO diary_likes(entry_id,author_id,date,user_id,created_at)
        SELECT entry_id,author_id,date,?,? FROM community_post_projection WHERE entry_id=? AND hidden=0
        ON CONFLICT(entry_id,user_id) DO NOTHING`).bind(userId,new Date().toISOString(),entryId)
    : database.prepare(`DELETE FROM diary_likes WHERE entry_id=? AND user_id=? AND EXISTS(
        SELECT 1 FROM community_post_projection WHERE entry_id=? AND hidden=0)`).bind(entryId,userId,entryId);
  const result = await database.batch<{likes:number;liked:number}>([
    write,
    database.prepare(`SELECT (SELECT count(*) FROM diary_likes l WHERE l.entry_id=p.entry_id) AS likes,
      EXISTS(SELECT 1 FROM diary_likes l WHERE l.entry_id=p.entry_id AND l.user_id=?) AS liked
      FROM community_post_projection p WHERE p.entry_id=? AND p.hidden=0`).bind(userId,entryId),
  ]);
  const row = result[1].results[0];
  if (!row) throw new ApiError(404,"POST_NOT_FOUND","공개된 기록을 찾지 못했습니다.");
  return { liked:!!row.liked,likes:Number(row.likes) };
}

function dayOffset(date:string, offset:number) {const value=new Date(date+"T00:00:00Z");value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);}
type CountRow={date:string;sentiment:Sentiment;count:number};
type EmotionCountRow = { date: string; emotion: string; count: number };
function aggregate(date:string, rows:CountRow[]) {
  const total=rows.reduce((sum,row)=>sum+Number(row.count),0);
  const largest=Math.max(0,...rows.map(row=>Number(row.count)));
  return {date,total,dominant:largest?moods.filter(m=>rows.some(row=>row.sentiment===m&&Number(row.count)===largest)):[],counts:moods.map(sentiment=>{const count=Number(rows.find(row=>row.sentiment===sentiment)?.count??0);return {sentiment,count,percent:total?count/total*100:0};})};
}

function aggregateEmotions(rows: EmotionCountRow[]) {
  const emotionTotal = rows.reduce((sum, row) => sum + Number(row.count), 0);
  return {
    emotionTotal,
    emotions: emotions.map(emotion => {
      const count = Number(rows.find(row => row.emotion === emotion)?.count ?? 0);
      return { emotion, count, percent: emotionTotal ? count / emotionTotal * 100 : 0 };
    }),
  };
}

export async function sentimentStats(params:URLSearchParams) {
  const current=today();const selected=validDate(params.get("date")||current);
  let to=validDate(params.get("to")||selected);
  let from:string;
  if(params.has("from")) from=validDate(params.get("from"));
  else {const days=Number(params.get("days")||7);if(![7,30,90].includes(days))invalid("7일, 30일, 90일 중 선택해 주세요.");from=dayOffset(to,-days+1);}
  const length=(Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000+1;
  if(length<1||length>366)invalid("조회 기간은 최대 366일이며 시작일이 종료일보다 늦을 수 없습니다.");
  const database=db();
  const [rows,selectedRows,emotionRows]=await Promise.all([
    database.prepare("SELECT date,sentiment,count FROM community_sentiment_counts WHERE date>=? AND date<=? ORDER BY date ASC").bind(from,to).all<CountRow>(),
    database.prepare("SELECT date,sentiment,count FROM community_sentiment_counts WHERE date=?").bind(selected).all<CountRow>(),
    database.prepare(`SELECT date,emotion,count(*) AS count FROM (
      SELECT date,emotion,row_number() OVER (PARTITION BY author_id,date ORDER BY published_at DESC,entry_id DESC) AS position
      FROM community_post_projection WHERE hidden=0 AND ((date>=? AND date<=?) OR date=?)
      AND emotion IN (${emotions.map(() => "?").join(",")})
      ) WHERE position=1 GROUP BY date,emotion`)
      .bind(from,to,selected,...emotions).all<EmotionCountRow>(),
  ]);
  const summarize = (date: string, moodsForDate: CountRow[]) => ({
    ...aggregate(date, moodsForDate),
    ...aggregateEmotions(emotionRows.results.filter(row => row.date === date)),
  });
  return {
    today: current,
    selected: summarize(selected,selectedRows.results),
    history: Array.from({length}, (_, i) => {
      const date = dayOffset(from, i);
      return summarize(date, rows.results.filter(row => row.date === date));
    }),
  };
}

type ProfileRow={user_id:string;nickname:string;avatar_url:string;bio:string};
const profile=(row:ProfileRow,isAdmin=false)=>({id:row.user_id,nickname:row.nickname,avatarUrl:row.avatar_url,bio:row.bio,isAdmin});
export async function getProfile(requestedId?:string|null) {
  const user=await currentUser();
  const id=requestedId||user?.id;
  if(!id)throw new ApiError(401,"SIGN_IN_REQUIRED","로그인한 후 이용해 주세요.");
  if(id.length>256)invalid("프로필을 확인해 주세요.");
  let row=await db().prepare("SELECT user_id,nickname,avatar_url,bio FROM profiles WHERE user_id=?").bind(id).first<ProfileRow>();
  if(!row&&id===user?.id){
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(id));
    const suffix=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("").slice(0,12);
    const nickname=`온기_${suffix}`;
    await db().prepare("INSERT INTO profiles(user_id,nickname,nickname_key,avatar_url,bio,updated_at) VALUES(?,?,?,'','',?) ON CONFLICT(user_id) DO NOTHING").bind(id,nickname,nickname.toLowerCase(),new Date().toISOString()).run();
    row=await db().prepare("SELECT user_id,nickname,avatar_url,bio FROM profiles WHERE user_id=?").bind(id).first<ProfileRow>();
  }
  if(!row)throw new ApiError(404,"PROFILE_NOT_FOUND","프로필을 찾지 못했습니다.");
  return {profile:profile(row,id===user?.id&&admin(id,user?.email))};
}
export async function updateProfile(userId:string,raw:unknown) {
  const value=object(raw);allowedKeys(value,["nickname","avatarUrl","bio"]);
  if(typeof value.nickname!=="string")invalid("닉네임을 입력해 주세요.");
  const nickname=value.nickname.normalize("NFKC").trim();
  if(nickname.length<2||nickname.length>24||/[\u0000-\u001f\u007f<>]/.test(nickname))invalid("닉네임은 2~24자로 입력해 주세요.");
  if(typeof value.bio!=="string"||value.bio.length>300)invalid("소개는 300자 이내로 입력해 주세요.");
  if(typeof value.avatarUrl!=="string"||value.avatarUrl.length>2048)invalid("프로필 이미지 주소를 확인해 주세요.");
  let avatarUrl=value.avatarUrl.trim();
  if(avatarUrl){let url:URL;try{url=new URL(avatarUrl);}catch{invalid("HTTPS 이미지 주소를 입력해 주세요.");}if(url.protocol!=="https:"||url.username||url.password)invalid("HTTPS 이미지 주소를 입력해 주세요.");avatarUrl=url.toString();}
  try {
    await db().prepare("INSERT INTO profiles(user_id,nickname,nickname_key,avatar_url,bio,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname,nickname_key=excluded.nickname_key,avatar_url=excluded.avatar_url,bio=excluded.bio,updated_at=excluded.updated_at").bind(userId,nickname,nickname.toLocaleLowerCase("ko-KR"),avatarUrl,value.bio,new Date().toISOString()).run();
  } catch(error) {if(error instanceof Error&&/UNIQUE|constraint.*nickname/i.test(error.message))throw new ApiError(409,"NICKNAME_TAKEN","이미 사용 중인 닉네임입니다.");throw error;}
  return {profile:{id:userId,nickname,avatarUrl,bio:value.bio,isAdmin:admin(userId,(await currentUser())?.email)}};
}
export async function moderate(raw:unknown) {
  const moderator=await requireAdmin();
  const value=object(raw);allowedKeys(value,["postId","hidden","reason"]);
  if(typeof value.hidden!=="boolean")invalid("숨김 상태를 확인해 주세요.");
  if(typeof value.reason!=="string"||value.reason.trim().length<2||value.reason.length>500)invalid("관리 사유를 2~500자로 입력해 주세요.");
  const entryId = resolvePostId(value.postId);
  const now = new Date().toISOString();
  const exists = await db().prepare("SELECT entry_id FROM community_post_projection WHERE entry_id=?").bind(entryId).first();
  if (!exists) throw new ApiError(404,"POST_NOT_FOUND","공개된 기록을 찾지 못했습니다.");
  await db().batch([
    db().prepare(`INSERT INTO diary_moderation(entry_id,author_id,date,hidden,reason,moderator_id,updated_at)
      SELECT entry_id,author_id,date,?,?,?,? FROM community_post_projection WHERE entry_id=?
      ON CONFLICT(entry_id) DO UPDATE SET hidden=excluded.hidden,reason=excluded.reason,moderator_id=excluded.moderator_id,updated_at=excluded.updated_at`)
      .bind(value.hidden?1:0,value.reason.trim(),moderator,now,entryId),
    db().prepare(`INSERT INTO moderation_audit(id,entry_id,author_id,date,hidden,reason,moderator_id,created_at)
      SELECT ?,entry_id,author_id,date,?,?,?,? FROM community_post_projection WHERE entry_id=?`)
      .bind(crypto.randomUUID(),value.hidden?1:0,value.reason.trim(),moderator,now,entryId),
  ]);
  return {hidden:value.hidden};
}

async function commentPost(entryId: string) {
  const row = await db().prepare(`SELECT coalesce(json_extract(e.entry_json,'$.commentsEnabled'),1) AS enabled
    FROM community_post_projection p JOIN journal_entries e ON e.entry_id=p.entry_id
    WHERE p.entry_id=? AND p.hidden=0`).bind(entryId).first<{enabled:number}>();
  if (!row) throw new ApiError(404,"POST_NOT_FOUND","공개된 기록을 찾지 못했습니다.");
  return row;
}

export async function listComments(params: URLSearchParams) {
  const entryId = resolvePostId(params.get("postId"));
  const post = await commentPost(entryId);
  const offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) invalid("조회 범위를 확인해 주세요.");
  const user = await currentUser();
  const results = await db().batch([
    db().prepare(`SELECT c.id,c.body,c.version,c.created_at,c.updated_at,c.user_id,
      p.nickname,p.avatar_url FROM diary_comments c LEFT JOIN profiles p ON p.user_id=c.user_id
      WHERE c.entry_id=? AND c.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT 50 OFFSET ?`).bind(entryId,offset),
    db().prepare("SELECT count(*) AS total FROM diary_comments WHERE entry_id=? AND deleted_at IS NULL").bind(entryId),
  ]);
  return {enabled:!!post.enabled,total:Number((results[1].results[0] as {total:number}).total),comments:results[0].results.map(raw => {
    const row = raw as {id:string;body:string;version:number;created_at:string;updated_at:string;user_id:string;nickname:string|null;avatar_url:string|null};
    return {id:row.id,body:row.body,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,
      isMine:row.user_id===user?.id,author:{nickname:row.nickname || "익명의 기록자",avatarUrl:row.avatar_url || ""}};
  })};
}

export async function mutateComment(userId: string, raw: unknown) {
  const value = object(raw);
  allowedKeys(value,["action","postId","id","body","version"]);
  const entryId = resolvePostId(value.postId);
  if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id)) invalid("댓글 ID를 확인해 주세요.");
  if (!["create","edit","delete"].includes(String(value.action))) invalid("댓글 작업을 확인해 주세요.");
  const post = await commentPost(entryId);
  if (!post.enabled) throw new ApiError(409,"COMMENTS_DISABLED","댓글이 비활성화된 일기입니다.");
  const now = new Date().toISOString();
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (value.action !== "delete" && (!body || body.length > 2000)) invalid("댓글은 1~2,000자로 입력해 주세요.");
  const visible = `EXISTS(SELECT 1 FROM community_post_projection p JOIN journal_entries e ON e.entry_id=p.entry_id
    WHERE p.entry_id=? AND p.hidden=0 AND coalesce(json_extract(e.entry_json,'$.commentsEnabled'),1)=1)`;
  if (value.action === "create") {
    await db().prepare(`INSERT INTO diary_comments(id,entry_id,user_id,body,created_at,updated_at)
      SELECT ?,?,?,?,?,? WHERE ${visible} ON CONFLICT(id) DO NOTHING`)
      .bind(value.id,entryId,userId,body,now,now,entryId).run();
    const saved = await db().prepare("SELECT user_id,body FROM diary_comments WHERE id=? AND entry_id=? AND deleted_at IS NULL").bind(value.id,entryId).first<{user_id:string;body:string}>();
    if (!saved || saved.user_id !== userId || saved.body !== body) throw new ApiError(409,"COMMENT_CONFLICT","댓글 상태가 변경됐어요. 다시 확인해 주세요.");
  } else {
    if (!Number.isInteger(value.version) || Number(value.version) < 1) invalid("댓글 버전을 확인해 주세요.");
    const result = await db().prepare(`UPDATE diary_comments SET body=CASE WHEN ?='edit' THEN ? ELSE body END,
      updated_at=?,deleted_at=CASE WHEN ?='delete' THEN ? ELSE NULL END,version=version+1
      WHERE id=? AND entry_id=? AND user_id=? AND version=? AND deleted_at IS NULL AND ${visible}`)
      .bind(value.action,body,now,value.action,now,value.id,entryId,userId,value.version,entryId).run();
    if (!result.meta.changes) throw new ApiError(409,"COMMENT_CONFLICT","본인이 작성한 최신 댓글만 수정하거나 삭제할 수 있어요. 댓글을 새로 확인해 주세요.");
  }
  return {ok:true};
}
