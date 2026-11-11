import type { Diary, SharingVersion } from "./model";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Editable = Pick<Diary, "title" | "body" | "sentiment" | "emotion" | "cashRatio" | "trades" | "fearGreed" | "images" | "insight" | "visibility" | "shareFearGreed" | "shareEmotion" | "shareCash" | "shareTrades" | "commentsEnabled">;
export type Mutation = {
  operation: "create" | "save" | "append" | "patch" | "restore" | "delete" | "undelete";
  date: string;
  expectedVersion: number;
  entryId?: string;
  requestId: string;
  sharingVersion?: SharingVersion;
  data?: Partial<Editable>;
  content?: string;
  patch?: Partial<Editable> & { replaceText?: { from: string; to: string } };
  revisionVersion?: number;
};

const sentiments = ["very-bullish", "bullish", "neutral", "bearish", "very-bearish"];
export const CNN_SOURCE = "https://edition.cnn.com/markets/fear-and-greed";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export function validImageId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) invalid("이미지 ID 형식을 확인해 주세요.");
  return value;
}

export function validImageName(raw: string | null): string {
  const name = (raw ?? "image").normalize("NFC").split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (name || "image").slice(0, 255);
}

function hasJpegStructure(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let inScan = false;
  let hasFrame = false;
  let hasScan = false;
  let height = 0;
  while (offset < bytes.length) {
    // Skip entropy data, but respect byte stuffing and restart markers below.
    if (inScan) while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (inScan && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    // EOI ends the JPEG, not necessarily the containing file (e.g. Motion Photos).
    if (marker === 0xd9) return hasFrame && hasScan && height > 0;
    if (marker === 0x01) continue;
    if (marker < 0xc0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return false;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return false;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (length < 8 || bytes[offset + 7] === 0 || length !== 8 + 3 * bytes[offset + 7]) return false;
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      if (((bytes[offset + 5] << 8) | bytes[offset + 6]) === 0) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!hasFrame || length < 6 || bytes[offset + 2] === 0 || length !== 6 + 2 * bytes[offset + 2]) return false;
      hasScan = true;
    }
    if (marker === 0xdc) {
      if (!hasScan || length !== 4) return false;
      height = (bytes[offset + 2] << 8) | bytes[offset + 3];
    }
    inScan = marker === 0xda || (inScan && marker === 0xdc);
    // Skip whole metadata segments so an embedded thumbnail's EOI cannot end the image.
    offset += length;
  }
  return false;
}

export function validateUploadBytes(bytes: Uint8Array, type: string): typeof IMAGE_TYPES[number] {
  const declared = type.trim().toLowerCase();
  if (![...IMAGE_TYPES, "image/jpg", "image/pjpeg", "application/octet-stream", ""].includes(declared)) throw new ApiError(415, "UNSUPPORTED_IMAGE_TYPE", "JPEG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.");
  if (!bytes.byteLength) throw new ApiError(400, "EMPTY_IMAGE", "빈 이미지는 업로드할 수 없습니다.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "이미지 한 장은 최대 5MB까지 업로드할 수 있습니다.");
  const at = (offset: number, values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  const text = (offset: number, value: string) => at(offset, [...value].map((char) => char.charCodeAt(0)));
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isPng = bytes.length >= 33 && at(0, [137, 80, 78, 71, 13, 10, 26, 10]) && data.getUint32(8) === 13 && text(12, "IHDR") && data.getUint32(16) > 0 && data.getUint32(20) > 0;
  const isJpeg = hasJpegStructure(bytes);
  const isGif = bytes.length >= 14 && (text(0, "GIF87a") || text(0, "GIF89a")) && data.getUint16(6, true) > 0 && data.getUint16(8, true) > 0 && bytes[bytes.length - 1] === 59;
  const isWebp = bytes.length >= 20 && text(0, "RIFF") && data.getUint32(4, true) === bytes.length - 8 && text(8, "WEBP") && ["VP8 ", "VP8L", "VP8X"].some((format) => text(12, format));
  const detected = isPng ? "image/png" : isJpeg ? "image/jpeg" : isGif ? "image/gif" : isWebp ? "image/webp" : null;
  if (!detected) throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "파일 내용을 읽을 수 있는 JPEG, PNG, WebP, GIF 이미지인지 확인해 주세요. 파일이 손상됐거나 HEIC 형식이라면 JPG 또는 PNG로 변환한 뒤 다시 선택해 주세요.");
  // Browser MIME metadata can be missing, aliased, or stale after a mobile conversion.
  return detected;
}

export function invalid(message: string): never { throw new ApiError(400, "INVALID_INPUT", message); }
export function object(value: unknown, label = "입력"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} 형식을 확인해 주세요.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > limit || (!allowEmpty && !value.trim())) invalid(`${label} 형식을 확인해 주세요. (최대 ${limit}자)`);
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid("지원하지 않는 입력 필드가 있습니다.");
}
export function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("날짜는 YYYY-MM-DD 형식으로 입력해 주세요.");
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value || value.slice(0, 4) === "0000") invalid("실제로 존재하는 날짜를 입력해 주세요.");
  return value;
}

