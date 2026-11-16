import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReply, supportMessage } from '../../src/lib/telegram/bot';
test('start keeps the Mini App launcher and adds an in-bot ticket button', () => {
  const reply = startReply('https://example.com/');
  assert.deepEqual(reply.reply_markup.inline_keyboard, [
    [{ text: 'Открыть Voklumi ✦', web_app: { url: 'https://example.com/' } }],
    [{ text: 'Написать в поддержку', callback_data: 'support:new' }],
  ]);
  assert.throws(() => startReply('http://example.com/'));
});
test('support commands accept the own bot suffix and reject other bots and ordinary messages', () => {
  for (const value of ['/support', ' /support текст', '/SUPPORT@VOKLUMI_BOT'])
    assert.equal(supportMessage(value, 'Voklumi_bot'), 'support');
  assert.equal(supportMessage('/paysupport', 'Voklumi_bot'), 'paysupport');
  for (const value of ['/support@otherbot', '/supporter', 'hello', '/start'])
    assert.equal(supportMessage(value, 'Voklumi_bot'), null);
});
