import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Per-request JWT client. Never shares authentication between requests. */
async function authenticatedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  if (!accessToken) throw new Error('Authentication required');
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new Error('Invalid session');
  return { client, userId: data.user.id };
}

/** Caller supplies a Supabase Auth access token, never Telegram initData or a user ID. */
export async function getMyLearningSummary(accessToken: string) {
  const { client, userId } = await authenticatedClient(accessToken);
  const results = await Promise.all([
    client
      .from('users')
      .select('id,display_name,locale')
      .eq('id', userId)
      .maybeSingle(),
    client
      .from('user_progress')
      .select('lesson_id,best_score,completed_at')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(100),
    client
      .from('subscriptions')
      .select('plan,status,starts_at,ends_at')
      .eq('user_id', userId)
      .order('ends_at', { ascending: false })
      .limit(10),
  ]);
  if (results.some((result) => result.error))
    throw new Error('Unable to load learning summary');
  return {
    profile: results[0].data,
    progress: results[1].data,
    subscriptions: results[2].data,
  };
}

export async function getPublishedCourses() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from('courses')
    .select('id,language_id,slug,title,level')
    .eq('published', true)
    .order('title')
    .limit(100);
  if (error) throw new Error('Unable to load courses');
  return data;
}
