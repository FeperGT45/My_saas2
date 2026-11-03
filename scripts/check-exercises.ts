import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('exercise_engine_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (
    error ||
    !data ||
    data.ready !== true ||
    data.version !== 'interactive-v2' ||
    data.kinds !== 21
  )
    throw new Error();
  console.log(
    `PASS: exercise engine interactive-v2; 21 formats; private grading and RPC permissions verified.`,
  );
} catch {
  console.error(
    'Exercise engine is not ready. Apply interactive_exercise_types; details redacted.',
  );
  process.exitCode = 1;
}
