import { recordOpsError } from '@/lib/ops/events';
import { handleStarsWebhook } from '@/lib/billing/webhook';
import { telegramCall } from '@/lib/billing/telegram';
import { readBodyText } from '@/lib/auth/body';
import { equalSecret } from '@/lib/auth/security';
import { startMessage, startReply } from '@/lib/telegram/bot';
import { handleSupportWebhook } from '@/lib/support/server';
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
  let paymentEvent = false;
  try {
    const raw = await readBodyText(request, 32768);
    if (raw.length > 32768) return new Response(null, { status: 413 });
    const update = JSON.parse(raw);
    paymentEvent = Boolean(
      update?.pre_checkout_query ||
      update?.message?.successful_payment ||
      update?.message?.refunded_payment,
    );
    if (await handleStarsWebhook(update)) return Response.json({ ok: true });
    if (await handleSupportWebhook(update)) return Response.json({ ok: true });
    const message = update.message;
    if (
      message?.chat?.type === 'private' &&
      message.chat.id === message.from?.id &&
      /^\/(terms|privacy|delete_account)(?:@\w+)?(?:\s|$)/.test(
        message.text ?? '',
      )
    ) {
      if (/^\/(privacy|delete_account)(?:@\w+)?(?:\s|$)/.test(message.text)) {
        await telegramCall('sendMessage', {
          chat_id: message.chat.id,
          text:
            'Конфиденциальность и запрос удаления аккаунта: ' +
            new URL('/privacy', process.env.APP_URL).href +
            '\nЗаявка отправляется после входа в Mini App. Если вход недоступен, создай тикет в этом боте: /support',
        });
        return Response.json({ ok: true });
      }
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
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          ...startReply(process.env.APP_URL),
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error();
    return Response.json({ ok: true });
  } catch {
    await recordOpsError(paymentEvent ? 'payment_webhook' : 'telegram_webhook');
    return Response.json({ error: 'Unable to handle update' }, { status: 503 });
  }
}
