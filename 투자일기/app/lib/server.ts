import { env } from "cloudflare:workers";
import { currentUser } from "../auth";
import type { Diary, DiaryImage } from "./model";
import { ApiError, computeEntry, MAX_IMAGE_BYTES, normalizeEmotion, legacyEntryId, resolvePostId, validEntryId, validateMutation, validateUploadBytes, validDate, validImageId, validImageName } from "./server-validation";

export { ApiError, validDate } from "./server-validation";

export const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: noStore }); }

export async function ownerId(): Promise<string> {
  const user = await currentUser();
  if (!user?.id) throw new ApiError(401, "SIGN_IN_REQUIRED", "로그인한 후 이용해 주세요.");
  return user.id;
}

export function database(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new ApiError(503, "STORAGE_UNAVAILABLE", "저장소 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  return db;
}

function imageBucket(): R2Bucket {
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) throw new ApiError(503, "IMAGE_STORAGE_UNAVAILABLE", "이미지 저장소 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  return bucket;
}

async function boundedImageBytes(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "이미지 한 장은 최대 5MB까지 업로드할 수 있습니다.");
  if (!request.body) throw new ApiError(400, "EMPTY_IMAGE", "빈 이미지는 업로드할 수 없습니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "IMAGE_TOO_LARGE", "이미지 한 장은 최대 5MB까지 업로드할 수 있습니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function uploadImage(userId: string, request: Request): Promise<DiaryImage> {
  const declaredType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const db = database();
  const bucket = imageBucket();
  const bytes = await boundedImageBytes(request);
  const type = validateUploadBytes(bytes, declaredType);
  const image: DiaryImage = { id: crypto.randomUUID(), name: validImageName(new URL(request.url).searchParams.get("name")), type, size: bytes.byteLength };
  const objectKey = `journal-images/${image.id}`;
  try {
    const stored = await bucket.put(objectKey, bytes, { httpMetadata: { contentType: type, cacheControl: "private, no-store" } });
    if (!stored) throw new ApiError(503, "IMAGE_STORAGE_ERROR", "이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    await db.prepare("INSERT INTO journal_images (id, user_id, object_key, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(image.id, userId, objectKey, image.name, type, image.size, new Date().toISOString()).run();
  } catch (error) {
    // This unique upload key is never shared with existing diary revisions.
    try { await bucket.delete(objectKey); }
    catch { console.error("Journal image upload compensation failed"); }
    throw error;
  }
  return image;
}

type ImageRow = DiaryImage & { object_key: string };
async function ownedImage(userId: string, id: string): Promise<ImageRow | null> {
  return database().prepare("SELECT id, name, type, size, object_key FROM journal_images WHERE id = ? AND user_id = ?").bind(id, userId).first<ImageRow>();
}

async function serveImage(image: Pick<ImageRow, "type" | "size" | "object_key"> | null): Promise<Response> {
  if (!image) throw new ApiError(404, "IMAGE_NOT_FOUND", "이미지를 찾지 못했습니다.");
  const object = await imageBucket().get(image.object_key);
  if (!object) throw new ApiError(404, "IMAGE_NOT_FOUND", "이미지를 찾지 못했습니다.");
  return new Response(object.body, { headers: { ...noStore, "Content-Type": image.type, "Content-Length": String(image.size), "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" } });
}

export async function imageResponse(userId: string, rawId: string): Promise<Response> {
  return serveImage(await ownedImage(userId, validImageId(rawId)));
}

export async function publicImageResponse(rawId: string, postId: string): Promise<Response> {
  const id = validImageId(rawId);
  const entryId = resolvePostId(postId);
  const image = await database().prepare(`SELECT i.type,i.size,i.object_key
    FROM community_public_images p JOIN journal_images i ON i.id=p.id AND i.user_id=p.author_id
    WHERE p.entry_id=? AND p.id=?`)
    .bind(entryId, id).first<Pick<ImageRow, "type" | "size" | "object_key">>();
  return serveImage(image);
}

async function normalizeImages(userId: string, images: DiaryImage[]): Promise<DiaryImage[]> {
  return Promise.all(images.map(async ({ id }) => {
    const image = await ownedImage(userId, id);
    if (!image) throw new ApiError(400, "INVALID_IMAGE", "첨부 이미지를 찾지 못했습니다. 본인이 업로드한 이미지인지 확인해 주세요.");
    return { id: image.id, name: image.name, type: image.type, size: image.size };
  }));
}

export async function boundedJson(request: Request): Promise<unknown> {
  const limit = 100 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new ApiError(413, "BODY_TOO_LARGE", "요청은 100KB 이하여야 합니다.");
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "JSON 본문이 필요합니다.");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "요청은 100KB 이하여야 합니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요."); }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "ORIGIN_FORBIDDEN", "이 사이트에서 다시 요청해 주세요.");
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  console.error("Journal operation failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: "저장소 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "STORAGE_ERROR" }, 503);
}

