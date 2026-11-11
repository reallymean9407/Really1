import { errorResponse, imageResponse, ownerId, publicImageResponse } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const postId = new URL(request.url).searchParams.get("postId");
    if (postId !== null) return await publicImageResponse(id, postId);
    return await imageResponse(await ownerId(), id);
  } catch (error) { return errorResponse(error); }
}
