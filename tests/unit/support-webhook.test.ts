import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  rpc: vi.fn(),
  staff: vi.fn(),
  payment: vi.fn(),
  ops: vi.fn(),
}));
vi.mock('@/lib/billing/telegram', () => ({ telegramCall: mocks.call }));
vi.mock('@/lib/billing/webhook', () => ({ handleStarsWebhook: mocks.payment }));
vi.mock('@/lib/ops/events', () => ({ recordOpsError: mocks.ops }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ in: mocks.staff }) }),
    rpc: (name: string, args: unknown) => ({
      abortSignal: () => mocks.rpc(name, args),
    }),
  }),
}));
import { POST } from '@/app/api/telegram/webhook/route';
import { deliverSupport } from '@/lib/support/server';
const admin = 'a0000000-0000-0000-0000-000000000001';
const event = (text = '/support', id = 123) => ({
  update_id: 100,
  message: { chat: { id, type: 'private' }, from: { id }, text },
});
const request = (value: unknown, secret = 'x'.repeat(32)) =>
  new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_USER_IDS', admin);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fixture');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'x'.repeat(32));
  vi.stubEnv('APP_URL', 'https://example.com');
  mocks.staff.mockImplementation(() => ({
    abortSignal: async () => ({ data: [{ telegram_id: 900 }], error: null }),
  }));
  mocks.payment.mockResolvedValue(false);
  mocks.call.mockResolvedValue({ message_id: 1 });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'process_support_update' ? true : [],
    error: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
it('rejects unauthenticated webhook requests before accessing tickets or payments', async () => {
  expect((await POST(request(event(), 'wrong'))).status).toBe(403);
  expect(mocks.payment).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('processes Stars before support and never captures payment events into tickets', async () => {
  mocks.payment.mockResolvedValue(true);
  expect((await POST(request(event()))).status).toBe(200);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('uses protected admin UUID configuration, never the username or a claimed role', async () => {
  expect(
    (
      await POST(
        request({
          ...event('/reply 42 hack'),
          admin: true,
          username: 'feper145',
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.staff).toHaveBeenCalledWith('id', [admin]);
  expect(mocks.rpc).toHaveBeenCalledWith(
    'process_support_update',
    expect.objectContaining({
      p_actor: 123,
      p_admin: false,
      p_action: 'reply',
      p_ticket: 42,
    }),
  );
  expect((await POST(request(event('/reply 42 Решено', 900)))).status).toBe(
    200,
  );
  expect(mocks.rpc).toHaveBeenCalledWith(
    'process_support_update',
    expect.objectContaining({ p_actor: 900, p_admin: true }),
  );
});
it('fails closed when the administrator configuration is malformed', async () => {
  vi.stubEnv('ADMIN_USER_IDS', 'feper145');
  expect((await POST(request(event()))).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.call).not.toHaveBeenCalled();
});
it('acknowledges inline callback and still saves a ticket draft if the acknowledgment expired', async () => {
  mocks.call.mockRejectedValueOnce(Error('expired callback'));
  const message = event().message;
  expect(
    (
      await POST(
        request({
          update_id: 77,
          callback_query: {
            id: 'cb',
            from: { id: 123 },
            message,
            data: 'support:new',
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.call).toHaveBeenCalledWith('answerCallbackQuery', {
    callback_query_id: 'cb',
  });
  expect(mocks.rpc).toHaveBeenCalledWith(
    'process_support_update',
    expect.objectContaining({ p_action: 'begin', p_actor: 123 }),
  );
});
it('rejects group messages and another user’s callback chat', async () => {
  const message = { ...event().message, chat: { id: 123, type: 'group' } };
  await POST(request({ update_id: 11, message }));
  await POST(
    request({
      update_id: 12,
      callback_query: {
        id: 'cb',
        from: { id: 999 },
        message: event().message,
        data: 'support:new',
      },
    }),
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('skips queued private notifications to revoked administrators', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'claim_support_delivery'
        ? [
            {
              id: 'job',
              lease: 'lease',
              chat_id: 999,
              body: 'private ticket',
              staff_only: true,
            },
          ]
        : null,
    error: null,
  }));
  await deliverSupport(null, 1);
  expect(mocks.call).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('complete_support_delivery', {
    p_id: 'job',
    p_lease: 'lease',
    p_sent: true,
  });
});
it('persists a failed delivery and continues other queued jobs before reporting failure', async () => {
  let count = 0;
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'claim_support_delivery' && ++count <= 2
        ? [
            {
              id: 'job' + count,
              lease: 'lease',
              chat_id: 123,
              body: 'text',
              staff_only: false,
            },
          ]
        : null,
    error: null,
  }));
  mocks.call
    .mockRejectedValueOnce(Error('blocked'))
    .mockResolvedValue({ message_id: 2 });
  await expect(deliverSupport(null, 3)).rejects.toThrow('pending');
  expect(mocks.call).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenCalledWith(
    'complete_support_delivery',
    expect.objectContaining({ p_id: 'job1', p_sent: false }),
  );
  expect(mocks.rpc).toHaveBeenCalledWith(
    'complete_support_delivery',
    expect.objectContaining({ p_id: 'job2', p_sent: true }),
  );
});
