import { handleStarsWebhook } from '@/lib/billing/webhook';
import { telegramCall } from '@/lib/billing/telegram';
import { readBodyText } from '@/lib/auth/body';
import { equalSecret } from '@/lib/auth/security';
import { miniAppUrl, startMessage } from '@/lib/telegram/bot';
import { premiumSupportUrl } from '@/lib/billing/plans';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN,
    secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return new Response(null, { status: 503 });
  if (
    !equalSecret(
      request.headers.get('x-telegram-bot-api-secret-token') ?? '',
      secret,
    )
  )
    return new Response(null, { status: 403 });
  try {
    const raw = await readBodyText(request, 32768);
    if (raw.length > 32768) return new Response(null, { status: 413 });
    const update = JSON.parse(raw);
    if (await handleStarsWebhook(update)) return Response.json({ ok: true });
    const message = update.message;
    if (
      message?.chat?.type === 'private' &&
      message.chat.id === message.from?.id &&
      /^\/(paysupport|support|terms)(?:@\w+)?(?:\s|$)/.test(message.text ?? '')
    ) {
      const isTerms = message.text.startsWith('/terms');
      const url = isTerms ? process.env.PREMIUM_TERMS_URL : premiumSupportUrl;
      await telegramCall('sendMessage', {
        chat_id: message.chat.id,
        text: url
          ? (isTerms ? 'Условия покупки: ' : 'Поддержка покупок Voklumi: ') +
            url
          : 'Платные покупки пока выключены. Условия и канал поддержки ещё готовятся.',
      });
      return Response.json({ ok: true });
    }
    if (
      !message ||
      message.chat?.type !== 'private' ||
      typeof message.text !== 'string' ||
      !Number.isSafeInteger(message.chat.id) ||
      message.chat.id !== message.from?.id ||
      !startMessage(
        message.text,
        process.env.TELEGRAM_BOT_USERNAME ?? 'Voklumi_bot',
      )
    )
      return Response.json({ ok: true });
    const url = miniAppUrl(process.env.APP_URL);
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: 'Привет! Это Voklumi — твоя языковая вселенная. Начнём с одного нового слова?',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Открыть Voklumi ✦', web_app: { url } }],
            ],
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Unable to handle update' }, { status: 503 });
  }
}
