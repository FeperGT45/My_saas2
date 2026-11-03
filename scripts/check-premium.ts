import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('premium_permissions_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (error || data?.version !== 'permissions-v1' || data.ready !== true)
    throw Error();
  console.log(
    'PASS: Premium permissions-v1; schema, feature catalog and client restrictions verified.',
  );
} catch {
  console.error(
    'Premium permissions are not ready. Apply premium_permissions; details redacted.',
  );
  process.exitCode = 1;
}
