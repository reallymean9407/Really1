import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const load=s=>import(`data:text/javascript;base64,${Buffer.from(compile(s)).toString('base64')}`);
globalThis.__communityEnv={};
globalThis.__communityUser={id:'member-a',email:'a@example.invalid',name:'A'};
globalThis.__communityValidation=await load(await readFile(new URL('../app/lib/server-validation.ts',import.meta.url),'utf8'));
globalThis.__communityModel=await load(await readFile(new URL('../app/lib/model.ts',import.meta.url),'utf8'));
const replacements=s=>s.replace('import { env } from "cloudflare:workers";','const env=globalThis.__communityEnv;').replace('import { currentUser } from "../auth";','const currentUser=async()=>globalThis.__communityUser;').replace(/import \{ ([^}]+) \} from "\.\/server-validation";/,'const { $1 }=globalThis.__communityValidation;').replace('export { ApiError, validDate } from "./server-validation";','export { ApiError, validDate };').replace(/import \{ EMOTIONS,[^}]+\} from "\.\/model";/,'const { EMOTIONS }=globalThis.__communityModel;');
const journal=await load(replacements(await readFile(new URL('../app/lib/server.ts',import.meta.url),'utf8')));
const community=await load(replacements(await readFile(new URL('../app/lib/community.ts',import.meta.url),'utf8')));
globalThis.__communityJournal=journal;
const imageRoute=await load((await readFile(new URL('../app/api/images/[id]/route.ts',import.meta.url),'utf8'))
  .replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/\.\.\/lib\/server";/,'const { $1 }=globalThis.__communityJournal;'));
const files=(await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort();
const sql=(await Promise.all(files.map(n=>readFile(new URL('../drizzle/'+n,import.meta.url),'utf8')))).join('\n');
class D1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');this.sqlite.exec(sql);}
 prepare(sql){const stmt=(params=[])=>({sql,params,bind:(...p)=>stmt(p),first:async()=>this.sqlite.prepare(sql).get(...params)??null,all:async()=>({results:this.sqlite.prepare(sql).all(...params)}),run:async()=>{const result=this.sqlite.prepare(sql).run(...params);return {...result,meta:{changes:Number(result.changes)}};}});return stmt();}
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=statements.map((s,i)=>{if(i===this.failAt){this.failAt=undefined;throw Error('rollback test');}return /^SELECT/.test(s.sql)?{results:this.sqlite.prepare(s.sql).all(...s.params)}:this.sqlite.prepare(s.sql).run(...s.params);});this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
let database;
beforeEach(()=>{database?.sqlite.close();database=new D1();globalThis.__communityEnv.DB=database;delete globalThis.__communityEnv.ADMIN_EMAILS;delete globalThis.__communityEnv.ADMIN_USER_IDS;user('a');});
const user=(id)=>globalThis.__communityUser=id?{id:'member-'+id,email:id+'@example.invalid',name:id}:null;
let n=0;
const mutate=(who='a',date='2026-11-08',data={},expectedVersion=0,operation='save')=>journal.mutateEntry('member-'+who,{operation,date,expectedVersion,requestId:'community-test-'+(++n),...(operation==='save'?{data:{body:'개인 판단',sentiment:'neutral',...data}}:operation==='patch'?{patch:data}:{})},'https://new.example');
const feed=(s='')=>community.communityFeed(new URLSearchParams(s));
const stats=(s='date=2026-11-08')=>community.sentimentStats(new URLSearchParams(s));
const code=c=>e=>e.code===c;

test('two users have independent private diaries and public DB views contain no private content',async()=>{
 const a=await mutate('a',undefined,{title:'개인 제목',body:'원본 민감 내용',cashRatio:73,trades:[{side:'buy',symbol:'PRIVATE'}]});
 assert.equal(a.entry.visibility,'private');assert.equal(a.entry.shareCash,false);
 assert.equal((await journal.listEntries('member-a')).length,1);assert.deepEqual(await journal.listEntries('member-b'),[]);
 user('b');assert.equal((await feed()).total,0);assert.equal((await stats()).selected.total,0);
 assert.equal(database.sqlite.prepare('SELECT count(*) n FROM community_post_projection').get().n,0);
 assert.equal(database.sqlite.prepare('SELECT count(*) n FROM community_sentiment_counts').get().n,0);
 assert.equal(await journal.ownerId(),'member-b');
});

test('public feed always hides cash while honoring existing consent for other fields',async()=>{
 const sensitive={cashRatio:55,emotion:'불안함',trades:[{side:'sell',symbol:'SECRET'}],fearGreed:{value:23,asOf:'2026-11-08',recordedAt:'2026-11-08T01:00:00Z',source:'manual',sourceUrl:'https://edition.cnn.com/markets/fear-and-greed'}};
 await mutate('a',undefined,{visibility:'public',title:'공개 기록',...sensitive});user('b');
 let post=(await feed()).posts[0];assert.equal(post.title,'공개 기록');assert.equal(post.cashRatio,null);assert.equal(post.emotion,null);assert.equal(post.fearGreed,null);assert.deepEqual(post.trades,[]);assert.equal(post.isMine,false);assert.deepEqual(post.images,[]);
 const view=database.sqlite.prepare('SELECT cash_ratio,trades_json,fear_greed_json FROM community_post_projection').get();assert.equal(view.cash_ratio,null);assert.equal(view.trades_json,'[]');assert.equal(view.fear_greed_json,null);
 await mutate('a',undefined,{shareCash:true,shareFearGreed:true,shareTrades:true,shareEmotion:true},1,'patch');
 post=(await feed()).posts[0];assert.equal(post.cashRatio,null);assert.equal((await journal.listEntries('member-a'))[0].cashRatio,55);assert.equal(post.emotion,'불안함');assert.equal(post.fearGreed.value,23);assert.equal(post.trades[0].symbol,'SECRET');
});

test('sentiment-only records contribute one vote per user/date without exposing title or body',async()=>{
 await mutate('a',undefined,{visibility:'sentiment',sentiment:'bearish',title:'노출 금지',body:'아무도 보지 못할 투자 내용'});
 await mutate('b',undefined,{visibility:'public',sentiment:'bullish'});
 assert.equal((await feed()).posts.length,1);let summary=(await stats()).selected;assert.equal(summary.total,2);assert.deepEqual(summary.dominant,['bearish','bullish']);assert.equal(summary.counts.length,5);assert.equal(summary.counts.find(x=>x.sentiment==='bearish').percent,50);
 await assert.rejects(mutate('a',undefined,{visibility:'public'}),code('VERSION_CONFLICT'));assert.equal((await stats()).selected.total,2);
 await mutate('a',undefined,{sentiment:'very-bullish'},1,'patch');summary=(await stats()).selected;assert.equal(summary.total,2);assert.equal(summary.counts.find(x=>x.sentiment==='bearish').count,0);assert.equal(summary.counts.find(x=>x.sentiment==='very-bullish').count,1);
});

test('visibility changes, deletes, and failed atomic saves keep feed, history, statistics consistent',async()=>{
 await mutate('a',undefined,{visibility:'public',sentiment:'bearish'});database.failAt=2;
 await assert.rejects(mutate('a',undefined,{visibility:'private',sentiment:'bullish'},1,'patch'),/rollback test/);
 assert.equal((await feed()).total,1);assert.equal((await stats()).selected.total,1);assert.equal((await journal.entryHistory('member-a','2026-11-08')).length,1);
 await mutate('a',undefined,{visibility:'private'},1,'patch');assert.equal((await feed()).total,0);assert.equal((await stats()).selected.total,0);
 await mutate('a',undefined,{visibility:'public'},2,'patch');assert.equal((await feed()).total,1);
 await mutate('a',undefined,{},3,'delete');assert.equal((await feed()).total,0);assert.equal((await stats()).selected.total,0);
 assert.equal((await journal.listTrashEntries('member-a')).length,1);
});

test('likes are idempotent, reversible, database unique, disallow self and private posts',async()=>{
 await mutate('a',undefined,{visibility:'public'});const post=(await feed()).posts[0];user('b');
 for(let i=0;i<3;i++)assert.deepEqual(await community.setLike('member-b',{postId:post.id,liked:true}),{liked:true,likes:1});
 assert.equal(database.sqlite.prepare('SELECT count(*) n FROM diary_likes').get().n,1);
 assert.equal((await feed()).posts[0].liked,true);
 await assert.rejects(community.setLike('member-a',{postId:post.id,liked:true}),code('SELF_LIKE_FORBIDDEN'));
 assert.deepEqual(await community.setLike('member-b',{postId:post.id,liked:false}),{liked:false,likes:0});
 assert.deepEqual(await community.setLike('member-b',{postId:post.id,liked:false}),{liked:false,likes:0});
 await mutate('a',undefined,{visibility:'private'},1,'patch');await assert.rejects(community.setLike('member-b',{postId:post.id,liked:true}),code('POST_NOT_FOUND'));
});

test('TOP10 ranks actual counts then publication time, filters date, removes private/deleted records',async()=>{
 await mutate('a',undefined,{visibility:'public',title:'earlier'});await mutate('b',undefined,{visibility:'public',title:'later'});await mutate('c','2026-11-07',{visibility:'public',title:'other day'});
 database.sqlite.prepare("UPDATE journal_entries SET entry_json=json_set(entry_json,'$.publishedAt',?) WHERE user_id=?").run('2026-11-08T01:00:00Z','member-a');
 database.sqlite.prepare("UPDATE journal_entries SET entry_json=json_set(entry_json,'$.publishedAt',?) WHERE user_id=?").run('2026-11-08T02:00:00Z','member-b');
 let posts=(await feed('sort=top&date=2026-11-08')).posts;assert.deepEqual(posts.map(x=>x.title),['later','earlier']);
 const earlier=posts[1];user('c');await community.setLike('member-c',{postId:earlier.id,liked:true});posts=(await feed('sort=top&date=2026-11-08')).posts;assert.equal(posts[0].title,'earlier');
 await mutate('a',undefined,{visibility:'private'},1,'patch');assert.deepEqual((await feed('sort=top&date=2026-11-08')).posts.map(x=>x.title),['later']);
});

test('profiles enforce normalized unique nicknames, safe image URLs and no client role grants',async()=>{
 let p=await community.getProfile();assert.match(p.profile.nickname,/온기_/);assert.equal(p.profile.isAdmin,false);
 await community.updateProfile('member-a',{nickname:'  Alpha  ',avatarUrl:'https://example.com/a.png',bio:'기록자'});user('b');
 await assert.rejects(community.updateProfile('member-b',{nickname:'alpha',avatarUrl:'',bio:''}),code('NICKNAME_TAKEN'));
 await assert.rejects(community.updateProfile('member-b',{nickname:'Bravo',avatarUrl:'javascript:alert(1)',bio:''}),code('INVALID_INPUT'));
 await assert.rejects(community.updateProfile('member-b',{nickname:'Bravo',avatarUrl:'',bio:'',isAdmin:true}),code('INVALID_INPUT'));
 p=await community.getProfile('member-a');assert.equal(p.profile.nickname,'Alpha');assert.equal('email' in p.profile,false);
});

test('only server-configured operators moderate and audit, hidden posts disappear from feed and mood',async()=>{
 await mutate('a',undefined,{visibility:'public',sentiment:'bearish'});const post=(await feed()).posts[0];user('b');
 await assert.rejects(community.moderate({postId:post.id,hidden:true,reason:'운영 정책'}),code('ADMIN_REQUIRED'));
 globalThis.__communityEnv.ADMIN_EMAILS='b@example.invalid';assert.equal((await community.getProfile()).profile.isAdmin,true);
 await community.moderate({postId:post.id,hidden:true,reason:'운영 정책'});assert.equal((await feed()).total,0);assert.equal((await stats()).selected.total,0);
 const adminFeed=await community.communityFeed(new URLSearchParams(),true);assert.equal(adminFeed.total,1);assert.equal(adminFeed.posts[0].hidden,true);assert.equal(adminFeed.posts[0].moderationReason,'운영 정책');
 assert.equal(database.sqlite.prepare('SELECT count(*) n FROM moderation_audit').get().n,1);
 await community.moderate({postId:post.id,hidden:false,reason:'검토 완료'});assert.equal((await feed()).total,1);assert.equal((await stats()).selected.total,1);
});

test('all five categories and zero-participation days persist across history and bounded custom periods',async()=>{
 const result=await stats('date=2026-11-08&days=90');assert.equal(result.history.length,90);assert.equal(result.history.at(-1).date,'2026-11-08');
 for(const day of result.history){assert.equal(day.total,0);assert.equal(day.counts.length,5);assert.deepEqual(day.dominant,[]);assert.equal(day.counts.reduce((n,c)=>n+c.percent,0),0);}
 assert.equal((await stats('date=2026-11-08&from=2026-11-01&to=2026-11-08')).history.length,8);
 await assert.rejects(stats('from=2025-01-01&to=2026-11-08'),code('INVALID_INPUT'));await assert.rejects(stats('days=8'),code('INVALID_INPUT'));
});

test('Korea midnight changes today and default TOP10 together without mutating historical records',async()=>{
 await mutate('a','2026-11-08',{visibility:'public',title:'Nov8'});await mutate('b','2026-11-09',{visibility:'public',title:'Nov9'});
 const RealDate=globalThis.Date;let stamp='2026-11-08T14:59:59.999Z';
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return RealDate.parse(stamp);}};
 try{assert.equal((await stats('')).today,'2026-11-08');assert.equal((await feed('sort=top')).posts[0].title,'Nov8');stamp='2026-11-08T15:00:00.000Z';assert.equal((await stats('')).today,'2026-11-09');assert.equal((await feed('sort=top')).posts[0].title,'Nov9');assert.equal((await stats('date=2026-11-08')).selected.total,1);}finally{globalThis.Date=RealDate;}
});

