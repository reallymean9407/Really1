import { listComments, mutateComment } from "../../lib/community";
import { boundedJson, errorResponse, json, ownerId, sameOrigin } from "../../lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return json(await listComments(new URL(request.url).searchParams)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await ownerId();
    sameOrigin(request);
    return json(await mutateComment(userId,await boundedJson(request)));
  } catch (error) { return errorResponse(error); }
}
