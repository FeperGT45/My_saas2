import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .rpc('support_database_status')
    .abortSignal(AbortSignal.timeout(15000));
  if (error || data?.version !== 'support-tickets-v1' || data.ready !== true)
    throw Error();
  console.log(
    'PASS: support-tickets-v1; private support tickets and durable replies ready.',
  );
} catch {
  console.error(
    'Support schema not ready. Apply telegram_support_tickets; details redacted.',
  );
  process.exitCode = 1;
}
