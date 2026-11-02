/** Pure validation shared by server-only entry points and the operator CLI. No environment reads here. */
export type SupabaseEnvironment = Record<string, string | undefined>;
export class SupabaseConfigurationError extends Error {
  constructor(public readonly variable: string) {
    super(`Missing or invalid configuration: ${variable}`);
  }
}
export function validatePublicKey(key: string) {
  key = key.trim();
  if (key.startsWith('sb_secret_'))
    throw new SupabaseConfigurationError(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(
        atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
      );
      if (payload.role === 'service_role')
        throw new SupabaseConfigurationError(
          'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        );
    } catch (error) {
      if (error instanceof SupabaseConfigurationError) throw error;
    }
  }
  return key;
}
export function readServiceConfiguration(env: SupabaseEnvironment) {
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  } catch {
    throw new SupabaseConfigurationError('NEXT_PUBLIC_SUPABASE_URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && local && env.NODE_ENV !== 'production')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new SupabaseConfigurationError('NEXT_PUBLIC_SUPABASE_URL');
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publicKey) validatePublicKey(publicKey);
  const serviceKey =
    env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey)
    throw new SupabaseConfigurationError(
      'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY',
    );
  if (serviceKey.startsWith('sb_publishable_'))
    throw new SupabaseConfigurationError(
      'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY',
    );
  return { url: url.origin, serviceKey };
}
