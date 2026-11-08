/** Telegram Web embeds the app cross-site. CHIPS keeps its session isolated by top-level site. */
export function sessionCookieNames(production: boolean) {
  return production
    ? { name: '__Host-voklumi_session_v2', legacy: '__Host-voklumi_session' }
    : { name: 'voklumi_session', legacy: 'voklumi_session_legacy' };
}
export function sessionCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? ('none' as const) : ('lax' as const),
    ...(production ? { partitioned: true } : {}),
    path: '/',
    maxAge: 86400,
  };
}
