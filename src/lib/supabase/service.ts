import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { readServiceConfiguration } from './config';
/** Internal service-role client; callers must authenticate and scope every user operation. */
export function createServiceClient() {
  const { url, serviceKey } = readServiceConfiguration(process.env);
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(15000),
          ]),
        }),
    },
  });
}
