import { errorResponse, json, ownerId } from "../../lib/server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await ownerId();
    return json({ status: "unavailable", value: null, asOf: null, source: "CNN Fear & Greed Index", sourceUrl: "https://edition.cnn.com/markets/fear-and-greed", message: "자동으로 검증할 수 있는 CNN 지수 연결이 없습니다. CNN 공식 페이지에서 지수를 확인해 선택적으로 기록해 주세요." });
  } catch (error) { return errorResponse(error); }
}
