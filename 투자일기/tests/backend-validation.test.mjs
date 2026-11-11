import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Test the actual dependency-free validator, stripping types without changing it.
const source = await readFile(new URL("../app/lib/server-validation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { ApiError, validDate, validateMutation, computeEntry } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const now = "2026-10-22T09:00:00.000Z";
const payload = (overrides = {}) => ({ operation: "save", date: "2026-10-22", expectedVersion: 0, requestId: "request-0001", data: { body: "오늘은 기다린다." }, ...overrides });
const current = () => computeEntry(validateMutation(payload()), null, null, now);
const hasCode = (code) => (error) => error instanceof ApiError && error.code === code;

test("calendar validation rejects impossible dates and accepts leap day", () => {
  assert.equal(validDate("2024-02-29"), "2024-02-29");
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01", "today"]) assert.throws(() => validDate(date), hasCode("INVALID_INPUT"));
});

test("new records keep unselected optional investment fields empty", () => {
  const entry = current();
  assert.equal(entry.sentiment, null);
  assert.equal(entry.emotion, null);
  assert.equal(entry.cashRatio, null);
  assert.equal(entry.fearGreed, null);
  assert.deepEqual(entry.trades, []);
  assert.equal(entry.version, 1);
});

test("strict numbers, optional cash zero, trades and manually sourced CNN snapshot", () => {
  const optional = { body: "기록", cashRatio: 0, emotion: "차분함", trades: [{ side: "buy", symbol: "삼성전자" }], fearGreed: { value: 12, asOf: "2026-10-22T16:00:00+09:00", recordedAt: now, source: "manual", sourceUrl: "https://edition.cnn.com/markets/fear-and-greed" } };
  assert.equal(validateMutation(payload({ data: optional })).data.cashRatio, 0);
  for (const cashRatio of [-1, 101, "40", NaN]) assert.throws(() => validateMutation(payload({ data: { body: "a", cashRatio } })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ data: { ...optional, fearGreed: { ...optional.fearGreed, value: 101 } } })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ data: { ...optional, fearGreed: { ...optional.fearGreed, source: "automatic" } } })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ data: { ...optional, fearGreed: { ...optional.fearGreed, sourceUrl: "https://example.com" } } })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ data: { body: "a", trades: [{ side: "buy", symbol: "" }] } })), hasCode("INVALID_INPUT"));
});

test("append preserves content and metadata; patch changes only requested fields", () => {
  const first = { ...current(), emotion: "차분함", cashRatio: 35, trades: [{ side: "buy", symbol: "AAPL" }] };
  const appended = computeEntry(validateMutation(payload({ operation: "append", expectedVersion: 1, data: undefined, content: "나중에 추가한 생각" })), first, null, now);
  assert.equal(appended.body, "오늘은 기다린다.\n\n나중에 추가한 생각");
  assert.equal(appended.cashRatio, 35);
  assert.deepEqual(appended.trades, first.trades);
  const patched = computeEntry(validateMutation(payload({ operation: "patch", expectedVersion: 2, data: undefined, patch: { emotion: "기대감" } })), appended, null, now);
  assert.equal(patched.body, appended.body);
  assert.equal(patched.emotion, "기대감");
  assert.equal(patched.version, 3);
});

test("phrase patches reject missing/ambiguous text and treat replacement literally", () => {
  const mutation = validateMutation(payload({ operation: "patch", expectedVersion: 1, data: undefined, patch: { replaceText: { from: "기다린다", to: "$& 확인한다" } } }));
  assert.equal(computeEntry(mutation, current(), null, now).body, "오늘은 $& 확인한다.");
  assert.throws(() => computeEntry(mutation, { ...current(), body: "기다린다. 기다린다." }, null, now), hasCode("TEXT_MATCH_CONFLICT"));
  assert.throws(() => computeEntry(mutation, { ...current(), body: "다른 문장" }, null, now), hasCode("TEXT_MATCH_CONFLICT"));
});

