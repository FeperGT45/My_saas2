import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { supportInput } from '../../src/lib/support/input';
const db = new PGlite();
let update = 100;
async function act(
  actor: number,
  action: string,
  text = '',
  ticket: number | null = null,
  admin = false,
  id = ++update,
) {
  const hash = createHash('sha256')
    .update(JSON.stringify([actor, action, text, ticket]))
    .digest('hex');
  return (
    await db.query<{ v: boolean }>(
      'SELECT public.process_support_update($1,$2,$3,$4,$5,$6,$7,$8) v',
      [id, actor, hash, action, text, ticket, admin, [900]],
    )
  ).rows[0].v;
}
async function ticketFor(actor: number) {
  return Number(
    (
      await db.query<{ ticket_no: number }>(
        'SELECT ticket_no FROM public.support_tickets WHERE telegram_id=$1 ORDER BY ticket_no DESC LIMIT 1',
        [actor],
      )
    ).rows[0].ticket_no,
  );
}
beforeAll(async () => {
  await db.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
  );
  const file = (await readdir('supabase/migrations')).find((x) =>
    x.endsWith('_telegram_support_tickets.sql'),
  )!;
  await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
}, 30000);
afterAll(() => db.close());
it('accepts only private webhook identities and own-bot commands', () => {
  const event = {
    update_id: 1,
    message: {
      chat: { id: 123, type: 'private' },
      from: { id: 123 },
      text: '/support@Voklumi_bot',
    },
  };
  expect(supportInput(event, 'Voklumi_bot')?.action).toBe('begin');
  expect(
    supportInput(
      { ...event, message: { ...event.message, from: { id: 999 } } },
      'Voklumi_bot',
    ),
  ).toBeNull();
  expect(
    supportInput(
      {
        ...event,
        message: { ...event.message, chat: { id: 123, type: 'group' } },
      },
      'Voklumi_bot',
    ),
  ).toBeNull();
  expect(
    supportInput(
      { ...event, message: { ...event.message, text: '/support@otherbot' } },
      'Voklumi_bot',
    ),
  ).toBeNull();
  expect(supportInput({ ...event, update_id: -1 }, 'Voklumi_bot')).toBeNull();
});
it('parses callbacks, commands and rejects oversized texts without silently truncating', () => {
  const message = {
    chat: { id: 123, type: 'private' },
    from: { id: 123 },
    text: '/reply 17 Ответ\nдва',
  };
  expect(supportInput({ update_id: 1, message }, 'bot')).toMatchObject({
    action: 'reply',
    ticket: 17,
    text: 'Ответ\nдва',
  });
  for (const text of [
    '/reply 0 test',
    '/close 17 garbage',
    'x'.repeat(3001),
    '/ticket abc',
  ])
    expect(
      supportInput({ update_id: 2, message: { ...message, text } }, 'bot')
        ?.action,
    ).toBe('invalid');
  expect(
    supportInput(
      {
        update_id: 3,
        callback_query: {
          id: 'cb',
          from: { id: 123 },
          message,
          data: 'support:new',
        },
      },
      'bot',
    ),
  ).toMatchObject({ action: 'begin', callbackId: 'cb' });
  expect(
    supportInput(
      {
        update_id: 3,
        callback_query: {
          id: 'cb',
          from: { id: 999 },
          message,
          data: 'support:new',
        },
      },
      'bot',
    ),
  ).toBeNull();
});
it('ignores unrelated chats and preserves draft across restarts', async () => {
  expect(await act(101, 'append', 'hello')).toBe(false);
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_updates WHERE telegram_id=101',
      )
    ).rows,
  ).toHaveLength(0);
  await act(101, 'begin');
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_sessions WHERE telegram_id=101',
      )
    ).rows,
  ).toHaveLength(1);
  await act(101, 'append', 'Ошибка при открытии урока');
  const no = await ticketFor(101);
  expect(
    (
      await db.query(
        'SELECT body FROM public.support_messages WHERE ticket_no=$1',
        [no],
      )
    ).rows,
  ).toEqual([{ body: 'Ошибка при открытии урока' }]);
  expect(
    (
      await db.query(
        'SELECT body FROM public.support_outbox WHERE staff_only AND body LIKE $1',
        ['%тикет #' + no + '%'],
      )
    ).rows,
  ).toHaveLength(1);
});
it('deduplicates retries and rejects update reuse with a different payload', async () => {
  await act(102, 'payment');
  const id = ++update;
  await act(102, 'append', 'Покупка не появилась', null, false, id);
  const before = (
    await db.query('SELECT count(*) n FROM public.support_outbox')
  ).rows;
  await act(102, 'append', 'Покупка не появилась', null, false, id);
  expect(
    (await db.query('SELECT count(*) n FROM public.support_outbox')).rows,
  ).toEqual(before);
  expect(
    (
      await db.query(
        "SELECT * FROM public.support_messages WHERE body='Покупка не появилась'",
      )
    ).rows,
  ).toHaveLength(1);
  await expect(act(103, 'append', 'Подмена', null, false, id)).rejects.toThrow(
    /conflict/,
  );
});
it('requires ownership or server admin authorization for history, closing and responses', async () => {
  const no = await ticketFor(101);
  await act(103, 'view', '', no);
  await act(103, 'close', '', no);
  await act(103, 'reply', 'hack', no);
  await act(101, 'reply', 'hack', no);
  expect(
    (
      await db.query(
        'SELECT status FROM public.support_tickets WHERE ticket_no=$1',
        [no],
      )
    ).rows[0],
  ).toEqual({ status: 'open' });
  expect(
    (await db.query("SELECT * FROM public.support_messages WHERE body='hack'"))
      .rows,
  ).toHaveLength(0);
  const stranger = await db.query<{ body: string }>(
    'SELECT body FROM public.support_outbox WHERE chat_id=103',
  );
  expect(
    stranger.rows.every((x) => !x.body.includes('Ошибка при открытии урока')),
  ).toBe(true);
  await act(900, 'view', '', no, true);
  await act(900, 'reply', 'Мы исправили ошибку', no, true);
  expect(
    (
      await db.query(
        "SELECT body FROM public.support_outbox WHERE chat_id=101 AND body LIKE 'Поддержка ·%'",
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        'SELECT status FROM public.support_tickets WHERE ticket_no=$1',
        [no],
      )
    ).rows[0],
  ).toEqual({ status: 'answered' });
  await act(101, 'append', 'Спасибо');
  expect(
    (
      await db.query(
        'SELECT status FROM public.support_tickets WHERE ticket_no=$1',
        [no],
      )
    ).rows[0],
  ).toEqual({ status: 'open' });
});
it('supports cancel, start, own history and resuming without creating another ticket', async () => {
  const no = await ticketFor(101);
  await act(101, 'cancel');
  expect(await act(101, 'append', 'not retained')).toBe(false);
  await act(101, 'view', '', no);
  await act(101, 'append', 'Дополнение');
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_tickets WHERE telegram_id=101',
      )
    ).rows,
  ).toHaveLength(1);
  expect(await act(101, 'reset')).toBe(false);
  expect(await act(101, 'append', 'not retained')).toBe(false);
  await act(101, 'list');
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_messages WHERE ticket_no=$1',
        [no],
      )
    ).rows,
  ).toHaveLength(4);
});
it('closes idempotently and never writes to a closed ticket', async () => {
  const no = await ticketFor(101);
  await act(101, 'close', '', no);
  await act(101, 'close', '', no);
  await act(900, 'reply', 'must not be delivered', no, true);
  expect(
    (
      await db.query(
        "SELECT * FROM public.support_messages WHERE body='must not be delivered'",
      )
    ).rows,
  ).toHaveLength(0);
});
it('limits new tickets and flooding while keeping histories available', async () => {
  for (let i = 0; i < 4; i++) {
    await act(104, 'begin');
    await act(104, 'append', 'Тест ' + i);
  }
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_tickets WHERE telegram_id=104',
      )
    ).rows,
  ).toHaveLength(3);
  const no = await ticketFor(104);
  await act(104, 'view', '', no);
  for (let i = 0; i < 25; i++) await act(104, 'append', 'Дополнение ' + i);
  expect(
    Number(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) n FROM public.support_messages m JOIN public.support_tickets t USING(ticket_no) WHERE t.telegram_id=104',
        )
      ).rows[0].n,
    ),
  ).toBe(20);
});
it('does not accept attachments as an empty ticket and expires abandoned sessions', async () => {
  await act(105, 'begin');
  await act(105, 'append', '');
  expect(
    (
      await db.query(
        'SELECT * FROM public.support_tickets WHERE telegram_id=105',
      )
    ).rows,
  ).toHaveLength(0);
  await db.exec(
    "UPDATE public.support_sessions SET expires_at=now()-interval '1 second' WHERE telegram_id=105",
  );
  expect(await act(105, 'append', 'not retained')).toBe(false);
});
it('outbox leases prevent parallel sends and retry failures without losing saved messages', async () => {
  const claim = async () =>
    (
      await db.query<{ v: { id: string; lease: string } }>(
        'SELECT row_to_json(x) v FROM public.claim_support_delivery(NULL) x',
      )
    ).rows[0]?.v;
  const a = await claim(),
    b = await claim();
  expect(a.id).not.toBe(b.id);
  await db.query('SELECT public.complete_support_delivery($1,$2,true)', [
    a.id,
    crypto.randomUUID(),
  ]);
  expect(
    (
      await db.query<{ sent_at: string | null }>(
        'SELECT sent_at FROM public.support_outbox WHERE id=$1',
        [a.id],
      )
    ).rows[0],
  ).toEqual({ sent_at: null });
  await db.query('SELECT public.complete_support_delivery($1,$2,false)', [
    a.id,
    a.lease,
  ]);
  await db.query(
    "UPDATE public.support_outbox SET reserved_until=now()-interval '1 second' WHERE id=$1",
    [a.id],
  );
  const retry = await claim();
  expect(retry.id).toBe(a.id);
  expect(retry.lease).not.toBe(a.lease);
  await db.query('SELECT public.complete_support_delivery($1,$2,true)', [
    retry.id,
    retry.lease,
  ]);
  expect(
    (
      await db.query<{ sent_at: string | null }>(
        'SELECT sent_at FROM public.support_outbox WHERE id=$1',
        [a.id],
      )
    ).rows[0].sent_at,
  ).not.toBeNull();
});
it('denies all client access including service RPCs and enables RLS', async () => {
  const tables = [
    'support_tickets',
    'support_messages',
    'support_sessions',
    'support_updates',
    'support_outbox',
  ];
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    for (const table of tables)
      await expect(db.query('SELECT * FROM public.' + table)).rejects.toThrow(
        /permission denied/,
      );
    await expect(act(900, 'reply', 'unauthorized', 1, true)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query('SELECT * FROM public.claim_support_delivery(NULL)'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query('SELECT public.support_database_status()'),
    ).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  expect(
    (
      await db.query<{ v: { ready: boolean } }>(
        'SELECT public.support_database_status() v',
      )
    ).rows[0].v.ready,
  ).toBe(true);
  await db.exec('RESET ROLE');
});
