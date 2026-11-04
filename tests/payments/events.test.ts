import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingConfiguration,
  invoiceParameters,
} from '../../src/lib/billing/config';
import {
  parseStarsUpdate,
  processStarsUpdate,
} from '../../src/lib/billing/events';
const config = {
  TELEGRAM_STARS_PAYMENTS_ENABLED: 'true',
  TELEGRAM_STARS_OWNER_REVIEWED: 'true',
  TELEGRAM_STARS_PREMIUM_PRICE: '99',
  TELEGRAM_BOT_TOKEN: 'fake-test-token',
  TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
  PREMIUM_TERMS_URL: 'https://example.com/terms',
  PAYMENT_SUPPORT_URL: 'https://example.com/support',
};
const checkout = {
  pre_checkout_query: {
    id: 'q1',
    from: { id: 123 },
    currency: 'XTR',
    total_amount: 99,
    invoice_payload: 'opaque',
  },
};
const receipt = {
  message: {
    chat: { id: 123, type: 'private' },
    from: { id: 123 },
    successful_payment: {
      currency: 'XTR',
      total_amount: 99,
      invoice_payload: 'opaque',
      telegram_payment_charge_id: 'charge',
    },
  },
};

test('one-time access rejects unsupported recurring receipt metadata', () => {
  for (const extra of [
    { is_recurring: true },
    { is_first_recurring: true },
    { subscription_expiration_date: 2000000000 },
  ])
    assert.throws(() =>
      parseStarsUpdate({
        message: {
          ...receipt.message,
          successful_payment: {
            ...receipt.message.successful_payment,
            ...extra,
          },
        },
      }),
    );
});
test('payments are off by default and require explicit review, price and support policies', () => {
  assert.equal(billingConfiguration({}).enabled, false);
  assert.equal(billingConfiguration(config).enabled, true);
  for (const key of Object.keys(config)) {
    const invalid = { ...config, [key]: '' };
    assert.equal(billingConfiguration(invalid).enabled, false, key);
  }
  const invoice = invoiceParameters('opaque', 99);
  assert.equal(invoice.currency, 'XTR');
  assert.equal(invoice.provider_token, '');
  assert.deepEqual(invoice.prices, [
    { label: 'Premium · 30 дней', amount: 99 },
  ]);
  assert.equal('subscription_period' in invoice, false);
  for (const price of ['0', '-1', '1.5', '10001', 'invalid']) {
    assert.equal(
      billingConfiguration({ ...config, TELEGRAM_STARS_PREMIUM_PRICE: price })
        .enabled,
      false,
    );
  }
  assert.equal(
    billingConfiguration({
      ...config,
      PREMIUM_TERMS_URL: 'javascript:alert(1)',
    }).termsUrl,
    null,
  );
  assert.equal(
    billingConfiguration({
      ...config,
      PAYMENT_SUPPORT_URL: 'https://user:pass@example.com/',
    }).enabled,
    false,
  );
});
test('persistence failures propagate for webhook retry instead of acknowledging lost payments', async () => {
  await assert.rejects(
    processStarsUpdate(receipt, {
      enabled: false,
      check: async () => false,
      answer: async () => {},
      apply: async () => {
        throw new Error('database unavailable');
      },
    }),
    /database unavailable/,
  );
});
test('pre-checkout never grants access and disabled payments are explicitly declined', async () => {
  const calls: string[] = [];
  await processStarsUpdate(checkout, {
    enabled: false,
    check: async () => {
      throw new Error('must not run');
    },
    answer: async (id, ok) => {
      calls.push(`${id}:${ok}`);
    },
    apply: async () => {
      throw new Error('must not grant');
    },
  });
  assert.deepEqual(calls, ['q1:false']);
  await processStarsUpdate(checkout, {
    enabled: true,
    check: async () => {
      throw new Error('database timeout');
    },
    answer: async (_, ok) => assert.equal(ok, false),
    apply: async () => {
      throw new Error();
    },
  });
});
test('only trusted webhook receipts are persisted; refunds still work with checkout disabled', async () => {
  const events: string[] = [];
  const deps = {
    enabled: false,
    check: async () => false,
    answer: async () => {},
    apply: async (e: { kind: string }) => {
      events.push(e.kind);
    },
  };
  assert.equal(await processStarsUpdate(receipt, deps), true);
  await processStarsUpdate(
    {
      message: {
        chat: { id: 123, type: 'private' },
        refunded_payment: receipt.message.successful_payment,
      },
    },
    deps,
  );
  assert.deepEqual(events, ['paid', 'refund']);
  assert.equal(
    await processStarsUpdate({ message: { text: '/start' } }, deps),
    false,
  );
  assert.throws(() =>
    parseStarsUpdate({ message: { ...receipt.message, from: { id: 999 } } }),
  );
  assert.throws(() =>
    parseStarsUpdate({
      message: {
        ...receipt.message,
        successful_payment: {
          ...receipt.message.successful_payment,
          is_recurring: true,
        },
      },
    }),
  );
});
