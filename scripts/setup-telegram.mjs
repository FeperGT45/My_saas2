// Run explicitly after deployment. Credentials come from environment, never command arguments.
const token = process.env.TELEGRAM_BOT_TOKEN,
  secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = new URL(process.env.APP_URL ?? '');
if (
  !token ||
  !secret ||
  !/^[a-zA-Z0-9_-]{32,256}$/.test(secret) ||
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  ['localhost', '127.0.0.1'].includes(url.hostname)
)
  throw new Error(
    'Configure bot token, HTTPS APP_URL and random webhook secret first',
  );
// No token or secret is logged, including API failures.
async function call(method, body) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error();
    return result.result;
  } catch {
    throw new Error(`Telegram ${method} failed (details redacted)`);
  }
}
await call('setMyName', { name: 'Voklumi' });
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Открыть Voklumi' },
    {
      command: 'support',
      description: 'Написать в поддержку: ошибки, баги, советы',
    },
    { command: 'tickets', description: 'Мои заявки поддержки' },
    { command: 'cancel', description: 'Выйти из переписки с поддержкой' },
    { command: 'paysupport', description: 'Помощь с покупками' },
    { command: 'terms', description: 'Условия покупки' },
    { command: 'privacy', description: 'Конфиденциальность и удаление данных' },
  ],
});
await call('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'Открыть Voklumi',
    web_app: { url: url.href },
  },
});
await call('setWebhook', {
  url: new URL('/api/telegram/webhook', url).href,
  secret_token: secret,
  allowed_updates: ['message', 'pre_checkout_query', 'callback_query'],
  drop_pending_updates: false,
});
const commands = await call('getMyCommands', {});
if (
  !Array.isArray(commands) ||
  !['support', 'tickets', 'cancel', 'paysupport'].every((name) =>
    commands.some((c) => c.command === name),
  )
)
  throw new Error('Telegram support command was not confirmed.');
const webhook = await call('getWebhookInfo', {});
if (
  webhook.url !== new URL('/api/telegram/webhook', url).href ||
  !['message', 'pre_checkout_query', 'callback_query'].every((type) =>
    webhook.allowed_updates?.includes(type),
  )
)
  throw new Error('Telegram payment webhook configuration was not confirmed.');
console.log(
  'Voklumi bot, general and payment support commands and message/pre-checkout/callback webhook verified.',
);
