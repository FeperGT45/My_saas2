import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('weekly_plan_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (error || data?.version !== 'weekly-v1' || data.ready !== true)
    throw Error();
  console.log(
    'PASS: Weekly plan weekly-v1; schema and client restrictions verified.',
  );
} catch {
  console.error(
    'Weekly plans are not ready. Apply weekly_premium_plans; details redacted.',
  );
  process.exitCode = 1;
}
