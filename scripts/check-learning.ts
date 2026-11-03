import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('learning_path_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (
    error ||
    !data ||
    data.ready !== true ||
    data.version !== 'rules-v1' ||
    data.tables !== 2
  )
    throw new Error();
  console.log(
    `PASS: learning rules-v1; private tables and RPC permissions verified.`,
  );
} catch {
  console.error(
    'Learning plans are not ready. Apply the personal_learning_paths migration; details redacted.',
  );
  process.exitCode = 1;
}
