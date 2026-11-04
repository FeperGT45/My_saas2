import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw Error('Supabase server configuration required');
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db.rpc('story_database_status');
if (error || data?.version !== 'stories-v1' || data?.ready !== true)
  throw Error('Stories schema/content is not ready');
console.log('Stories ready:', data.published);
