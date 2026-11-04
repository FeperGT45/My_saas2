import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('english_analytics_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (error || data?.version !== 'analytics-v1' || data.ready !== true)
    throw Error();
  console.log(
    'PASS: English analytics analytics-v1; schema and client restrictions verified.',
  );
} catch {
  console.error(
    'English analytics is not ready. Apply english_analytics; details redacted.',
  );
  process.exitCode = 1;
}
