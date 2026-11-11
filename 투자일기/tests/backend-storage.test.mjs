import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

// Execute production server logic and generated migrations against SQLite.
// Only platform identity/D1 imports are replaced with a local test adapter.
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const load = (source) => import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
globalThis.__journalTestEnv = {};
globalThis.__journalTestUser = { userId: "owner-a", email: "test@example.invalid" };
globalThis.__journalValidation = await load(await readFile(new URL("../app/lib/server-validation.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../app/lib/server.ts", import.meta.url), "utf8"))
  .replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__journalTestEnv;')
  .replace('import { currentUser } from "../auth";', 'const currentUser = async () => globalThis.__journalTestUser ? ({...globalThis.__journalTestUser,id:globalThis.__journalTestUser.userId}) : null;')
  .replace(/import \{ ([^}]+) \} from "\.\/server-validation";/, "const { $1 } = globalThis.__journalValidation;")
  .replace('export { ApiError, validDate } from "./server-validation";', 'export { ApiError, validDate };');
const api = await load(source);
globalThis.__journalApi = api;
const entriesSource = (await readFile(new URL("../app/api/entries/route.ts", import.meta.url), "utf8"))
  .replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/lib\/server";/, "const { $1 } = globalThis.__journalApi;");
const entriesRoute = await load(entriesSource);
const favoritesSource = (await readFile(new URL("../app/api/favorites/route.ts", import.meta.url), "utf8"))
  .replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/lib\/server";/, "const { $1 } = globalThis.__journalApi;");
const favoritesRoute = await load(favoritesSource);
const imageUploadSource = (await readFile(new URL("../app/api/images/route.ts", import.meta.url), "utf8"))
  .replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/lib\/server";/, "const { $1 } = globalThis.__journalApi;");
const imageUploadRoute = await load(imageUploadSource);
const imageReadSource = (await readFile(new URL("../app/api/images/[id]/route.ts", import.meta.url), "utf8"))
  .replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/\.\.\/lib\/server";/, "const { $1 } = globalThis.__journalApi;");
