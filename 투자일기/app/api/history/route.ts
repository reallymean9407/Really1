import { entryHistory, errorResponse, json, ownerId } from "../../lib/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = await ownerId();
    const params = new URL(request.url).searchParams;
    return json({ revisions: await entryHistory(userId, params.get("date") ?? "", params.get("entryId") ?? undefined) });
  } catch (error) { return errorResponse(error); }
}
