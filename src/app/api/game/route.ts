import { lessonRequest, json, rpcError } from '@/lib/lessons/http';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    const { data, error } = await db.rpc('game_summary', { p_user: userId });
    return error ? rpcError(error) : json(data);
  });
}
