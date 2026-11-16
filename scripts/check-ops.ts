import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('privacy_ops_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (error || data?.version !== 'privacy-ops-v3' || data.ready !== true)
    throw Error();
  console.log(
    'PASS: privacy-ops-v3; private requests, error counters and notification leases ready.',
  );
} catch {
  console.error(
    'Privacy/operations schema not ready. Apply privacy_and_operations; details redacted.',
  );
  process.exitCode = 1;
}