export function parseCommunityPostId(raw: unknown): [string, string] {
  if (typeof raw !== "string" || raw.length > 500) invalid("게시글을 확인해 주세요.");
  const split = raw.lastIndexOf("~");
  let author: string;
  try { author = decodeURIComponent(raw.slice(0, split)); }
  catch { invalid("게시글을 확인해 주세요."); }
  if (split < 1 || !author || author.length > 256) invalid("게시글을 확인해 주세요.");
  return [author, validDate(raw.slice(split + 1))];
}

export function normalizeEmotion(value: string | null | undefined): string | null {
  return value === "과열됨" ? "흥분됨" : value ?? null;
}
function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(`${label}는 시간대가 포함된 ISO 시각이어야 합니다.`);
  validDate(value.slice(0, 10));
  return value;
}
function finite(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(`${label}는 ${min}~${max} 범위의 ${integer ? "정수" : "숫자"}여야 합니다.`);
  return value;
}
export function validateFields(raw: unknown, allowReplacement = false): Partial<Editable> & { replaceText?: { from: string; to: string } } {
  const value = object(raw);
  keys(value, ["title", "body", "sentiment", "emotion", "cashRatio", "trades", "fearGreed", "images", "insight", "visibility", "shareFearGreed", "shareEmotion", "shareCash", "shareTrades", "commentsEnabled", ...(allowReplacement ? ["replaceText"] : [])]);
  const result: Partial<Editable> & { replaceText?: { from: string; to: string } } = {};
  if ("visibility" in value) {
    if (!["private", "sentiment", "public"].includes(value.visibility as string)) invalid("일기 공개 범위를 확인해 주세요.");
    result.visibility = value.visibility as Editable["visibility"];
  }
  for (const key of ["shareFearGreed", "shareEmotion", "shareCash", "shareTrades", "commentsEnabled"] as const) {
    if (key in value) {
      if (typeof value[key] !== "boolean") invalid("민감정보 공개 여부는 true 또는 false여야 합니다.");
      result[key] = value[key] as boolean;
    }
  }
  if ("title" in value) result.title = string(value.title, "제목", 200);
  if ("body" in value) result.body = string(value.body, "본문", 60000);
  if ("insight" in value) result.insight = string(value.insight, "인사이트", 6000);
  if ("sentiment" in value) {
    if (value.sentiment !== null && !sentiments.includes(value.sentiment as string)) invalid("투자 심리를 선택해 주세요.");
    result.sentiment = value.sentiment as Editable["sentiment"];
  }
  if ("emotion" in value) {
    result.emotion = value.emotion === null || value.emotion === ""
      ? null : normalizeEmotion(string(value.emotion, "감정 상태", 80, false));
  }
  if ("cashRatio" in value) result.cashRatio = value.cashRatio === null ? null : finite(value.cashRatio, "현금 비중", 0, 100);
  if ("trades" in value) {
    if (!Array.isArray(value.trades) || value.trades.length > 100) invalid("거래 종목은 최대 100개까지 입력할 수 있습니다.");
    result.trades = value.trades.map((item) => {
      const trade = object(item, "거래 종목");
      keys(trade, ["side", "symbol", "note"]);
      if (trade.side !== "buy" && trade.side !== "sell") invalid("거래 구분은 buy 또는 sell이어야 합니다.");
      return { side: trade.side as "buy" | "sell", symbol: string(trade.symbol, "종목", 80, false).trim(), ...(trade.note !== undefined ? { note: string(trade.note, "거래 메모", 500) } : {}) };
    });
  }
  if ("fearGreed" in value) {
    if (value.fearGreed === null) result.fearGreed = null;
    else {
      const snapshot = object(value.fearGreed, "CNN 지수");
      keys(snapshot, ["value", "asOf", "source", "sourceUrl", "recordedAt"]);
      if (snapshot.source !== "manual") invalid("확인한 CNN 지수만 수동 기록할 수 있습니다.");
      if (typeof snapshot.sourceUrl !== "string" || !/^https:\/\/(www\.|edition\.)?cnn\.com\/markets\/fear-and-greed\/?$/.test(snapshot.sourceUrl)) invalid("CNN 공식 지수 출처를 입력해 주세요.");
      const asOf = snapshot.asOf === undefined ? undefined
        : typeof snapshot.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOf) ? validDate(snapshot.asOf) : iso(snapshot.asOf, "지수 기준 시각");
      result.fearGreed = { value: finite(snapshot.value, "CNN 지수", 0, 100), ...(asOf ? {asOf} : {}), source: "manual", sourceUrl: snapshot.sourceUrl, recordedAt: iso(snapshot.recordedAt, "지수 기록 시각") };
    }
  }
  if ("images" in value) {
    if (!Array.isArray(value.images) || value.images.length > 3) invalid("이미지는 일기당 최대 3장까지 첨부할 수 있습니다.");
    const ids = new Set<string>();
    result.images = value.images.map((item) => {
      const image = object(item, "첨부 이미지");
      keys(image, ["id", "name", "type", "size"]);
      const id = validImageId(image.id);
      if (ids.has(id)) invalid("같은 이미지를 중복으로 첨부할 수 없습니다.");
      ids.add(id);
      // These display fields are replaced with owner-checked database metadata.
      return { id, name: image.name === undefined ? "" : string(image.name, "이미지 이름", 255), type: image.type === undefined ? "" : string(image.type, "이미지 형식", 100), size: image.size === undefined ? 0 : finite(image.size, "이미지 크기", 0, MAX_IMAGE_BYTES, true) };
    });
  }
  if ("replaceText" in value) {
    const replace = object(value.replaceText, "교체할 문장");
    keys(replace, ["from", "to"]);
    if ("body" in value) invalid("본문 전체 변경과 문장 교체는 동시에 요청할 수 없습니다.");
    result.replaceText = { from: string(replace.from, "원래 문장", 60000, false), to: string(replace.to, "바꿀 문장", 60000) };
  }
  return result;
}
// A deterministic ID keeps pre-upgrade date links and stored replay results valid.
export function legacyEntryId(userId: string, date: string): string {
  const encoded = Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, "0")).join("");
  return `legacy-${encoded}-${date}`;
}