const imageReadRoute = await load(imageReadSource);
const migrations = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
assert.ok(migrations.length, "Generate schema migrations before running storage tests");
const migrationSql = (await Promise.all(migrations.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec(migrationSql); }
  barrier(count) {
    let arrivals = 0;
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    this.readBarrier = async () => { if (++arrivals === count) { this.readBarrier = undefined; release(); } await wait; };
  }
  prepare(sql) {
    const statement = (params = []) => {
      return {
        sql, params,
        bind(...next) { return statement(next); },
        first: async () => this.sqlite.prepare(sql).get(...params) ?? null,
        all: async () => {
          const results = this.sqlite.prepare(sql).all(...params);
          if (sql.startsWith("SELECT entry_json FROM journal_entries") && this.readBarrier) await this.readBarrier();
          return { results, success: true };
        },
        run: async () => {
          if (this.failNextRunPrefix && sql.startsWith(this.failNextRunPrefix)) { this.failNextRunPrefix = undefined; throw new Error("Simulated metadata failure"); }
          return this.sqlite.prepare(sql).run(...params);
        },
      };
    };
    return statement();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN TRANSACTION");
    try {
      const result = statements.map((statement, index) => {
        if (index === this.failOnBatchIndex) { this.failOnBatchIndex = undefined; throw new Error("Simulated write failure"); }
        if (statement.sql.startsWith("SELECT ")) return { results: this.sqlite.prepare(statement.sql).all(...statement.params), success: true };
        return this.sqlite.prepare(statement.sql).run(...statement.params);
      });
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  count(table) { return this.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n; }
}
class LocalR2 {
  objects = new Map();
  puts = [];
  gets = [];
  deletes = [];
  async put(key, bytes, options) {
    this.puts.push(key);
    if (this.failPut) throw new Error("Simulated R2 failure");
    this.objects.set(key, { bytes: new Uint8Array(bytes), options });
    return { key, size: bytes.byteLength };
  }
  async get(key) {
    this.gets.push(key);
    const object = this.objects.get(key);
    return object ? { body: new Response(object.bytes).body } : null;
  }
  async delete(key) { this.deletes.push(key); this.objects.delete(key); }
}
let db;
let bucket;
beforeEach(() => {
  db?.sqlite.close();
  db = new LocalD1();
  bucket = new LocalR2();
  globalThis.__journalTestEnv.DB = db;
  globalThis.__journalTestEnv.BUCKET = bucket;
  globalThis.__journalTestUser = { userId: "owner-a", email: "test@example.invalid" };
});
const origin = "https://journal.example";
const save = (requestId = "save-00001", date = "2026-10-22", expectedVersion = 0, body = "원문") => ({ operation: "save", date, expectedVersion, requestId, data: { body } });
const mutate = (payload, userId = "owner-a") => api.mutateEntry(userId, payload, origin);
const code = (expected) => (error) => error.code === expected;
const move = (operation, expectedVersion, requestId = `${operation}-0001`, date = "2026-10-22") => ({ operation, date, expectedVersion, requestId });

test("same date is unique per user and different users have isolated entries/history", async () => {
  await mutate(save());
  await mutate(save("save-00001", "2026-10-22", 0, "다른 사용자"), "owner-b");
  assert.equal((await api.listEntries("owner-a"))[0].body, "원문");
  assert.equal((await api.listEntries("owner-b"))[0].body, "다른 사용자");
  assert.equal((await api.entryHistory("owner-a", "2026-10-22")).length, 1);
  assert.deepEqual(await api.listEntries("owner-c"), []);
  assert.deepEqual(await api.entryHistory("owner-c", "2026-10-22"), []);
  await assert.rejects(mutate(save("save-00002")), code("VERSION_CONFLICT"));
  assert.equal(db.count("journal_entries"), 2);
});

test("append retries replay the original success without duplicate text or history", async () => {
  await mutate(save());
  const payload = { operation: "append", date: "2026-10-22", expectedVersion: 1, requestId: "append-0001", content: "추가" };
  const first = await mutate(payload);
  const second = await mutate(payload);
  assert.equal(first.entry.body, "원문\n\n추가");
  assert.equal(second.replayed, true);
  assert.equal(second.entry.version, 2);
  assert.equal((await api.listEntries("owner-a"))[0].body, "원문\n\n추가");
  assert.equal(db.count("journal_revisions"), 2);
});

test("two simultaneous writers that read the same version yield one 409 and preserve the winner", async () => {
  await mutate(save());
  db.barrier(2);
  const writes = await Promise.allSettled([mutate(save("writer-0001", "2026-10-22", 1, "첫 번째")), mutate(save("writer-0002", "2026-10-22", 1, "두 번째"))]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.find((result) => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  const winner = writes.find((result) => result.status === "fulfilled").value.entry;
  assert.equal((await api.listEntries("owner-a"))[0].body, winner.body);
  assert.equal(db.count("journal_revisions"), 2);
  assert.equal(db.count("journal_mutations"), 2);
});

test("simultaneous identical key retries commit once", async () => {
  db.barrier(2);
  const writes = await Promise.all([mutate(save()), mutate(save())]);
  assert.equal(writes.filter((result) => result.replayed).length, 1);
  assert.equal(db.count("journal_entries"), 1);
  assert.equal(db.count("journal_revisions"), 1);
  assert.equal(db.count("journal_mutations"), 1);
});

test("simultaneous changed payload with the same key cannot create a second date", async () => {
  db.barrier(2);
  const writes = await Promise.allSettled([mutate(save()), mutate(save("save-00001", "2026-10-21", 0, "다른 내용"))]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.find((result) => result.status === "rejected").reason.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(db.count("journal_entries"), 1);
  assert.equal(db.count("journal_revisions"), 1);
  assert.equal(db.count("journal_mutations"), 1);
});

test("an error after the entry write rolls back entry, revision and request reservation", async () => {
  db.failOnBatchIndex = 2;
  await assert.rejects(mutate(save()), /Simulated write failure/);
  assert.equal(db.count("journal_entries"), 0);
  assert.equal(db.count("journal_revisions"), 0);
  assert.equal(db.count("journal_mutations"), 0);
  assert.equal((await mutate(save())).entry.version, 1);
});

test("restore adds a revision and stale/changed-key requests never overwrite content", async () => {
  await mutate(save());
  await mutate(save("save-00002", "2026-10-22", 1, "새 본문"));
  const restored = await mutate({ operation: "restore", date: "2026-10-22", expectedVersion: 2, requestId: "restore-0001", revisionVersion: 1 });
  assert.equal(restored.entry.body, "원문");
  assert.equal(restored.entry.version, 3);
  await assert.rejects(mutate(save("save-00003", "2026-10-22", 2, "낡은 버전")), code("VERSION_CONFLICT"));
  await assert.rejects(mutate(save("save-00001", "2026-10-22", 0, "변조한 재시도")), code("IDEMPOTENCY_CONFLICT"));
  assert.equal(db.count("journal_revisions"), 3);
  assert.equal((await api.listEntries("owner-a"))[0].body, "원문");
});


test("request parsing enforces 100KB for streams, rejects malformed JSON and preserves useful errors", async () => {
  await assert.rejects(api.boundedJson(new Request(`${origin}/api/entries`, { method: "POST", body: "a".repeat(100 * 1024 + 1) })), code("BODY_TOO_LARGE"));
  await assert.rejects(api.boundedJson(new Request(`${origin}/api/entries`, { method: "POST", body: "{" })), code("INVALID_JSON"));
  const { ApiError } = globalThis.__journalValidation;
  const response = api.errorResponse(new ApiError(409, "VERSION_CONFLICT", "다시 확인"));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
});





test("soft deletion hides an owner's diary, keeps fields/history intact, and restore adds a new version", async () => {
  const optional = {
    title: "현금의 의미", body: "오래 보관할 생각", sentiment: null, emotion: null, cashRatio: 0,
    trades: [{ side: "buy", symbol: "AAPL", note: "이유" }, { side: "sell", symbol: "삼성전자" }],
    fearGreed: { value: 12, asOf: "2026-10-22T16:00:00+09:00", recordedAt: "2026-10-22T09:00:00.000Z", source: "manual", sourceUrl: "https://edition.cnn.com/markets/fear-and-greed" },
  };
  const original = (await mutate({ ...save(), data: optional })).entry;
  await mutate(save("owner-b-save", "2026-10-22", 0, "다른 사용자"), "owner-b");
  const deleted = await mutate(move("delete", 1));
  assert.equal(deleted.action, "deleted");
  assert.equal(deleted.entry.version, 2);
  assert.ok(deleted.entry.deletedAt);
  assert.deepEqual(Object.fromEntries(Object.keys(optional).map((key) => [key, deleted.entry[key]])), optional);
  assert.equal(deleted.entry.createdAt, original.createdAt);
  assert.deepEqual(await api.listEntries("owner-a"), []);
  assert.deepEqual(await api.listEntries("owner-a", "2026-10-22"), []);
  assert.equal((await api.listEntries("owner-b"))[0].body, "다른 사용자");
  assert.equal((await api.listTrashEntries("owner-a"))[0].date, "2026-10-22");
  assert.deepEqual(await api.listTrashEntries("owner-b"), []);
  assert.equal(await api.trashCount("owner-a"), 1);
  assert.equal(await api.trashCount("owner-b"), 0);
  assert.equal((await api.entryHistory("owner-a", "2026-10-22"))[0].entry.deletedAt, deleted.entry.deletedAt);
  const restored = await mutate(move("undelete", 2));
  assert.equal(restored.action, "undeleted");
  assert.equal(restored.entry.version, 3);
  assert.equal(restored.entry.deletedAt, null);
  assert.equal(restored.entry.createdAt, original.createdAt);
  assert.deepEqual(Object.fromEntries(Object.keys(optional).map((key) => [key, restored.entry[key]])), optional);
  assert.equal((await api.listEntries("owner-a"))[0].version, 3);
  assert.deepEqual(await api.listTrashEntries("owner-a"), []);
  assert.equal(await api.trashCount("owner-a"), 0);
  assert.deepEqual((await api.entryHistory("owner-a", "2026-10-22")).map((row) => row.version), [3, 2, 1]);
  assert.equal(db.count("journal_entries"), 2);
});

test("trash API is authenticated, supports date filtering, and counts only this owner's deleted diaries", async () => {
  await mutate(save());
  await mutate(save("save-second", "2026-10-21"));
  await mutate(move("delete", 1));
  await mutate(save("owner-b-save"), "owner-b");
  await mutate(move("delete", 1), "owner-b");
  const read = async (suffix = "") => (await entriesRoute.GET(new Request(`${origin}/api/entries${suffix}`))).json();
  const active = await read();
  assert.deepEqual(active.entries.map((entry) => entry.date), ["2026-10-21"]);
  assert.equal(active.trashCount, 1);
  assert.equal(active.connection.status, "required");
  const trash = await read("?trash=true");
  assert.deepEqual(trash.entries.map((entry) => entry.date), ["2026-10-22"]);
  assert.equal(trash.trashCount, 1);
  assert.deepEqual((await read("?trash=true&date=2026-10-21")).entries, []);
  globalThis.__journalTestUser = { userId: "owner-c" };
  assert.deepEqual(await read("?trash=true"), { entries: [], connection: { status: "required" }, trashCount: 0, favoriteDates: [], favoriteIds: [], communityFavoriteCount: 0 });
  globalThis.__journalTestUser = null;
  const anonymous = await entriesRoute.GET(new Request(`${origin}/api/entries?trash=true`));
  assert.equal(anonymous.status, 401);
});

test("normal save, append, patch and history restore cannot resurrect or recreate a trashed date", async () => {
  await mutate(save());
  await mutate(move("delete", 1));
  const invalidWrites = [
    save("recreate-0001"),
    save("replace-0001", "2026-10-22", 2, "다른 본문"),
    { ...move("append", 2, "append-trash"), content: "추가" },
    { ...move("patch", 2, "patch-trash"), patch: { emotion: "차분함" } },
    { ...move("restore", 2, "restore-trash"), revisionVersion: 1 },
    move("delete", 2, "delete-again"),
  ];
  for (const payload of invalidWrites) await assert.rejects(mutate(payload), code("ENTRY_IN_TRASH"));
  assert.equal((await api.listTrashEntries("owner-a"))[0].body, "원문");
  assert.equal(db.count("journal_revisions"), 2);
  assert.equal(db.count("journal_mutations"), 2);
  assert.equal(db.count("journal_entries"), 1);
});

test("delete and undelete retries are idempotent and obsolete historical success returns a conflict", async () => {
  const initialSave = save();
  await mutate(initialSave);
  const deletion = move("delete", 1);
  const deleted = await mutate(deletion);
  assert.equal((await mutate(deletion)).replayed, true);
  assert.equal(db.count("journal_revisions"), 2);
  await assert.rejects(mutate(initialSave), code("VERSION_CONFLICT"));
  const restoration = move("undelete", 2);
  await mutate(restoration);
  assert.equal((await mutate(restoration)).replayed, true);
  assert.equal(db.count("journal_revisions"), 3);
  await assert.rejects(mutate(deletion), code("VERSION_CONFLICT"));
  await assert.rejects(mutate({ ...deletion, expectedVersion: deleted.entry.version }), code("IDEMPOTENCY_CONFLICT"));
  await assert.rejects(mutate(move("undelete", 3, "restore-again")), code("ENTRY_NOT_IN_TRASH"));
  assert.equal((await api.listEntries("owner-a"))[0].version, 3);
});

test("a simultaneous edit and delete preserves a single CAS winner with no extra mutation or revision", async () => {
  await mutate(save());
  db.barrier(2);
  const writes = await Promise.allSettled([mutate(save("edit-race-1", "2026-10-22", 1, "동시에 수정")), mutate(move("delete", 1))]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.find((result) => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  assert.equal(db.count("journal_revisions"), 2);
  assert.equal(db.count("journal_mutations"), 2);
  const winner = writes.find((result) => result.status === "fulfilled").value;
  const rows = await (winner.action === "deleted" ? api.listTrashEntries("owner-a") : api.listEntries("owner-a"));
  assert.deepEqual(rows, [{...winner.entry,commentCount:0}]);
});

test("simultaneous undeletes commit once; a stale undelete cannot overwrite a subsequent edit", async () => {
  await mutate(save());
  await mutate(move("delete", 1));
  db.barrier(2);
  const writes = await Promise.allSettled([mutate(move("undelete", 2, "undelete-one")), mutate(move("undelete", 2, "undelete-two"))]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.find((result) => result.status === "rejected").reason.code, "VERSION_CONFLICT");
  assert.equal(db.count("journal_revisions"), 3);
  assert.equal(db.count("journal_mutations"), 3);
  await mutate(save("edit-restored", "2026-10-22", 3, "복원 후 수정"));
  await assert.rejects(mutate(move("undelete", 2, "stale-restore")), code("VERSION_CONFLICT"));
  assert.equal((await api.listEntries("owner-a"))[0].body, "복원 후 수정");
});

test("delete and undelete roll back atomically after a failed entry write", async () => {
  await mutate(save());
  db.failOnBatchIndex = 2;
  await assert.rejects(mutate(move("delete", 1)), /Simulated write failure/);
  assert.equal((await api.listEntries("owner-a"))[0].version, 1);
  assert.equal(await api.trashCount("owner-a"), 0);
  assert.equal(db.count("journal_revisions"), 1);
  assert.equal(db.count("journal_mutations"), 1);
  await mutate(move("delete", 1));
  db.failOnBatchIndex = 2;
  await assert.rejects(mutate(move("undelete", 2)), /Simulated write failure/);
  assert.deepEqual(await api.listEntries("owner-a"), []);
  assert.equal((await api.listTrashEntries("owner-a"))[0].version, 2);
  assert.equal(await api.trashCount("owner-a"), 1);
  assert.equal(db.count("journal_revisions"), 2);
  assert.equal(db.count("journal_mutations"), 2);
  assert.equal((await mutate(move("undelete", 2))).entry.version, 3);
});

test("delete never affects another owner's diary and missing dates cannot be deleted or restored", async () => {
  await mutate(save(), "owner-b");
  await assert.rejects(mutate(move("delete", 0)), code("ENTRY_NOT_FOUND"));
  await assert.rejects(mutate(move("undelete", 0)), code("ENTRY_NOT_FOUND"));
  await assert.rejects(mutate(move("delete", 1)), code("VERSION_CONFLICT"));
  assert.equal((await api.listEntries("owner-b"))[0].version, 1);
  assert.equal(await api.trashCount("owner-b"), 0);
  assert.deepEqual(await api.entryHistory("owner-a", "2026-10-22"), []);
});


const favorite = (date = "2026-10-22", value = true, userId = "owner-a") => api.setFavorite(userId, { date, favorite: value });
const postFavorite = (payload, headers = {}) => favoritesRoute.POST(new Request(`${origin}/api/favorites`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) }));

test("favorites are owner-scoped and do not modify diary JSON, versions, timestamps or history", async () => {
  await mutate(save());
  await mutate(save("another-date", "2026-10-21"));
  await mutate(save(), "owner-b");
  const before = await api.listEntries("owner-a");
  const historyBefore = await api.entryHistory("owner-a", "2026-10-22");
  const response = await postFavorite({ date: "2026-10-22", favorite: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { date: "2026-10-22", favorite: true });
  assert.deepEqual(await api.listEntries("owner-a"), before);
  assert.deepEqual(await api.entryHistory("owner-a", "2026-10-22"), historyBefore);
  assert.equal(db.count("journal_mutations"), 3);
  assert.deepEqual(await api.favoriteDates("owner-a"), ["2026-10-22"]);
  assert.deepEqual(await api.favoriteDates("owner-b"), []);
  await favorite("2026-10-21");
  const listed = await (await entriesRoute.GET(new Request(`${origin}/api/entries?date=2026-10-21`))).json();
  assert.deepEqual(listed.entries.map((entry) => entry.date), ["2026-10-21"]);
  assert.deepEqual(listed.favoriteDates, ["2026-10-22", "2026-10-21"]);
  globalThis.__journalTestUser = { userId: "owner-b" };
  assert.deepEqual((await (await entriesRoute.GET(new Request(`${origin}/api/entries`))).json()).favoriteDates, []);
});

test("explicit favorite set/unset retries are idempotent, including concurrent sets", async () => {
  await mutate(save());
  await favorite();
  const createdAt = db.sqlite.prepare("SELECT created_at FROM journal_favorites").get().created_at;
  const repeated = await Promise.all([favorite(), favorite(), favorite()]);
  assert.ok(repeated.every((result) => result.favorite === true));
  assert.equal(db.count("journal_favorites"), 1);
  assert.equal(db.sqlite.prepare("SELECT created_at FROM journal_favorites").get().created_at, createdAt);
  await favorite("2026-10-22", false);
  await favorite("2026-10-22", false);
  assert.equal(db.count("journal_favorites"), 0);
  assert.deepEqual(await api.favoriteDates("owner-a"), []);
  assert.equal((await api.listEntries("owner-a"))[0].version, 1);
  assert.equal(db.count("journal_revisions"), 1);
});

test("trash hides but preserves favorites and rejects both set and unset until undeleted", async () => {
  await mutate(save());
  await favorite();
  await mutate(move("delete", 1));
  assert.deepEqual(await api.favoriteDates("owner-a"), []);
  assert.equal(db.count("journal_favorites"), 1);
  for (const value of [true, false]) {
    const response = await postFavorite({ date: "2026-10-22", favorite: value });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "ENTRY_NOT_FOUND");
  }
  assert.equal(db.count("journal_favorites"), 1);
  assert.equal((await api.listTrashEntries("owner-a"))[0].version, 2);
  assert.deepEqual((await (await entriesRoute.GET(new Request(`${origin}/api/entries?trash=true`))).json()).favoriteDates, []);
  await mutate(move("undelete", 2));
  assert.deepEqual(await api.favoriteDates("owner-a"), ["2026-10-22"]);
  assert.deepEqual((await (await entriesRoute.GET(new Request(`${origin}/api/entries`))).json()).favoriteDates, ["2026-10-22"]);
  assert.equal(db.count("journal_revisions"), 3);
});


test("favorite requests reject invalid fields, dates, types, missing diaries and another owner's diary", async () => {
  await mutate(save());
  await mutate(save("only-b-date", "2026-10-21"), "owner-b");
  await favorite("2026-10-21", true, "owner-b");
  for (const payload of [null, [], {}, { date: "2026-10-22" }, { date: "2026-02-30", favorite: true }, { date: "2026-1-01", favorite: true }, { date: "2026-10-22", favorite: "true" }, { date: "2026-10-22", favorite: 1 }, { date: "2026-10-22", favorite: null }, { date: "2026-10-22", favorite: true, userId: "owner-b" }]) {
    const response = await postFavorite(payload);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_INPUT");
  }
  for (const date of ["2026-10-20", "2026-10-21"]) {
    for (const value of [true, false]) assert.equal((await postFavorite({ date, favorite: value })).status, 404);
  }
  assert.deepEqual(await api.favoriteDates("owner-a"), []);
  assert.deepEqual(await api.favoriteDates("owner-b"), ["2026-10-21"]);
  assert.equal(db.count("journal_favorites"), 1);
});

test("favorite route enforces identity, same origin and bounded JSON without making writes", async () => {
  await mutate(save());
  globalThis.__journalTestUser = null;
  const unauthorized = await postFavorite({ date: "2026-10-22", favorite: true });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, "SIGN_IN_REQUIRED");
  globalThis.__journalTestUser = { userId: "owner-a" };
  assert.equal((await postFavorite({ date: "2026-10-22", favorite: true }, { Origin: "https://other.example" })).status, 403);
  const tooLarge = await favoritesRoute.POST(new Request(`${origin}/api/favorites`, { method: "POST", body: "a".repeat(100 * 1024 + 1) }));
  assert.equal(tooLarge.status, 413);
  const invalidJson = await favoritesRoute.POST(new Request(`${origin}/api/favorites`, { method: "POST", body: "{" }));
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, "INVALID_JSON");
  assert.equal(db.count("journal_favorites"), 0);
  assert.equal(db.count("journal_revisions"), 1);
});

test("favorite batch failure rolls back both setting and unsetting without touching diary state", async () => {
  await mutate(save());
  const before = await api.listEntries("owner-a");
  db.failOnBatchIndex = 1;
  await assert.rejects(favorite(), /Simulated write failure/);
  assert.equal(db.count("journal_favorites"), 0);
  await favorite();
  db.failOnBatchIndex = 1;
  await assert.rejects(favorite("2026-10-22", false), /Simulated write failure/);
  assert.deepEqual(await api.favoriteDates("owner-a"), ["2026-10-22"]);
  assert.deepEqual(await api.listEntries("owner-a"), before);
  assert.equal(db.count("journal_revisions"), 1);
  assert.equal(db.count("journal_mutations"), 1);
});

// Small real images, generated once with Pillow and embedded to avoid dependencies.
const imageFixtures = {
  "image/png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4sWUBAARkAh2NzDMBAAAAAElFTkSuQmCC", "base64"),
  "image/jpeg": Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDuKKKK4zrP/9k=", "base64"),
  "image/gif": Buffer.from("R0lGODdhAQABAIEAAMi0oAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==", "base64"),
  "image/webp": Buffer.from("UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoBAAEAAUAmJQBOgCgAAP7yyn69aW5uE+BJWrMIAAA=", "base64"),
};
const uploadRequest = (type = "image/png", bytes = imageFixtures[type], name = "투자 차트.png", headers = {}) => new Request(`${origin}/api/images?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": type, ...headers }, body: bytes });
const upload = async (type = "image/png", bytes = imageFixtures[type], name) => {
  const response = await imageUploadRoute.POST(uploadRequest(type, bytes, name));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return (await response.json()).image;
};
const readImage = (id) => imageReadRoute.GET(new Request(`${origin}/api/images/${id}`), { params: Promise.resolve({ id }) });

test("real PNG, JPEG, GIF and WebP uploads preview privately before any diary is saved", async () => {
  for (const [type, bytes] of Object.entries(imageFixtures)) {
    const image = await upload(type, bytes);
    assert.deepEqual(Object.keys(image).sort(), ["id", "name", "size", "type"]);
    assert.equal(image.type, type);
    assert.equal(image.size, bytes.length);
    const response = await readImage(image.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), type);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  assert.equal(db.count("journal_images"), 4);
  assert.equal(db.count("journal_entries"), 0);
  assert.equal(db.count("journal_revisions"), 0);
});

test("JPEG uploads accept trailing camera data and normalize browser MIME metadata", async () => {
  const jpeg = imageFixtures["image/jpeg"];
  const progressive = await readFile(new URL("./fixtures/progressive.jpg", import.meta.url));
  const motionPhoto = Buffer.concat([jpeg, Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42camera-data")]);
  for (const [type, bytes, expected] of [
    ["image/jpeg", motionPhoto, "image/jpeg"],
    ["image/jpeg", progressive, "image/jpeg"],
    ["image/jpg", jpeg, "image/jpeg"],
    ["image/pjpeg", jpeg, "image/jpeg"],
    ["application/octet-stream", jpeg, "image/jpeg"],
    ["", jpeg, "image/jpeg"],
    ["image/jpeg", imageFixtures["image/png"], "image/png"],
    ["image/webp", imageFixtures["image/gif"], "image/gif"],
  ]) {
    const image = await upload(type, bytes, "휴대폰 사진.JPG");
    assert.equal(image.type, expected);
    const preview = await readImage(image.id);
    assert.equal(preview.headers.get("content-type"), expected);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    assert.equal(bucket.objects.get(bucket.puts.at(-1)).options.httpMetadata.contentType, expected);
  }
});

test("image uploads reject unsupported MIME, SVG, forged signatures and truncated JPEGs", async () => {
  const jpeg = imageFixtures["image/jpeg"];
  // The thumbnail's EOI must not hide a missing EOI in the main image.
  const thumbnail = Buffer.from([0xff, 0xe1, 0, 6, 0xff, 0xd8, 0xff, 0xd9]);
  const truncatedWithThumbnail = Buffer.concat([jpeg.subarray(0, 2), thumbnail, jpeg.subarray(2, -2)]);
  for (const [type, bytes, expected] of [
    ["image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "UNSUPPORTED_IMAGE_TYPE"],
    ["text/html", imageFixtures["image/png"], "UNSUPPORTED_IMAGE_TYPE"],
    ["image/png", Buffer.from("<svg/onload=alert(1)>"), "IMAGE_TYPE_MISMATCH"],
    ["application/octet-stream", Buffer.from("<html>renamed.jpg</html>"), "IMAGE_TYPE_MISMATCH"],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "IMAGE_TYPE_MISMATCH"],
    ["image/jpeg", jpeg.subarray(0, -2), "IMAGE_TYPE_MISMATCH"],
    ["image/jpeg", truncatedWithThumbnail, "IMAGE_TYPE_MISMATCH"],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0xff, 0xd9]), "IMAGE_TYPE_MISMATCH"],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "IMAGE_TYPE_MISMATCH"],
  ]) {
    const response = await imageUploadRoute.POST(uploadRequest(type, bytes));
    assert.equal(response.status, 415);
    assert.equal((await response.json()).code, expected);
  }
  assert.equal(db.count("journal_images"), 0);
  assert.equal(bucket.puts.length, 0);
});

test("image uploads enforce empty and 5MB limits using both headers and actual streamed bytes", async () => {
  const limit = 5 * 1024 * 1024;
  const empty = await imageUploadRoute.POST(uploadRequest("image/png", new Uint8Array()));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "EMPTY_IMAGE");
  const declared = await imageUploadRoute.POST(uploadRequest("image/png", imageFixtures["image/png"], "small.png", { "Content-Length": String(limit + 1) }));
  assert.equal(declared.status, 413);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limit)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const streamed = await imageUploadRoute.POST(new Request(`${origin}/api/images?name=large.png`, { method: "POST", headers: { "Content-Type": "image/png", "Content-Length": "1" }, body: stream, duplex: "half" }));
  assert.equal(streamed.status, 413);
  assert.equal((await streamed.json()).code, "IMAGE_TOO_LARGE");
  assert.equal(cancelled, true);
  assert.equal(bucket.puts.length, 0);
  const exact = new Uint8Array(limit);
  exact.set(imageFixtures["image/png"]);
  const image = await upload("image/png", exact, "limit.png");
  assert.equal(image.size, limit);
});

test("image routes require identity and same-origin uploads; another user never reaches R2 on reads", async () => {
  globalThis.__journalTestUser = null;
  assert.equal((await imageUploadRoute.POST(uploadRequest())).status, 401);
  assert.equal((await readImage("00000000-0000-0000-0000-000000000001")).status, 401);
  assert.equal(db.count("journal_images"), 0);
  globalThis.__journalTestUser = { userId: "owner-a" };
  assert.equal((await imageUploadRoute.POST(uploadRequest("image/png", imageFixtures["image/png"], "name.png", { Origin: "https://other.example" }))).status, 403);
  const image = await upload();
  globalThis.__journalTestUser = { userId: "owner-b" };
  assert.equal((await readImage(image.id)).status, 404);
  assert.equal(bucket.gets.length, 0);
  assert.equal((await readImage("00000000-0000-0000-0000-000000000001")).status, 404);
  globalThis.__journalTestUser = { userId: "owner-a" };
  assert.equal((await readImage(image.id)).status, 200);
});

test("only up to three distinct owned image IDs attach and display metadata comes from D1", async () => {
  const own = await Promise.all([upload(), upload(), upload(), upload()]);
  const forged = own.slice(0, 3).map((image) => ({ ...image, name: "fake.svg", type: "text/html", size: 1 }));
  const payload = { ...save("attach-owned"), data: { body: "첨부한 일기", images: forged } };
  const attached = await mutate(payload);
  assert.deepEqual(attached.entry.images, own.slice(0, 3));
  const replay = await mutate(payload);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.entry.images, own.slice(0, 3));
  const version = attached.entry.version;
  await assert.rejects(mutate({ ...save("too-many-img", "2026-10-22", version), data: { body: "4장", images: own } }), code("INVALID_INPUT"));
  await assert.rejects(mutate({ ...save("duplicate-img", "2026-10-22", version), data: { body: "중복", images: [own[0], own[0]] } }), code("INVALID_INPUT"));
  globalThis.__journalTestUser = { userId: "owner-b" };
  const foreign = await upload();
  await assert.rejects(mutate({ ...save("foreign-img", "2026-10-22", version), data: { body: "타인", images: [foreign] } }), code("INVALID_IMAGE"));
  await assert.rejects(mutate({ ...save("missing-img", "2026-10-22", version), data: { body: "없는 사진", images: [{ id: "00000000-0000-0000-0000-000000000001" }] } }), code("INVALID_IMAGE"));
  assert.equal((await api.listEntries("owner-a"))[0].version, version);
  assert.equal(db.count("journal_revisions"), 1);
  assert.equal(db.count("journal_mutations"), 1);
});


test("delete/undelete preserve image attachments and private historical previews remain available", async () => {
  const image = await upload();
  await mutate({ ...save("trash-image"), data: { body: "사진 일기", images: [image] } });
  const deleted = await mutate(move("delete", 1));
  assert.deepEqual(deleted.entry.images, [image]);
  assert.equal((await readImage(image.id)).status, 200);
  const restored = await mutate(move("undelete", 2));
  assert.deepEqual(restored.entry.images, [image]);
  assert.equal(bucket.deletes.length, 0);
  assert.equal(db.count("journal_images"), 1);
});

test("metadata failure compensates the new R2 object and failed R2 writes never create metadata", async () => {
  db.failNextRunPrefix = "INSERT INTO journal_images";
  const originalError = console.error;
  console.error = () => {};
  try {
    const metadataFailure = await imageUploadRoute.POST(uploadRequest());
    assert.equal(metadataFailure.status, 503);
    assert.equal(bucket.objects.size, 0);
    assert.equal(bucket.deletes.length, 1);
    assert.equal(db.count("journal_images"), 0);
    bucket.failPut = true;
    const storageFailure = await imageUploadRoute.POST(uploadRequest());
    assert.equal(storageFailure.status, 503);
    assert.equal(db.count("journal_images"), 0);
  } finally { console.error = originalError; }
});

test("image filenames are display-only normalized metadata and missing R2 fails without metadata", async () => {
  const image = await upload("image/png", imageFixtures["image/png"], "../folder/차트\r\n.png");
  assert.equal(image.name, "차트.png");
  const row = db.sqlite.prepare("SELECT object_key FROM journal_images WHERE id = ?").get(image.id);
  assert.equal(row.object_key, `journal-images/${image.id}`);
  assert.ok(!row.object_key.includes(image.name));
  delete globalThis.__journalTestEnv.BUCKET;
  const response = await imageUploadRoute.POST(uploadRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "IMAGE_STORAGE_UNAVAILABLE");
  assert.equal(db.count("journal_images"), 1);
});


test("legacy diaries accept insights and invalid insight inputs leave persisted content untouched", async () => {
  const first = await mutate(save("insight-legacy"));
  const { insight, ...legacy } = first.entry;
  db.sqlite.prepare("UPDATE journal_entries SET entry_json = ? WHERE user_id = ? AND date = ?").run(JSON.stringify(legacy), "owner-a", first.entry.date);
  const patched = await mutate({ ...move("patch", 1, "insight-legacy-patch"), patch: { insight: "새로 기록한 배움" } });
  assert.equal(patched.entry.body, first.entry.body);
  assert.equal(patched.entry.insight, "새로 기록한 배움");
  for (const [index, invalid] of [null, 3, [], {}, "가".repeat(6001)].entries()) {
    await assert.rejects(mutate({ ...move("patch", 2, `insight-invalid-${index}`), patch: { insight: invalid } }), code("INVALID_INPUT"));
  }
  assert.equal((await api.listEntries("owner-a"))[0].version, 2);
  assert.equal(db.count("journal_revisions"), 2);
});
