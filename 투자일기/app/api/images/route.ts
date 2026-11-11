import { errorResponse, json, ownerId, sameOrigin, uploadImage } from "../../lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await ownerId();
    sameOrigin(request);
    return json({ image: await uploadImage(userId, request) }, 201);
  } catch (error) { return errorResponse(error); }
}