export function validEntryId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|legacy-[0-9a-f]{2,2048}-\d{4}-\d{2}-\d{2})$/.test(value)) {
    invalid("일기 ID를 확인해 주세요.");
  }
  return value;
}

export function resolvePostId(value: unknown): string {
  if (typeof value === "string" && value.includes("~")) {
    const [author, date] = parseCommunityPostId(value);
    return legacyEntryId(author, date);
  }
  return validEntryId(value);
}

export function validateMutation(raw: unknown): Mutation {
  const value = object(raw);
  keys(value, ["operation", "entryId", "date", "expectedVersion", "requestId", "data", "content", "patch", "revisionVersion", "sharingVersion"]);
  if (!["create", "save", "append", "patch", "restore", "delete", "undelete"].includes(value.operation as string)) invalid("저장 작업을 확인해 주세요.");
  const mutation: Mutation = {
    operation: value.operation as Mutation["operation"], date: validDate(value.date),
    expectedVersion: finite(value.expectedVersion, "현재 버전", 0, 2147483646, true),
    requestId: string(value.requestId, "요청 ID", 128, false),
  };
  if ("entryId" in value) mutation.entryId = validEntryId(value.entryId);
  const isSave = mutation.operation === "save" || mutation.operation === "create";
  if (mutation.operation === "create" && (mutation.entryId || mutation.expectedVersion !== 0)) {
    invalid("새 일기의 저장 정보를 확인해 주세요.");
  }
  if (mutation.entryId && mutation.expectedVersion === 0) invalid("수정할 일기의 버전을 확인해 주세요.");
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(mutation.requestId)) invalid("요청 ID는 8~128자의 영문, 숫자, -, _, ., : 조합이어야 합니다.");
  if (value.data !== undefined) mutation.data = validateFields(value.data);
  if ("sharingVersion" in value) {
    const version = value.sharingVersion;
    if ((version !== 2 && version !== 3 && version !== 4) || !isSave || !mutation.data?.visibility) {
      invalid("공개 범위를 확인하고 일기를 다시 저장해 주세요.");
    }
    if (version >= 3 && mutation.data.visibility === "public" && !mutation.data.images) {
      invalid("공개할 첨부 이미지 목록을 확인해 주세요.");
    }
    mutation.sharingVersion = version;
  }
  if (value.patch !== undefined) mutation.patch = validateFields(value.patch, true);
  if (value.content !== undefined) mutation.content = string(value.content, "추가할 본문", 60000, false);
  if (value.revisionVersion !== undefined) mutation.revisionVersion = finite(value.revisionVersion, "복원할 버전", 1, 2147483646, true);
  if (isSave && (mutation.data === undefined || mutation.data.body === undefined)) invalid("저장할 본문을 입력해 주세요.");
  if (mutation.operation === "append" && mutation.content === undefined) invalid("덧붙일 내용을 입력해 주세요.");
  if (mutation.operation === "append" && mutation.data?.body !== undefined) invalid("덧붙이기는 content로 본문을 입력해 주세요.");
  if (mutation.operation === "patch" && (!mutation.patch || !Object.keys(mutation.patch).length)) invalid("수정할 필드를 입력해 주세요.");
  if (mutation.operation === "restore" && mutation.revisionVersion === undefined) invalid("복원할 버전을 입력해 주세요.");
  if ((isSave && (mutation.content !== undefined || mutation.patch !== undefined || mutation.revisionVersion !== undefined)) ||
      (mutation.operation === "append" && (mutation.patch !== undefined || mutation.revisionVersion !== undefined)) ||
      (mutation.operation === "patch" && (mutation.data !== undefined || mutation.content !== undefined || mutation.revisionVersion !== undefined)) ||
      (mutation.operation === "restore" && (mutation.data !== undefined || mutation.content !== undefined || mutation.patch !== undefined)) ||
      ((mutation.operation === "delete" || mutation.operation === "undelete") && (mutation.data !== undefined || mutation.content !== undefined || mutation.patch !== undefined || mutation.revisionVersion !== undefined))) invalid("이 작업에 맞지 않는 필드가 있습니다.");
  return mutation;
}