test("restore copies a prior snapshot into a new version preserving original creation time", () => {
  const old = current();
  const latest = { ...old, version: 3, body: "수정한 본문", cashRatio: 60 };
  const mutation = validateMutation(payload({ operation: "restore", expectedVersion: 3, data: undefined, revisionVersion: 1 }));
  const restored = computeEntry(mutation, latest, old, "2026-10-22T10:00:00.000Z");
  assert.equal(restored.body, old.body);
  assert.equal(restored.version, 4);
  assert.equal(restored.createdAt, old.createdAt);
  assert.notEqual(restored.updatedAt, old.updatedAt);
});

test("incompatible and unknown payload fields are rejected", () => {
  assert.throws(() => validateMutation(payload({ unexpected: "ignored?" })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ expectedVersion: 1.5 })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ requestId: "short" })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ operation: "append", content: "more" })), hasCode("INVALID_INPUT"));
  assert.throws(() => validateMutation(payload({ operation: "patch", data: undefined, patch: { body: "all", replaceText: { from: "old", to: "new" } } })), hasCode("INVALID_INPUT"));
});

test("delete and undelete accept only identifiers and preserve empty optional fields", () => {
  const deletion = validateMutation(payload({ operation: "delete", data: undefined, expectedVersion: 1 }));
  const deleted = computeEntry(deletion, current(), null, now);
  assert.equal(deleted.deletedAt, now);
  assert.equal(deleted.body, current().body);
  assert.equal(deleted.sentiment, null);
  assert.equal(deleted.emotion, null);
  assert.equal(deleted.cashRatio, null);
  assert.equal(deleted.fearGreed, null);
  assert.deepEqual(deleted.trades, []);
  const restoration = validateMutation(payload({ operation: "undelete", data: undefined, expectedVersion: 2 }));
  const restored = computeEntry(restoration, deleted, null, now);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.version, 3);
  assert.equal(restored.body, current().body);
  for (const operation of ["delete", "undelete"]) {
    for (const extra of [{ data: {} }, { content: "본문" }, { patch: { emotion: null } }, { revisionVersion: 1 }]) {
      assert.throws(() => validateMutation(payload({ operation, data: undefined, ...extra })), hasCode("INVALID_INPUT"));
    }
  }
  assert.throws(() => computeEntry(deletion, null, null, now), hasCode("ENTRY_NOT_FOUND"));
  assert.throws(() => computeEntry(restoration, null, null, now), hasCode("ENTRY_NOT_FOUND"));
  assert.throws(() => computeEntry(restoration, current(), null, now), hasCode("ENTRY_NOT_IN_TRASH"));
  assert.throws(() => computeEntry(validateMutation(payload({ expectedVersion: 2 })), deleted, null, now), hasCode("ENTRY_IN_TRASH"));
});

const images = [
  { id: "11111111-1111-4111-8111-111111111111", name: "차트.png", type: "image/png", size: 1024 },
  { id: "22222222-2222-4222-8222-222222222222", name: "매매.jpg", type: "image/jpeg", size: 2048 },
  { id: "33333333-3333-4333-8333-333333333333", name: "메모.webp", type: "image/webp", size: 4096 },
];

test("image references allow up to three distinct UUIDs and reject invalid lists before saving", () => {
  assert.deepEqual(validateMutation(payload({ data: { body: "기록", images: [] } })).data.images, []);
  assert.equal(validateMutation(payload({ data: { body: "기록", images } })).data.images.length, 3);
  assert.equal(validateMutation(payload({ data: { body: "기록", images: [{ id: images[0].id }] } })).data.images[0].id, images[0].id);
  for (const invalidImages of [
    null,
    "image.png",
    [...images, { id: "44444444-4444-4444-8444-444444444444" }],
    [images[0], images[0]],
    [{ id: "not-a-uuid" }],
    [{}],
    [null],
  ]) assert.throws(() => validateMutation(payload({ data: { body: "기록", images: invalidImages } })), hasCode("INVALID_INPUT"));
});