test('restoring an older public revision preserves current private scope and explicit sharing choices',async()=>{
 await mutate('a',undefined,{visibility:'public',shareCash:true,cashRatio:30});await mutate('a',undefined,{visibility:'private',shareCash:false},1,'patch');
 const result=await journal.mutateEntry('member-a',{operation:'restore',date:'2026-11-08',expectedVersion:2,revisionVersion:1,requestId:'restore-privacy-test'},'https://new.example');
 assert.equal(result.entry.visibility,'private');assert.equal(result.entry.shareCash,false);assert.equal((await feed()).total,0);assert.equal((await stats()).selected.total,0);
});


test('new mood cards reveal only mood and consented emotion across community and detail, with legacy votes preserved', async () => {
  const date = '2026-11-08';
  const privateFields = {
    title: '비공개 제목', body: '비공개 본문', insight: '비공개 인사이트',
    cashRatio: 81, trades: [{ side: 'buy', symbol: 'PRIVATE' }], emotion: '불안함',
  };
  const old = await mutate('a', date, { ...privateFields, visibility: 'sentiment', sentiment: 'bearish', shareEmotion: true });
  user('b');
  assert.equal((await feed()).total, 0);
  assert.equal((await stats()).selected.total, 1);
  async function saveMood(version, shareEmotion) {
    return journal.mutateEntry('member-a', {
      operation: 'save', date, expectedVersion: version, sharingVersion: 2,
      requestId: 'modern-mood-' + version,
      data: { ...privateFields, visibility: 'sentiment', sentiment: 'bearish', shareEmotion, shareCash: true, shareTrades: true },
    }, 'https://new.example');
  }
  const saved = await saveMood(old.entry.version, false);
  let post = (await feed()).posts[0];
  assert.equal(post.visibility, 'sentiment');
  assert.equal(post.sentiment, 'bearish');
  assert.equal(post.emotion, null);
  assert.equal((await feed('sort=top&date=' + date)).total, 0);
  assert.equal((await stats()).selected.total, 1);
  assert.deepEqual(await community.setLike('member-b', { postId: post.id, liked: true }), { liked: true, likes: 1 });
  await saveMood(saved.entry.version, true);
  post = (await feed(new URLSearchParams({ id: post.id }).toString())).posts[0];
  assert.equal(post.emotion, '불안함');
  assert.equal(post.liked, true);
  for (const key of ['title','body','insight','fearGreed','cashRatio','trades','images']) assert.equal(key in post, false);
  const view = database.sqlite.prepare('SELECT title,body,cash_ratio,fear_greed_json,trades_json FROM community_post_projection').get();
  assert.deepEqual({ ...view }, { title: null, body: null, cash_ratio: null, fear_greed_json: null, trades_json: '[]' });
  assert.equal((await journal.listEntries('member-a'))[0].body, privateFields.body);
});

