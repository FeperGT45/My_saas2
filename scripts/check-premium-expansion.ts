import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw Error('Server database configuration required');
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db.rpc('premium_expansion_status');
if (
  error ||
  data?.version !== 'premium-expansion-v1' ||
  data?.starPlans !== 'week-month-v1' ||
  data?.ready !== true
)
  throw Error('Premium expansion schema not ready');
console.log('Appearance and extended assessment ready.');
