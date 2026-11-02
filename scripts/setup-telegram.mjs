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
  commands: [{ command: 'start', description: 'Открыть Voklumi' }],
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
  allowed_updates: ['message'],
  drop_pending_updates: false,
});
console.log('Voklumi bot name, /start, menu button and webhook configured.');