test('new full-public saves publish entered CNN index but hide emotion and cash', async () => {
  const date = '2026-11-08';
  const fearGreed = { value: 0, asOf: date, recordedAt: date+'T01:00:00Z', source: 'manual', sourceUrl: 'https://edition.cnn.com/markets/fear-and-greed' };
  await mutate('a', date, { visibility: 'public', fearGreed });
  assert.equal((await feed()).posts[0].fearGreed, null);
  await journal.mutateEntry('member-a', {
    operation: 'save', date, expectedVersion: 1, requestId: 'modern-public-1', sharingVersion: 2,
    data: { visibility: 'public', title: '공개 글', body: '공개할 내용', fearGreed, emotion: '차분함', cashRatio: 60, shareEmotion: true, shareCash: true, shareFearGreed: false },
  }, 'https://new.example');
  const [post] = (await feed('sort=top&date='+date)).posts;
  assert.equal(post.visibility, 'public');
  assert.equal(post.fearGreed.value, 0);
  assert.equal(post.emotion, null);
  assert.equal(post.cashRatio, null);
  assert.equal((await journal.listEntries('member-a'))[0].cashRatio, 60);
});

const photoFixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4sWUBAARkAh2NzDMBAAAAAElFTkSuQmCC', 'base64');
const attachmentDate = '2026-11-08';
const saveWithPolicy = (who, expectedVersion, sharingVersion, data) => journal.mutateEntry('member-' + who, {
  operation: 'save',
  date: attachmentDate,
  expectedVersion,
  sharingVersion,
  requestId: 'new-policy-test-' + (++n),
  data: {body: '개인 기록', sentiment: 'neutral', ...data},
}, 'https://new.example');
const requestImage = (id, postId) => {
  const url = new URL('https://new.example/api/images/' + id);
  if (postId !== undefined) url.searchParams.set('postId', postId);
  return imageRoute.GET(new Request(url), {params: Promise.resolve({id})});
};

