import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startReply,
  supportReply,
  supportMessage,
} from '../../src/lib/telegram/bot';
test('start keeps the Mini App launcher and adds a direct support chat button', () => {
  const reply = startReply('https://example.com/');
  assert.deepEqual(reply.reply_markup.inline_keyboard, [
    [{ text: 'Открыть Voklumi ✦', web_app: { url: 'https://example.com/' } }],
    [{ text: 'Написать в поддержку', url: 'https://t.me/feper145' }],
  ]);
  assert.throws(() => startReply('http://example.com/'));
});
test('support covers bug reports and ideas without forwarding user messages', () => {
  const reply = supportReply();
  assert.match(reply.text, /ошибки, баги и предложения/);
  assert.deepEqual(reply.reply_markup.inline_keyboard, [
    [{ text: 'Написать в поддержку', url: 'https://t.me/feper145' }],
  ]);
  assert.equal('web_app' in reply.reply_markup.inline_keyboard[0][0], false);
  assert.match(supportReply(true).text, /Помощь с покупками/);
});
test('support commands accept the own bot suffix and reject other bots and ordinary messages', () => {
  for (const value of ['/support', ' /support текст', '/SUPPORT@VOKLUMI_BOT'])
    assert.equal(supportMessage(value, 'Voklumi_bot'), 'support');
  assert.equal(supportMessage('/paysupport', 'Voklumi_bot'), 'paysupport');
  for (const value of ['/support@otherbot', '/supporter', 'hello', '/start'])
    assert.equal(supportMessage(value, 'Voklumi_bot'), null);
});
