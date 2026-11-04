import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('dictionary_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (
    error ||
    data?.version !== 'dictionary-v1' ||
    data.ready !== true ||
    data.publishedAudio !== 0
  )
    throw Error();
  console.log(
    'PASS: Dictionary dictionary-v1; schema and client restrictions verified.',
  );
} catch {
  console.error(
    'Dictionary is not ready. Apply personal_dictionary_and_retire_audio; details redacted.',
  );
  process.exitCode = 1;
}