function setupImages() {
  const objects = new Map();
  const reads = [];
  globalThis.__communityEnv.BUCKET = {
    put: async (key, bytes) => {
      objects.set(key, new Uint8Array(bytes));
      return {key};
    },
    get: async (key) => {
      reads.push(key);
      const bytes = objects.get(key);
      return bytes ? {body: new Response(bytes).body} : null;
    },
  };
  return {
    reads,
    upload: (who) => journal.uploadImage('member-' + who, new Request('https://new.example/api/images?name=secret.png', {
      method: 'POST',
      headers: {'Content-Type': 'image/png'},
      body: photoFixture,
    })),
  };
}

test('the public route only serves attachments explicitly published on the current full-public entry', async () => {
  const {reads, upload} = setupImages();
  const oldImage = await upload('a');
  const draft = await upload('a');
  const foreign = await upload('b');
  await saveWithPolicy('a', 0, 2, {visibility: 'public', images: [oldImage]});
  const [legacy] = (await feed()).posts;
  assert.deepEqual(legacy.images, []);
  user(null);
  assert.equal((await requestImage(oldImage.id, legacy.id)).status, 404);
  assert.equal((await requestImage(oldImage.id)).status, 401);
  assert.equal(reads.length, 0);
  user('a');
  assert.equal((await requestImage(oldImage.id)).status, 200);
  assert.equal(reads.length, 1);

  await assert.rejects(saveWithPolicy('a', 1, 3, {visibility: 'public'}), code('INVALID_INPUT'));
  await assert.rejects(saveWithPolicy('a', 1, 3, {visibility: 'public', images: [foreign]}), code('INVALID_IMAGE'));
  await saveWithPolicy('a', 1, 3, {visibility: 'public', images: [oldImage]});
  await mutate('a', attachmentDate, {images: [oldImage, draft]}, 2, 'patch');
  const [post] = (await feed()).posts;
  assert.deepEqual(post.images, [{id: oldImage.id, name: '첨부 이미지 1', type: oldImage.type, size: oldImage.size}]);

  user(null);
  for (const [id, postId] of [
    [oldImage.id, 'member-b~' + attachmentDate],
    [oldImage.id, 'member-a~2026-11-07'],
    [draft.id, post.id],
    [foreign.id, post.id],
  ]) {
    const denied = await requestImage(id, postId);
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(reads.length, 1);
  const response = await requestImage(oldImage.id, post.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), photoFixture);

  await saveWithPolicy('a', 3, 3, {visibility: 'public', images: []});
  await journal.mutateEntry('member-a', {
    operation: 'restore',
    date: attachmentDate,
    expectedVersion: 4,
    revisionVersion: 2,
    requestId: 'restore-past-images',
  }, 'https://new.example');
  assert.equal((await journal.listEntries('member-a'))[0].images[0].id, oldImage.id);
  assert.deepEqual((await feed()).posts[0].images, []);
  assert.equal((await requestImage(oldImage.id, post.id)).status, 404);
  assert.equal(reads.length, 2);
});

