/** Only decides whether a server-verified session needs refreshing, never grants access. */
export function matchesLaunchAccount(
  account: { mode: string; telegramId: string | null } | null,
  initData: string,
) {
  if (account?.mode !== 'telegram' || !account.telegramId) return false;
  try {
    const user = JSON.parse(
      new URLSearchParams(initData).get('user') ?? 'null',
    );
    return (
      Number.isSafeInteger(user?.id) &&
      user.id > 0 &&
      String(user.id) === account.telegramId
    );
  } catch {
    return false;
  }
}
