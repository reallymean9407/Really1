import { getProfile, updateProfile } from "../../lib/community";
import { boundedJson,errorResponse,json,ownerId,sameOrigin } from "../../lib/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{return json(await getProfile(new URL(request.url).searchParams.get("id")));}catch(error){return errorResponse(error);}}
export async function PUT(request:Request){try{const userId=await ownerId();sameOrigin(request);return json(await updateProfile(userId,await boundedJson(request)));}catch(error){return errorResponse(error);}}