test('hiding, reducing scope, and deleting an entry immediately revoke public image access', async () => {
  const {reads, upload} = setupImages();
  const photo = await upload('a');
  await saveWithPolicy('a', 0, 3, {visibility: 'public', images: [photo]});
  const post = (await feed()).posts[0];
  user('moderator');
  globalThis.__communityEnv.ADMIN_USER_IDS = 'member-moderator';
  await community.moderate({postId: post.id, hidden: true, reason: '테스트 숨김'});
  assert.equal((await requestImage(photo.id, post.id)).status, 404);
  assert.deepEqual((await community.communityFeed(new URLSearchParams(), true)).posts[0].images, []);
  await community.moderate({postId: post.id, hidden: false, reason: '숨김 해제'});
  user(null);
  assert.equal((await requestImage(photo.id, post.id)).status, 200);

  await saveWithPolicy('a', 1, 3, {visibility: 'sentiment', images: [photo]});
  assert.equal('images' in (await feed()).posts[0], false);
  assert.equal((await requestImage(photo.id, post.id)).status, 404);
  await saveWithPolicy('a', 2, 3, {visibility: 'private', images: [photo]});
  assert.equal((await requestImage(photo.id, post.id)).status, 404);
  await saveWithPolicy('a', 3, 3, {visibility: 'public', images: [photo]});
  await mutate('a', attachmentDate, {}, 4, 'delete');
  assert.equal((await requestImage(photo.id, post.id)).status, 404);
  assert.equal(reads.length, 1);
});

