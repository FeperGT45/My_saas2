export function telegramInviteUrl(
  code: string,
  bot = 'Voklumi_bot',
  app?: string,
) {
  if (
    !/^[a-f0-9]{32}$/.test(code) ||
    !/^[a-zA-Z0-9_]{5,32}$/.test(bot) ||
    (app && !/^[a-zA-Z0-9_]{1,64}$/.test(app))
  )
    throw new Error('Invalid invitation configuration');
  const url = new URL(`https://t.me/${bot}${app ? '/' + app : ''}`);
  url.searchParams.set('startapp', `r_${code}`);
  return url.href;
}
