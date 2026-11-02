import 'server-only';
export async function telegramCall(
  method: string,
  body: unknown,
  timeout = 5000,
): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Bot not configured');
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error();
    return result.result;
  } catch {
    throw new Error('Telegram operation failed');
  }
}