function parseEntry(raw: string, entryId?: string): Diary {
  const entry = JSON.parse(raw) as Diary;
  if (entryId) entry.id = entryId;
  entry.emotion = normalizeEmotion(entry.emotion);
  return entry;
}

async function findEntries(userId: string, date: string | undefined, deleted: boolean | null): Promise<Diary[]> {
  const db = database();
  const filter = deleted === null ? "" : ` AND deleted_at IS ${deleted ? "NOT " : ""}NULL`;
  const statement = date
    ? db.prepare(`SELECT entry_json, entry_id, (SELECT count(*) FROM diary_comments c WHERE c.entry_id=journal_entries.entry_id AND c.deleted_at IS NULL) AS comment_count FROM journal_entries WHERE user_id = ? AND date = ?${filter} ORDER BY date DESC, json_extract(entry_json, '$.createdAt') DESC, entry_id DESC`).bind(userId, validDate(date))
    : db.prepare(`SELECT entry_json, entry_id, (SELECT count(*) FROM diary_comments c WHERE c.entry_id=journal_entries.entry_id AND c.deleted_at IS NULL) AS comment_count FROM journal_entries WHERE user_id = ?${filter} ORDER BY date DESC, json_extract(entry_json, '$.createdAt') DESC, entry_id DESC`).bind(userId);
  const rows = await statement.all<{ entry_json: string; entry_id: string; comment_count:number }>();
  return rows.results.map((row) => ({...parseEntry(row.entry_json,row.entry_id),commentCount:row.comment_count}));
}

export async function listEntries(userId: string, date?: string): Promise<Diary[]> {
  return findEntries(userId, date, false);
}

export async function listTrashEntries(userId: string, date?: string): Promise<Diary[]> {
  return findEntries(userId, date, true);
}

export async function trashCount(userId: string): Promise<number> {
  const row = await database().prepare("SELECT count(*) AS count FROM journal_entries WHERE user_id = ? AND deleted_at IS NOT NULL").bind(userId).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function ownFavorites(userId: string) {
  const db = database();
  const rows = await db.prepare(`SELECT e.entry_id, e.date FROM journal_favorites f
    JOIN journal_entries e ON e.entry_id=f.entry_id
    WHERE f.user_id=? AND e.user_id=? AND e.deleted_at IS NULL ORDER BY e.date DESC`)
    .bind(userId,userId).all<{ entry_id: string; date: string }>();
  const shared = await db.prepare(`SELECT count(*) AS count FROM journal_favorites f
    JOIN community_post_projection p ON p.entry_id=f.entry_id
    WHERE f.user_id=? AND p.author_id<>? AND p.hidden=0`).bind(userId,userId).first<{count:number}>();
  return {
    communityFavoriteCount: shared?.count ?? 0,
    favoriteIds: rows.results.map(row => row.entry_id),
    favoriteDates: [...new Set(rows.results.map(row => row.date))],
  };
}

export async function favoriteDates(userId: string) {
  return (await ownFavorites(userId)).favoriteDates;
}

export async function setFavorite(userId: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "INVALID_INPUT", "즐겨찾기 입력 형식을 확인해 주세요.");
  const payload = raw as Record<string, unknown>;
  const modern = "entryId" in payload;
  if (Object.keys(payload).length !== 2 || typeof payload.favorite !== "boolean" || (modern && "date" in payload)) {
    throw new ApiError(400, "INVALID_INPUT", "즐겨찾기 입력 형식을 확인해 주세요.");
  }
  const entryId = modern ? resolvePostId(payload.entryId) : legacyEntryId(userId, validDate(payload.date));
  const favorite = payload.favorite;
  const db = database();
  const visible = `SELECT e.entry_id,e.date FROM journal_entries e
    WHERE e.entry_id=? AND e.deleted_at IS NULL AND (e.user_id=? OR EXISTS (
      SELECT 1 FROM community_post_projection p WHERE p.entry_id=e.entry_id AND p.hidden=0
    ))`;
  const write = favorite
    ? db.prepare(`INSERT INTO journal_favorites (user_id,entry_id,date,created_at)
        SELECT ?,v.entry_id,v.date,? FROM (${visible}) v WHERE 1 ON CONFLICT(user_id,entry_id) DO NOTHING`)
        .bind(userId,new Date().toISOString(),entryId,userId)
    : db.prepare(`DELETE FROM journal_favorites WHERE user_id=? AND entry_id=? AND EXISTS (${visible})`)
        .bind(userId,entryId,entryId,userId);
  const [, active] = await db.batch<{ date: string }>([write, db.prepare(visible).bind(entryId,userId)]);
  const entry = active.results[0];
  if (!entry) throw new ApiError(404, "ENTRY_NOT_FOUND", "즐겨찾기를 변경할 일기를 찾지 못했습니다. 휴지통의 일기는 먼저 복원해 주세요.");
  return { ...(modern ? { entryId } : {}), date: entry.date, favorite };
}

