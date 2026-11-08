import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('curriculum_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  const pack = data?.packages?.find(
    (p: { package: string }) => p.package === 'english-path-core',
  );
  if (
    error ||
    data?.ready !== true ||
    data?.version !== 'curriculum-v2' ||
    !pack ||
    pack.revision < 9 ||
    pack.lessons < 248 ||
    pack.exercises < 2140
  )
    throw Error();
  console.log(
    `PASS: curriculum-v2; package revision ${pack.revision}; ${pack.lessons} lessons/${pack.exercises} exercises; private import verified.`,
  );
} catch {
  console.error(
    'Curriculum not ready. Apply modular_curriculum_import and import the checked library package. Details redacted.',
  );
  process.exitCode = 1;
}