test('emotion statistics and filtering use only currently published shared values with legacy labels merged', async () => {
  const sharedMood = {visibility: 'sentiment', shareEmotion: true, emotion: '과열됨'};
  await saveWithPolicy('a', 0, 2, sharedMood);
  await saveWithPolicy('b', 0, 3, {...sharedMood, emotion: '흥분됨'});
  await mutate('c', attachmentDate, {visibility: 'public', shareEmotion: true, emotion: '차분함'});
  await saveWithPolicy('d', 0, 3, {visibility: 'public', images: [], shareEmotion: true, emotion: '기대감'});
  await mutate('e', attachmentDate, sharedMood); // Before mood-only consent could publish an individual card.
  await mutate('f', attachmentDate, {visibility: 'private', shareEmotion: true, emotion: '불안함'});
  await saveWithPolicy('g', 0, 3, {...sharedMood, shareEmotion: false, emotion: '망설임'});

  // Exercise existing rows written with the previous label before the validator was updated.
  database.sqlite.prepare("UPDATE journal_entries SET entry_json=json_set(entry_json,'$.emotion','과열됨') WHERE user_id='member-a'").run();
  database.sqlite.prepare("UPDATE journal_revisions SET entry_json=json_set(entry_json,'$.emotion','과열됨') WHERE user_id='member-a'").run();
  assert.equal((await journal.listEntries('member-a'))[0].emotion, '흥분됨');
  assert.equal((await journal.entryHistory('member-a', attachmentDate))[0].entry.emotion, '흥분됨');

  const report = await stats();
  assert.equal(report.selected.emotionTotal, 3);
  assert.deepEqual(report.selected.emotions.map(row => [row.emotion, row.count]), [
    ['차분함', 1], ['기대감', 0], ['망설임', 0], ['불안함', 0], ['흥분됨', 2],
  ]);
  assert.equal(report.selected.emotions.find(row => row.emotion === '흥분됨').percent, 2 / 3 * 100);
  assert.deepEqual(report.history.at(-1).emotions, report.selected.emotions);
  const legacyFilter = new URLSearchParams({emotion: '과열됨'}).toString();
  const currentFilter = new URLSearchParams({emotion: '흥분됨'}).toString();
  assert.deepEqual((await feed(legacyFilter)).posts, (await feed(currentFilter)).posts);
  const post = (await feed(currentFilter)).posts.find(candidate => candidate.author.id === 'member-a');
  assert.equal(post.emotion, '흥분됨');
  user('moderator');
  globalThis.__communityEnv.ADMIN_USER_IDS = 'member-moderator';
  await community.moderate({postId: post.id, hidden: true, reason: '테스트 숨김'});
  assert.equal((await stats()).selected.emotionTotal, 2);
  await mutate('b', attachmentDate, {}, 1, 'delete');
  assert.equal((await stats()).selected.emotionTotal, 1);
  assert.equal((await feed(currentFilter)).total, 0);
});