export async function connectionState(userId: string) {
  const row = await database().prepare("SELECT last_mcp_at FROM journal_connections WHERE user_id = ?").bind(userId).first<{ last_mcp_at: string }>();
  return row ? { status: "connected" as const, lastUsedAt: row.last_mcp_at } : { status: "required" as const };
}

export async function recordMcpUse(userId: string) {
  await database().prepare("INSERT INTO journal_connections (user_id, last_mcp_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_mcp_at = excluded.last_mcp_at").bind(userId, new Date().toISOString()).run();
}

export async function entryHistory(userId: string, rawDate: string, requestedId?: string) {
  const entryId = requestedId ? validEntryId(requestedId) : legacyEntryId(userId,validDate(rawDate));
  const rows = await database().prepare("SELECT version, saved_at, entry_json FROM journal_revisions WHERE user_id = ? AND entry_id = ? ORDER BY version DESC")
    .bind(userId,entryId).all<{ version: number; saved_at: string; entry_json: string }>();
  return rows.results.map(row => ({ version: row.version, savedAt: row.saved_at, entry: parseEntry(row.entry_json,entryId) }));
}

type SavedResult = { entry: Diary; action: string; url: string; replayed?: boolean };
type MutationRow = { payload_hash: string; result_json: string | null };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function replay(db: D1Database, userId: string, row: MutationRow, payloadHash: string): Promise<SavedResult> {
  if (row.payload_hash !== payloadHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 ID에 다른 내용이 전달되었습니다. 새 요청 ID를 사용해 주세요.");
  if (!row.result_json) throw new ApiError(409, "REQUEST_IN_PROGRESS", "같은 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.");
  const result = JSON.parse(row.result_json) as SavedResult;
  result.entry.emotion = normalizeEmotion(result.entry.emotion);
  result.entry.id ??= legacyEntryId(userId,result.entry.date);
  const current = await db.prepare("SELECT version FROM journal_entries WHERE user_id = ? AND entry_id = ?").bind(userId, result.entry.id).first<{ version: number }>();
  if (current?.version !== result.entry.version) throw new ApiError(409, "VERSION_CONFLICT", "이 요청 이후 일기가 변경되었습니다. 최신 기록을 다시 불러와 주세요.");
  return { ...result, replayed: true };
}

export async function mutateEntry(userId: string, raw: unknown, origin: string): Promise<SavedResult> {
  const mutation = validateMutation(raw);
  const db = database();
  const payloadHash = await hash(mutation);
  const getRequest = () => db.prepare("SELECT payload_hash, result_json FROM journal_mutations WHERE user_id = ? AND request_id = ?").bind(userId, mutation.requestId).first<MutationRow>();
  const previous = await getRequest();
  if (previous) return replay(db, userId, previous, payloadHash);

  const entryId = mutation.operation === "create" ? crypto.randomUUID()
    : mutation.entryId ?? legacyEntryId(userId,mutation.date);
  // Tombstones still occupy their ID so a stale save cannot recreate a deleted diary.
  const existing = mutation.operation === "create" ? null : await db.prepare(
    "SELECT entry_json FROM journal_entries WHERE user_id = ? AND entry_id = ? AND date = ?",
  ).bind(userId,entryId,mutation.date).all<{entry_json: string}>();
  const current = existing?.results[0] ? parseEntry(existing.results[0].entry_json,entryId) : null;
  if (current?.deletedAt && mutation.operation !== "undelete") throw new ApiError(409, "ENTRY_IN_TRASH", "휴지통에 있는 일기입니다. 먼저 휴지통에서 복원한 후 수정해 주세요.");
  if ((current?.version ?? 0) !== mutation.expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "다른 곳에서 일기가 변경되었습니다. 최신 기록을 다시 불러온 후 저장해 주세요.");
  let restored: Diary | null = null;
  if (mutation.operation === "restore") {
    const revision = await db.prepare("SELECT entry_json FROM journal_revisions WHERE user_id = ? AND entry_id = ? AND version = ?").bind(userId, entryId, mutation.revisionVersion!).first<{ entry_json: string }>();
    restored = revision ? parseEntry(revision.entry_json) : null;
  }
  const now = new Date().toISOString();
  const entry = computeEntry(mutation, current ?? null, restored, now);
  entry.id = entryId;
  // Do not mutate the hashed request: only the persisted snapshot uses trusted metadata.
  entry.images = await normalizeImages(userId, entry.images ?? []);
  const attemptId = crypto.randomUUID();
  const action = mutation.operation === "create" ? "created" : mutation.operation === "save" ? (current ? "updated" : "created") : mutation.operation === "append" ? "appended" : mutation.operation === "restore" ? "restored" : mutation.operation === "delete" ? "deleted" : mutation.operation === "undelete" ? "undeleted" : "patched";
  const result: SavedResult = { entry, action, url: `${origin}/?date=${encodeURIComponent(entry.date)}#diary-${encodeURIComponent(entryId)}` };
  const entryJson = JSON.stringify(entry);
  const statements: D1PreparedStatement[] = [
    // A per-execution reservation prevents a reused key from mutating a second date.
    db.prepare("INSERT INTO journal_mutations (user_id, request_id, payload_hash, attempt_id, result_json, created_at) VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(user_id, request_id) DO NOTHING").bind(userId, mutation.requestId, payloadHash, attemptId, now),
  ];
  if (mutation.expectedVersion === 0) {
    statements.push(db.prepare("INSERT INTO journal_entries (entry_id, user_id, date, entry_json, version, last_attempt_id, deleted_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM journal_mutations WHERE user_id = ? AND request_id = ? AND attempt_id = ?) ON CONFLICT(entry_id) DO NOTHING").bind(entryId, userId, mutation.date, entryJson, entry.version, attemptId, entry.deletedAt ?? null, userId, mutation.requestId, attemptId));
  } else {
    statements.push(db.prepare("UPDATE journal_entries SET entry_json = ?, version = ?, last_attempt_id = ?, deleted_at = ? WHERE user_id = ? AND entry_id = ? AND version = ? AND EXISTS (SELECT 1 FROM journal_mutations WHERE user_id = ? AND request_id = ? AND attempt_id = ?)").bind(entryJson, entry.version, attemptId, entry.deletedAt ?? null, userId, entryId, mutation.expectedVersion, userId, mutation.requestId, attemptId));
  }
  statements.push(
    db.prepare("INSERT INTO journal_revisions (entry_id, user_id, date, version, saved_at, entry_json) SELECT entry_id, user_id, date, version, ?, entry_json FROM journal_entries WHERE user_id = ? AND entry_id = ? AND last_attempt_id = ?").bind(now, userId, entryId, attemptId),
    db.prepare("UPDATE journal_mutations SET result_json = ? WHERE user_id = ? AND request_id = ? AND attempt_id = ? AND EXISTS (SELECT 1 FROM journal_entries WHERE user_id = ? AND entry_id = ? AND last_attempt_id = ?)").bind(JSON.stringify(result), userId, mutation.requestId, attemptId, userId, entryId, attemptId),
    // Failed CAS leaves no consumed key, partial revision, or uncommitted reservation.
    db.prepare("DELETE FROM journal_mutations WHERE user_id = ? AND request_id = ? AND attempt_id = ? AND result_json IS NULL").bind(userId, mutation.requestId, attemptId),
  );
  try { await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && error.message.includes("COMMENTS_EXIST")) throw new ApiError(409,"COMMENTS_EXIST","댓글이 달린 일기는 댓글 기능을 비활성화할 수 없습니다. 최신 일기를 다시 열어 주세요.");
    throw error;
  }
  const committed = await getRequest();
  if (!committed) throw new ApiError(409, "VERSION_CONFLICT", "다른 곳에서 일기가 변경되었습니다. 최신 기록을 다시 불러온 후 저장해 주세요.");
  if (committed.payload_hash !== payloadHash) return replay(db, userId, committed, payloadHash);
  const own = await db.prepare("SELECT attempt_id FROM journal_mutations WHERE user_id = ? AND request_id = ?").bind(userId, mutation.requestId).first<{ attempt_id: string }>();
  if (own?.attempt_id !== attemptId) return replay(db, userId, committed, payloadHash);
  return JSON.parse(committed.result_json!) as SavedResult;
}
