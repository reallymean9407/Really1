import { authEnv,authRateLimit,currentUser,digest,equalHash,mailReady,opaqueToken,passwordHash,sendAuthMail } from '../../auth';

export const dynamic='force-dynamic';
const response=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
type Account={id:string;email:string;password_hash:string;password_salt:string;verified_at:string|null};
const cookie=(value:string,request:Request,age:number)=>`onki_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function readInput(request:Request):Promise<string>{
  if(!request.body)throw new Error('빈 요청입니다.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new Error('AUTH_BODY_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function GET(){return response({user:await currentUser(),emailReady:mailReady()});}
export async function POST(request:Request){
  try {
    if (request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin) return response({error:'요청 출처를 확인해 주세요.'},403);
    if (Number(request.headers.get('content-length')||0)>4096) return response({error:'요청이 너무 큽니다.'},413);
    const raw=await readInput(request);
    const input=JSON.parse(raw) as Record<string,unknown>; const action=String(input.action||'');
    const db=authEnv().DB;
    if (action==='logout') {
      const token=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('onki_session='))?.slice(13);
      if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();
      return response({ok:true,redirect:'/signout-with-chatgpt?return_to=/'},200,{'Set-Cookie':cookie('',request,0)});
    }
    if(!mailReady())return response({error:'이메일 기능은 설정 준비 중입니다. ChatGPT 로그인을 이용해 주세요.'},503);
    if(!['signup','login','forgot','resend','verify','reset'].includes(action))return response({error:'지원하지 않는 요청입니다.'},400);
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    await authRateLimit(request,action,email);
    const now=new Date().toISOString(),origin=new URL(request.url).origin;
    if(action==='verify'||action==='reset') {
      const token=typeof input.token==='string'?input.token:'';
      if(!/^[a-f0-9]{64}$/.test(token))return response({error:'인증 링크가 올바르지 않습니다.'},400);
      const hash=await digest(token),kind=action==='verify'?'verify':'reset';
      const row=await db.prepare('SELECT user_id FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>?').bind(hash,kind,now).first<{user_id:string}>();
      if(!row)return response({error:'만료되었거나 이미 사용한 링크입니다.'},400);
      const valid='EXISTS (SELECT 1 FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>?)';
      let result;
      if(action==='verify')result=await db.batch([
        db.prepare('UPDATE auth_accounts SET verified_at=? WHERE id=? AND '+valid).bind(now,row.user_id,hash,kind,now),
        db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND kind=?').bind(row.user_id,kind),
      ]);
      else {
        const password=typeof input.password==='string'?input.password:'';
        if(password.length<12||password.length>128)return response({error:'비밀번호는 12~128자로 입력해 주세요.'},400);
        const salt=opaqueToken(),hashed=await passwordHash(password,salt);
        result=await db.batch([
          db.prepare('UPDATE auth_accounts SET password_hash=?,password_salt=?,verified_at=COALESCE(verified_at,?) WHERE id=? AND '+valid).bind(hashed,salt,now,row.user_id,hash,kind,now),
          db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND '+valid).bind(row.user_id,hash,kind,now),
          db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND kind=?').bind(row.user_id,kind),
        ]);
      }
      if(!result[0].meta.changes)return response({error:'이미 사용한 링크입니다.'},400);
      return response({ok:true,message:action==='verify'?'이메일 인증을 완료했습니다. 로그인해 주세요.':'비밀번호를 변경했습니다. 다시 로그인해 주세요.'});
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return response({error:'올바른 이메일 주소를 입력해 주세요.'},400);
    const account=await db.prepare('SELECT id,email,password_hash,password_salt,verified_at FROM auth_accounts WHERE email=?').bind(email).first<Account>();
    if(action==='forgot'||action==='resend') {
      if(account && (action==='forgot'||!account.verified_at))await sendAuthMail(email,action==='forgot'?'reset':'verify',account.id,origin);
      return response({ok:true,message:'등록된 이메일이라면 안내 메일을 보냈습니다. 메일함을 확인해 주세요.'});
    }
    const password=typeof input.password==='string'?input.password:'';
    if(password.length<12||password.length>128)return response({error:'비밀번호는 12~128자로 입력해 주세요.'},400);
    if(action==='signup') {
      if(!account) {
        const id='email:'+crypto.randomUUID(),salt=opaqueToken(),hashed=await passwordHash(password,salt);
        await db.prepare('INSERT INTO auth_accounts(id,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(id,email,hashed,salt,now).run();
        const created=await db.prepare('SELECT id FROM auth_accounts WHERE id=?').bind(id).first<{id:string}>();
        if(created)await sendAuthMail(email,'verify',id,origin);
      }
      return response({ok:true,message:'가입 가능한 이메일이라면 인증 메일을 보냈습니다. 인증 후 로그인해 주세요.'});
    }
    const hashed=await passwordHash(password,account?.password_salt||'onki-missing-user-timing-salt');
    if(!account||!equalHash(hashed,account.password_hash))return response({error:'이메일 또는 비밀번호를 확인해 주세요.'},401);
    if(!account.verified_at)return response({error:'이메일 인증 후 로그인할 수 있습니다. 인증 메일을 다시 받아 주세요.'},403);
    const token=opaqueToken(),expires=new Date(Date.now()+7*86400000).toISOString();
    await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token),account.id,expires).run();
    return response({ok:true},200,{'Set-Cookie':cookie(token,request,7*86400)});
  } catch(error) {
    if(error instanceof Error&&error.message==='AUTH_BODY_TOO_LARGE')return response({error:'요청이 너무 큽니다.'},413);
    console.error('Authentication request failed');
    const message=error instanceof Error && /요청이 많|메일|이메일 서비스/.test(error.message)?error.message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return response({error:message},message.includes('요청이 많')?429:400);
  }
}
