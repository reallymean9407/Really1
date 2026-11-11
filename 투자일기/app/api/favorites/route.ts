import { boundedJson, errorResponse, json, ownerId, sameOrigin, setFavorite } from "../../lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await ownerId();
    sameOrigin(request);
    const payload = await boundedJson(request);
    return json(await setFavorite(userId, payload));
  } catch (error) { return errorResponse(error); }
}