test('multiple same-day entries have independent edits, likes and bookmarks and one sentiment vote', async () => {
  const date = '2026-11-08';
  const write = (requestId, title, sentiment, emotion) => ({
    operation: 'create', date, expectedVersion: 0, sharingVersion: 4, requestId,
    data: {title, body: title, visibility: 'public', sentiment, emotion, images: [], shareEmotion: false},
  });
  const firstRequest = write('independent-first','첫 번째 일기','bullish','차분함');
  const first = (await journal.mutateEntry('member-a',firstRequest,'https://new.example')).entry;
  const second = (await journal.mutateEntry('member-a',write('independent-second','두 번째 일기','bearish','불안함'),'https://new.example')).entry;
  assert.notEqual(first.id,second.id);
  assert.equal((await journal.mutateEntry('member-a',firstRequest,'https://new.example')).entry.id,first.id);
  assert.equal((await journal.listEntries('member-a',date)).length,2);
  await journal.mutateEntry('member-a',{
    operation:'patch', entryId:first.id,date,expectedVersion:1,requestId:'independent-update',patch:{title:'첫 번째만 수정'},
  },'https://new.example');
  assert.equal((await journal.entryHistory('member-a','',first.id)).length,2);
  assert.equal((await journal.entryHistory('member-a','',second.id)).length,1);
  assert.equal((await stats()).selected.total,1);
  assert.equal((await stats()).selected.emotionTotal,1);
  user('b');
  await community.setLike('member-b',{postId:first.id,liked:true});
  await journal.setFavorite('member-b',{entryId:second.id,favorite:true});
  const byId = (await feed()).posts;
  assert.equal(byId.find(post=>post.id===first.id).likes,1);
  assert.equal(byId.find(post=>post.id===second.id).likes,0);
  assert.equal(byId.find(post=>post.id===second.id).emotion,'불안함');
  assert.deepEqual((await feed('bookmarked=true&others=true')).posts.map(post=>post.id),[second.id]);
  assert.equal((await journal.ownFavorites('member-b')).communityFavoriteCount,1);
  await journal.mutateEntry('member-a',{
    operation:'delete',entryId:second.id,date,expectedVersion:1,requestId:'independent-delete',
  },'https://new.example');
  assert.deepEqual((await journal.listEntries('member-a',date)).map(entry=>entry.id),[first.id]);
  assert.equal((await feed('bookmarked=true')).total,0);
});

test('ranking date ranges use calendar week, month and year', async () => {
  for (const [member,date] of [['a','2026-11-08'],['b','2026-11-09'],['c','2026-11-15'],['d','2026-11-16'],['e','2026-10-31'],['f','2025-11-09']]) {
    await mutate(member,date,{visibility:'public'});
  }
  const query = 'sort=top&date=2026-11-09';
  assert.equal((await feed(query)).total,1);
  const week = await feed(query+'&period=weekly');
  assert.deepEqual(week.range,{from:'2026-11-09',to:'2026-11-15'});
  assert.equal(week.total,2);
  assert.equal((await feed(query+'&period=monthly')).total,4);
  assert.equal((await feed(query+'&period=yearly')).total,5);
});

