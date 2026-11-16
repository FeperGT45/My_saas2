/** Only call after authenticating the Telegram webhook secret. Never accepts browser identities. */
export type SupportInput = {
  update: number;
  actor: number;
  action: string;
  text: string;
  ticket: number | null;
  callbackId?: string;
};
type TelegramMessage = {
  chat?: { id?: number; type?: string };
  from?: { id?: number; is_bot?: boolean };
  text?: unknown;
};
export function supportInput(value: unknown, bot: string): SupportInput | null {
  if (!value || typeof value !== 'object') return null;
  const update = value as {
    update_id?: number;
    message?: TelegramMessage;
    callback_query?: {
      id?: string;
      from?: TelegramMessage['from'];
      message?: TelegramMessage;
      data?: string;
    };
  };
  const callback = update.callback_query;
  const message = callback?.message ?? update.message;
  const actor = callback?.from ?? message?.from;
  if (
    !Number.isSafeInteger(update.update_id) ||
    update.update_id! < 0 ||
    !Number.isSafeInteger(actor?.id) ||
    actor!.id! <= 0 ||
    actor?.is_bot ||
    message?.chat?.type !== 'private' ||
    message.chat.id !== actor?.id
  )
    return null;
  const base = {
    update: update.update_id!,
    actor: actor!.id!,
    text: '',
    ticket: null,
  };
  if (callback) {
    if (callback.data !== 'support:new' || typeof callback.id !== 'string')
      return null;
    return { ...base, action: 'begin', callbackId: callback.id };
  }
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const match = /^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text);
  if (match) {
    if (match[2] && match[2].toLowerCase() !== bot.toLowerCase()) return null;
    const command = match[1].toLowerCase(),
      rest = match[3] ?? '';
    const action = (
      {
        support: 'begin',
        paysupport: 'payment',
        start: 'reset',
        cancel: 'cancel',
        tickets: 'list',
      } as Record<string, string>
    )[command];
    if (action) return { ...base, action };
    if (['ticket', 'reply', 'close'].includes(command)) {
      const args = /^(\d{1,15})(?:\s+([\s\S]*))?$/.exec(rest);
      const ticket = Number(args?.[1]);
      if (
        !args ||
        !Number.isSafeInteger(ticket) ||
        ticket <= 0 ||
        (command === 'reply' && !args[2]) ||
        (command !== 'reply' && args[2])
      )
        return { ...base, action: 'invalid' };
      const body = args[2] ?? '';
      return {
        ...base,
        ticket,
        action:
          body.length > 3000
            ? 'invalid'
            : command === 'ticket'
              ? 'view'
              : command,
        text: body.length > 3000 ? '' : body,
      };
    }
    return null;
  }
  if (text.startsWith('/')) return null;
  return {
    ...base,
    action: text.length > 3000 ? 'invalid' : 'append',
    text: text.length > 3000 ? '' : text,
  };
}
