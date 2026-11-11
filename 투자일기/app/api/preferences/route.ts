import { ApiError, boundedJson, database, errorResponse, json, ownerId, sameOrigin } from "../../lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await ownerId();
    const row = await database().prepare(
      "SELECT target_cash_ratio AS targetCashRatio FROM journal_preferences WHERE user_id = ?",
    ).bind(userId).first<{ targetCashRatio: number }>();
    return json({ targetCashRatio: row?.targetCashRatio ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await ownerId();
    sameOrigin(request);
    const payload = await boundedJson(request);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)
      || Object.keys(payload).length !== 1 || !("targetCashRatio" in payload)) {
      throw new ApiError(400, "INVALID_INPUT", "목표 현금 비중을 확인해 주세요.");
    }
    const { targetCashRatio } = payload;
    if (targetCashRatio === null) {
      await database().prepare("DELETE FROM journal_preferences WHERE user_id = ?").bind(userId).run();
    } else {
      if (typeof targetCashRatio !== "number" || !Number.isInteger(targetCashRatio)
        || targetCashRatio < 0 || targetCashRatio > 100) {
        throw new ApiError(400, "INVALID_INPUT", "목표 현금 비중은 0에서 100 사이의 정수로 입력해 주세요.");
      }
      await database().prepare(
        "INSERT INTO journal_preferences (user_id, target_cash_ratio) VALUES (?, ?) "
        + "ON CONFLICT(user_id) DO UPDATE SET target_cash_ratio = excluded.target_cash_ratio",
      ).bind(userId, targetCashRatio).run();
    }
    return json({ targetCashRatio });
  } catch (error) {
    return errorResponse(error);
  }
}