test("save, append and patch preserve existing images when the caller omits them", () => {
  const first = { ...current(), images: images.slice(0, 2) };
  const operations = [
    { operation: "save", data: { body: "새로 정리한 본문" } },
    { operation: "append", data: undefined, content: "덧붙인 본문" },
    { operation: "patch", data: undefined, patch: { emotion: "차분함" } },
  ];
  for (const operation of operations) {
    const mutation = validateMutation(payload({ expectedVersion: 1, ...operation }));
    const entry = computeEntry(mutation, first, null, now);
    assert.deepEqual(entry.images, first.images);
    assert.equal(entry.version, 2);
  }
  assert.deepEqual(first.images, images.slice(0, 2));
});

test("explicit image lists replace attachments and empty lists remove them without changing the original snapshot", () => {
  const first = { ...current(), images: images.slice(0, 2) };
  for (const operation of ["save", "append", "patch"]) {
    for (const selected of [[], [images[2]]]) {
      const changes = operation === "patch"
        ? { data: undefined, patch: { images: selected } }
        : { data: { ...(operation === "save" ? { body: first.body } : {}), images: selected }, ...(operation === "append" ? { content: "추가" } : {}) };
      const result = computeEntry(validateMutation(payload({ operation, expectedVersion: 1, ...changes })), first, null, now);
      assert.deepEqual(result.images, selected);
    }
  }
  assert.deepEqual(first.images, images.slice(0, 2));
});

test("history restoration uses the historical image list, including legacy revisions with no images", () => {
  const old = { ...current(), images: [images[0], images[1]] };
  const latest = { ...old, version: 3, images: [images[2]] };
  const mutation = validateMutation(payload({ operation: "restore", expectedVersion: 3, data: undefined, revisionVersion: 1 }));
  const restored = computeEntry(mutation, latest, old, now);
  assert.deepEqual(restored.images, old.images);
  assert.equal(restored.version, 4);
  const { images: removed, ...legacy } = old;
  assert.deepEqual(computeEntry(mutation, latest, legacy, now).images, []);
  assert.deepEqual(latest.images, [images[2]]);
});

test("delete and undelete preserve image references while legacy entries remain editable", () => {
  const first = { ...current(), images: images.slice(0, 2) };
  const deleted = computeEntry(validateMutation(payload({ operation: "delete", expectedVersion: 1, data: undefined })), first, null, now);
  assert.deepEqual(deleted.images, first.images);
  const restored = computeEntry(validateMutation(payload({ operation: "undelete", expectedVersion: 2, data: undefined })), deleted, null, now);
  assert.deepEqual(restored.images, first.images);
  const { images: removed, ...legacy } = first;
  for (const operation of [
    { operation: "save", data: { body: "수정" } },
    { operation: "append", data: undefined, content: "추가" },
    { operation: "patch", data: undefined, patch: { cashRatio: 0 } },
  ]) assert.deepEqual(computeEntry(validateMutation(payload({ expectedVersion: 1, ...operation })), legacy, null, now).images, []);
});


test("CNN index accepts a value without a source date and preserves supplied historical dates", () => {
  const snapshot = {value:33,source:'manual',sourceUrl:'https://edition.cnn.com/markets/fear-and-greed',recordedAt:now};
  for (const value of [0,33,100]) {
    const mutation = validateMutation(payload({data:{body:'지수만 기록',fearGreed:{...snapshot,value}}}));
    const entry = computeEntry(mutation,null,null,now);
    assert.equal(entry.fearGreed.value,value);
    assert.equal(Object.hasOwn(entry.fearGreed,'asOf'),false);
  }
  for (const value of [-1,101,'33']) assert.throws(()=>validateMutation(payload({data:{body:'기록',fearGreed:{...snapshot,value}}})),hasCode('INVALID_INPUT'));
  assert.equal(validateMutation(payload({data:{body:'기존 기록',fearGreed:{...snapshot,asOf:'2026-10-22'}}})).data.fearGreed.asOf,'2026-10-22');
  assert.throws(()=>validateMutation(payload({data:{body:'기록',fearGreed:{...snapshot,asOf:'2026-02-30'}}})),hasCode('INVALID_INPUT'));
});
