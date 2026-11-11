import { boundedJson, connectionState, errorResponse, ownFavorites, json, listEntries, listTrashEntries, mutateEntry, ownerId, sameOrigin, trashCount } from "../../lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await ownerId();
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? undefined;
    const [entries, connection, deletedCount, favorites] = await Promise.all([params.get("trash") === "true" ? listTrashEntries(userId, date) : listEntries(userId, date), connectionState(userId), trashCount(userId), ownFavorites(userId)]);
    return json({ entries, connection, trashCount: deletedCount, ...favorites });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const userId = await ownerId();
    sameOrigin(request);
    const payload = await boundedJson(request);
    return json(await mutateEntry(userId, payload, new URL(request.url).origin));
  } catch (error) { return errorResponse(error); }
}