function isListed(entry: Pick<Diary, "visibility" | "sharingVersion" | "sentiment"> | null): boolean {
  return entry?.visibility === "public" || (
    entry?.visibility === "sentiment" && entry.sharingVersion !== undefined && entry.sentiment !== null
  );
}

export function computeEntry(mutation: Mutation, current: Diary | null, restored: Diary | null, now: string): Diary {
  if (current?.deletedAt && mutation.operation !== "undelete") throw new ApiError(409, "ENTRY_IN_TRASH", "휴지통에 있는 일기입니다. 먼저 휴지통에서 복원한 후 수정해 주세요.");
  if ((mutation.operation === "delete" || mutation.operation === "undelete") && !current) throw new ApiError(404, "ENTRY_NOT_FOUND", "일기를 찾지 못했습니다.");
  if (mutation.operation === "undelete" && !current?.deletedAt) throw new ApiError(409, "ENTRY_NOT_IN_TRASH", "이미 복원된 일기입니다. 최신 기록을 다시 불러와 주세요.");
  const privacy = (entry: Diary | null): Pick<Editable, "visibility" | "shareFearGreed" | "shareEmotion" | "shareCash" | "shareTrades" | "commentsEnabled"> => ({commentsEnabled: entry?.commentsEnabled ?? true, visibility: entry?.visibility ?? "private", shareFearGreed: entry?.shareFearGreed ?? false, shareEmotion: entry?.shareEmotion ?? false, shareCash: entry?.shareCash ?? false, shareTrades: entry?.shareTrades ?? false});
  const base: Editable = current ? { ...privacy(current), title: current.title, body: current.body, sentiment: current.sentiment, emotion: current.emotion, cashRatio: current.cashRatio, trades: current.trades, fearGreed: current.fearGreed, images: current.images ?? [], insight: current.insight ?? "" } : { ...privacy(null), title: "", body: "", sentiment: null, emotion: null, cashRatio: null, trades: [], fearGreed: null, images: [], insight: "" };
  let next: Editable;
  if (mutation.operation === "delete" || mutation.operation === "undelete") next = base;
  else if (mutation.operation === "save" || mutation.operation === "create") next = { ...privacy(current), title: "", body: "", sentiment: null, emotion: null, cashRatio: null, trades: [], fearGreed: null, images: current?.images ?? [], insight: current?.insight ?? "", ...mutation.data };
  else if (mutation.operation === "append") next = { ...base, ...mutation.data, body: `${base.body}${base.body ? "\n\n" : ""}${mutation.content}` };
  else if (mutation.operation === "restore") {
    if (!restored) throw new ApiError(404, "REVISION_NOT_FOUND", "복원할 기록을 찾지 못했습니다.");
    next = { ...privacy(current), title: restored.title, body: restored.body, sentiment: restored.sentiment, emotion: restored.emotion, cashRatio: restored.cashRatio, trades: restored.trades, fearGreed: restored.fearGreed, images: restored.images ?? [], insight: restored.insight ?? "" };
  } else {
    if (!current) throw new ApiError(404, "ENTRY_NOT_FOUND", "수정할 일기가 없습니다.");
    const { replaceText, ...fields } = mutation.patch!;
    next = { ...base, ...fields };
    if (replaceText) {
      const count = base.body.split(replaceText.from).length - 1;
      if (count !== 1) throw new ApiError(409, "TEXT_MATCH_CONFLICT", count === 0 ? "교체할 원문을 찾지 못했습니다. 일기를 다시 불러와 주세요." : "같은 문장이 여러 곳에 있습니다. 교체할 범위를 더 구체적으로 지정해 주세요.");
      next.body = base.body.replace(replaceText.from, () => replaceText.to);
    }
  }
  if (next.body.length > 60000) invalid("일기 본문은 최대 60000자입니다.");

  // A new policy applies only to the scope explicitly saved in the informed editor.
  let sharingVersion = mutation.sharingVersion;
  if (!sharingVersion && current && next.visibility === current.visibility) sharingVersion = current.sharingVersion;
  if (mutation.sharingVersion && next.visibility === "sentiment") {
    if (!next.sentiment) invalid("공유할 시장 분위기를 선택해 주세요.");
    next.shareEmotion = mutation.data?.shareEmotion === true;
  }
  if (sharingVersion) {
    next.shareCash = false;
    if (next.visibility === "public") {
      next.shareEmotion = sharingVersion === 4 && (mutation.sharingVersion === 4 || current?.shareEmotion === true);
      if (mutation.sharingVersion) next.shareFearGreed = next.fearGreed !== null;
    }
  }

  if (mutation.operation === "restore" && sharingVersion) {
    if (next.visibility === "sentiment") {
      if (next.sentiment !== current?.sentiment && !isListed(restored)) {
        // The old value can return to aggregate statistics. Listing it needs a new save.
        sharingVersion = undefined;
        next.shareEmotion = false;
      }
      if (normalizeEmotion(next.emotion) !== normalizeEmotion(current?.emotion) && !(isListed(restored) && restored?.shareEmotion)) {
        next.shareEmotion = false;
      }
    }
    if (next.visibility === "public" && normalizeEmotion(next.emotion) !== normalizeEmotion(current?.emotion)
      && !(isListed(restored) && restored?.shareEmotion)) next.shareEmotion = false;
    if (next.visibility === "public" && JSON.stringify(next.fearGreed) !== JSON.stringify(current?.fearGreed)) {
      if (restored?.visibility !== "public" || !restored.shareFearGreed) next.shareFearGreed = false;
    }
  }

  // Older clients and revision restore can retain an approved attachment, but cannot approve a new one.
  const images = next.images ?? [];
  let publishedImageIds: string[] | undefined;
  if ((sharingVersion === 3 || sharingVersion === 4) && next.visibility === "public") {
    const approved = new Set(current?.publishedImageIds ?? []);
    publishedImageIds = images
      .filter(image => (mutation.sharingVersion === 3 || mutation.sharingVersion === 4) || approved.has(image.id))
      .map(image => image.id);
  }

  const wasListedInSameScope = next.visibility === current?.visibility && isListed(current);
  const publishedAt = isListed({ ...next, sharingVersion })
    ? (wasListedInSameScope ? current?.publishedAt ?? now : now)
    : null;
  return { ...next, emotion: normalizeEmotion(next.emotion), sharingVersion, publishedImageIds, publishedAt, date: mutation.date, version: mutation.expectedVersion + 1, createdAt: current?.createdAt ?? now, updatedAt: now, deletedAt: mutation.operation === "delete" ? now : null };
}
