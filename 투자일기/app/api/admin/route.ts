import { communityFeed,moderate } from "../../lib/community";
import { boundedJson,errorResponse,json,sameOrigin } from "../../lib/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{return json(await communityFeed(new URL(request.url).searchParams,true));}catch(error){return errorResponse(error);}}
export async function PUT(request:Request){try{sameOrigin(request);return json(await moderate(await boundedJson(request)));}catch(error){return errorResponse(error);}}
