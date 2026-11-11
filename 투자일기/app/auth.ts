import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { getChatGPTUser } from './chatgpt-auth';

export type Member = { id: string; email: string; name: string };
type AuthEnv = { DB: D1Database; RESEND_API_KEY?: string; MAIL_FROM?: string };
export const authEnv = () => env as unknown as AuthEnv;
export const mailReady = () => Boolean(authEnv().RESEND_API_KEY && authEnv().MAIL_FROM);
export const opaqueToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join('');
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const hash = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export function equalHash(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i=0;i<Math.max(a.length,b.length);i++) difference |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return difference===0;
}
export async function currentUser(): Promise<Member|null> {
  const h = await headers();
  const token = (h.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('onki_session='))?.slice(13);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const row = await authEnv().DB.prepare('SELECT a.id,a.email FROM auth_sessions s JOIN auth_accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.verified_at IS NOT NULL').bind(await digest(token),new Date().toISOString()).first<{id:string;email:string}>();
    if (row) return {...row,name:row.email.split('@')[0]};
  }
  const platform = await getChatGPTUser();
  return platform ? {id:'gpt:'+platform.userId,email:platform.email,name:platform.displayName} : null;
}

export async function authRateLimit(request: Request, action: string, email: string) {
  const now = Date.now(); const window = 15*60*1000;
  for (const [type,value,limit] of [['ip',request.headers.get('cf-connecting-ip')||'local',60],['email',email||'anonymous',12]] as const) {
    if(type==='email'&&!email) continue;
    const key = await digest(action+':'+type+':'+value);
    const row = await authEnv().DB.prepare('INSERT INTO auth_rate_limits (key,hits,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window_start<? THEN 1 ELSE hits+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING hits').bind(key,now,now-window,now-window).first<{hits:number}>();
    if (row && row.hits>limit) throw new Error('요청이 많아요. 15분 뒤 다시 시도해 주세요.');
  }
}

export async function sendAuthMail(email: string, kind:'verify'|'reset', userId: string, origin: string) {
  if (!mailReady()) throw new Error('이메일 서비스 설정을 준비 중입니다. ChatGPT 로그인을 이용해 주세요.');
  const token=opaqueToken(), tokenHash=await digest(token), expires=new Date(Date.now()+(kind==='verify'?24*60:30)*60000).toISOString();
  await authEnv().DB.prepare('INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)').bind(tokenHash,userId,kind,expires).run();
  const link=origin+'/#auth='+kind+'&token='+token;
  try {
    const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+authEnv().RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:authEnv().MAIL_FROM,to:[email],subject:kind==='verify'?'온기 이메일 주소를 인증해 주세요':'온기 비밀번호 재설정',text:`온기 — 함께 쓰는 투자 일기\n\n${kind==='verify'?'이메일 인증':'비밀번호 재설정'}: ${link}\n\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.`})});
    if(!r.ok)throw new Error('MAIL_DELIVERY_FAILED');
  } catch {
    await authEnv().DB.prepare('DELETE FROM auth_tokens WHERE token_hash=?').bind(tokenHash).run();
    throw new Error('인증 메일을 발송하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
