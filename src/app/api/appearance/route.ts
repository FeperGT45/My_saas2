import { lessonRequest, json, rpcError } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { appearanceValid } from '@/lib/premium/appearance';
export async function GET(r: Request) {
  return lessonRequest(r, false, async (u, db) => {
    const { data, error } = await db.rpc('appearance_read', { p_user: u });
    return error ? rpcError(error) : json(data);
  });
}
export async function POST(r: Request) {
  return lessonRequest(r, true, async (u, db) => {
    let b;
    try {
      if (!r.headers.get('content-type')?.startsWith('application/json'))
        throw Error();
      b = JSON.parse(await readBodyText(r, 4096));
      if (
        Object.keys(b).sort().join() !== 'settings,version' ||
        !appearanceValid(b.settings) ||
        !Number.isInteger(b.version) ||
        b.version < 0
      )
        throw Error();
    } catch {
      return json({ error: 'Проверь оформление.' }, 400);
    }
    const { data, error } = await db.rpc('appearance_save', {
      p_user: u,
      p_data: b.settings,
      p_version: b.version,
    });
    return error
      ? error.message.includes('conflict')
        ? json({ error: 'Оформление изменилось. Обнови страницу.' }, 409)
        : rpcError(error)
      : json(data);
  });
}
