export function miniAppUrl(value: string | undefined) {
  if (!value) throw new Error('APP_URL is required');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'APP_URL must be a public HTTPS URL without query or credentials',
    );
  return url.href;
}
export function startMessage(text: string, botUsername: string) {
  const command = text.split(/\s/)[0];
  return (
    command === '/start' ||
    command.toLowerCase() === `/start@${botUsername.toLowerCase()}`
  );
}

export function supportMessage(text: string, botUsername: string) {
  const command = text.trim().split(/\s/)[0].toLowerCase();
  for (const name of ['support', 'paysupport'] as const) {
    if (
      command === `/${name}` ||
      command === `/${name}@${botUsername.toLowerCase()}`
    )
      return name;
  }
  return null;
}
export function startReply(value: string | undefined) {
  return {
    text: 'Привет! Это Voklumi — твоя языковая вселенная. Начнём с одного нового слова?\n\nНашёл баг или есть идея? Напиши в поддержку кнопкой ниже.',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть Voklumi ✦', web_app: { url: miniAppUrl(value) } }],
        [{ text: 'Написать в поддержку', callback_data: 'support:new' }],
      ],
    },
  };
}
