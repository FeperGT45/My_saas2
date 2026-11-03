import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('placement_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (
    error ||
    !data ||
    data.ready !== true ||
    data.version !== 'grid-irt-v1' ||
    !Number.isInteger(data.questions) ||
    data.questions < 120 ||
    data.tables !== 5
  )
    throw new Error();
  console.log(
    `PASS: placement grid-irt-v1; ${data.questions} questions; private tables and RPC permissions verified.`,
  );
} catch {
  console.error(
    'Placement is not ready. Apply the placement migration and import its question bank; details redacted.',
  );
  process.exitCode = 1;
}