test('schema upgrade preserves existing diary, revisions, favorites, moderation and likes', async () => {
  const old = new DatabaseSync(':memory:');
  try {
    old.exec('PRAGMA foreign_keys=ON');
    const scripts = await Promise.all(files.map(name=>readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')));
    scripts.slice(0,8).forEach(script=>old.exec(script));
    const date = '2026-11-08';
    const json = JSON.stringify({title:'기존 기록',body:'기존 본문',visibility:'public',sentiment:'neutral'});
    old.prepare('INSERT INTO journal_entries(user_id,date,entry_json,version,last_attempt_id) VALUES (?,?,?,?,?)').run('member-a',date,json,2,'attempt');
    old.prepare('INSERT INTO journal_revisions VALUES (?,?,?,?,?)').run('member-a',date,2,date,json);
    old.prepare('INSERT INTO journal_favorites VALUES (?,?,?)').run('member-a',date,date);
    old.prepare('INSERT INTO diary_likes VALUES (?,?,?,?)').run('member-a',date,'member-b',date);
    old.prepare('INSERT INTO diary_moderation VALUES (?,?,?,?,?,?)').run('member-a',date,0,'기존 검토','operator',date);
    scripts.slice(8).forEach(script=>old.exec(script));
    const entry = old.prepare('SELECT entry_id,entry_json,version FROM journal_entries').get();
    assert.equal(entry.entry_json,json);
    assert.equal(entry.version,2);
    assert.match(entry.entry_id,/^legacy-/);
    for (const table of ['journal_revisions','journal_favorites','diary_likes','diary_moderation','community_post_projection']) {
      assert.equal(old.prepare(`SELECT entry_id FROM ${table}`).get().entry_id,entry.entry_id);
    }
    assert.equal(old.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {
    old.close();
  }
});


test('comments enforce author ownership, versions, visibility and locked settings',async()=>{
 const saved=await mutate('a',undefined,{visibility:'public'});
 const postId=saved.entry.id;
 const id=crypto.randomUUID();
 const params=new URLSearchParams({postId});
 user('b');
 await community.mutateComment('member-b',{action:'create',postId,id,body:'첫 댓글'});
 await community.mutateComment('member-b',{action:'create',postId,id,body:'첫 댓글'});
 let page=await community.listComments(params);
 assert.equal(page.total,1);assert.equal(page.comments[0].isMine,true);
 user('a');
 await assert.rejects(()=>community.mutateComment('member-a',{action:'edit',postId,id,body:'다른 작성자',version:1}),code('COMMENT_CONFLICT'));
 await assert.rejects(()=>mutate('a',undefined,{visibility:'public',commentsEnabled:false},1),code('COMMENTS_EXIST'));
 assert.equal((await journal.listEntries('member-a'))[0].commentCount,1);
 user('b');
 await community.mutateComment('member-b',{action:'edit',postId,id,body:'수정한 댓글',version:1});
 await assert.rejects(()=>community.mutateComment('member-b',{action:'edit',postId,id,body:'오래된 수정',version:1}),code('COMMENT_CONFLICT'));
 assert.equal((await community.listComments(params)).comments[0].body,'수정한 댓글');
 await community.mutateComment('member-b',{action:'delete',postId,id,version:2});
 assert.equal((await community.listComments(params)).total,0);
 await mutate('a',undefined,{visibility:'public',commentsEnabled:false},1);
 await assert.rejects(()=>community.mutateComment('member-b',{action:'create',postId,id:crypto.randomUUID(),body:'차단'}),code('COMMENTS_DISABLED'));
 await mutate('a',undefined,{visibility:'private'},2);
 await assert.rejects(()=>community.listComments(params),code('POST_NOT_FOUND'));
});

test('database trigger blocks stale disable after a comment arrives',async()=>{
 const saved=await mutate('a',undefined,{visibility:'public'});
 await community.mutateComment('member-b',{action:'create',postId:saved.entry.id,id:crypto.randomUUID(),body:'동시 작성'});
 assert.throws(()=>database.sqlite.prepare("UPDATE journal_entries SET entry_json=json_set(entry_json,'$.commentsEnabled',json('false')) WHERE entry_id=?").run(saved.entry.id),/COMMENTS_EXIST/);
});


test('a manually entered CNN index saves and publishes without a source date',async()=>{
 const fearGreed={value:33,source:'manual',sourceUrl:'https://edition.cnn.com/markets/fear-and-greed',recordedAt:'2026-11-11T12:00:00Z'};
 const saved=await mutate('a',undefined,{visibility:'public',shareFearGreed:true,fearGreed});
 assert.deepEqual(saved.entry.fearGreed,fearGreed);
 assert.deepEqual((await journal.listEntries('member-a'))[0].fearGreed,fearGreed);
 user('b');
 assert.deepEqual((await feed('id='+saved.entry.id)).posts[0].fearGreed,fearGreed);
});
