import 'server-only';
import { createClient } from '@supabase/supabase-js';
/** Internal job/grader only. Do not wrap in a public Server Action or route accepting client completion claims. */
export async function awardVerifiedAttempt(
  attemptId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attemptId))
    throw new Error('Invalid attempt ID');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('Supabase server credentials are not configured');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('award_completed_lesson', {
    p_attempt_id: attemptId,
  });
  if (error) throw new Error('Unable to award verified attempt');
  return data === true;
}
