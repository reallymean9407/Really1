import { communityFeed } from "../../lib/community";
import { errorResponse, json } from "../../lib/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{return json(await communityFeed(new URL(request.url).searchParams));}catch(error){return errorResponse(error);}}
