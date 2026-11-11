import { setLike } from "../../lib/community";
import { boundedJson,errorResponse,json,ownerId,sameOrigin } from "../../lib/server";
export const dynamic="force-dynamic";
export async function PUT(request:Request){try{const userId=await ownerId();sameOrigin(request);return json(await setLike(userId,await boundedJson(request)));}catch(error){return errorResponse(error);}}
