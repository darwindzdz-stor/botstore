import test from 'node:test';
import assert from 'node:assert/strict';
import { httpsUrl, telegramBotUrl, normalizeBotUsername, escapeLike, telegramUrlMatchesUsername, isSafeBotUsername, safeExternalImage, validRequestTarget, isAllowedOrigin } from '../src/security.js';

test('security helpers reject non-HTTPS URLs',()=>{
  assert.equal(httpsUrl.safeParse('http://example.com').success,false);
  assert.equal(httpsUrl.safeParse('javascript:alert(1)').success,false);
  assert.equal(httpsUrl.safeParse('https://example.com/a').success,true);
});

test('Telegram bot URL policy is strict',()=>{
  assert.equal(telegramBotUrl.safeParse('https://t.me/example_bot').success,true);
  assert.equal(telegramBotUrl.safeParse('https://telegram.me/example_bot').success,true);
  assert.equal(telegramBotUrl.safeParse('https://evil.example/example_bot').success,false);
  assert.equal(telegramBotUrl.safeParse('https://t.me@evil.example/example_bot').success,false);
});

test('username normalization is deterministic',()=>{
  assert.equal(normalizeBotUsername(' @Example_Bot '),'example_bot');
  assert.equal(normalizeBotUsername('@EXAMPLE_BOT'),'example_bot');
});

test('LIKE wildcards are escaped',()=>{
  assert.equal(escapeLike('100%_x'),'100\\%\\_x');
});


test('Telegram bot URL must match the submitted username',()=>{
  assert.equal(telegramUrlMatchesUsername('https://t.me/example_bot','@Example_Bot'),true);
  assert.equal(telegramUrlMatchesUsername('https://t.me/other_bot','example_bot'),false);
  assert.equal(telegramUrlMatchesUsername('https://t.me/example_bot/a','example_bot'),false);
  assert.equal(isSafeBotUsername('example_bot'),true);
  assert.equal(isSafeBotUsername('bad-name'),false);
});


test('Telegram URL rejects extra path components and query tricks',()=>{
  assert.equal(telegramBotUrl.safeParse('https://t.me/example_bot/extra').success,false);
  assert.equal(telegramUrlMatchesUsername('https://t.me/example_bot/extra','example_bot'),false);
  assert.equal(telegramUrlMatchesUsername('https://t.me/example_bot?start=x','example_bot'),true);
});


test('external images and request targets are constrained',()=>{
  assert.equal(safeExternalImage('https://cdn.example.com/a.png'),'https://cdn.example.com/a.png');
  assert.equal(safeExternalImage('http://cdn.example.com/a.png'),'');
  assert.equal(safeExternalImage('https://user:pass@cdn.example.com/a.png'),'');
  assert.equal(validRequestTarget({originalUrl:'/api/bots?q=test'}),true);
  assert.equal(validRequestTarget({originalUrl:'/api/%00'}),false);
  assert.equal(validRequestTarget({originalUrl:'/api/%2500'}),false);
  assert.equal(validRequestTarget({originalUrl:'/api/%0A'}),false);
  assert.equal(validRequestTarget({originalUrl:'/api/%ZZ'}),false);
  assert.equal(validRequestTarget({originalUrl:'/api/%'}),false);
});


test('Telegram bot URLs reject fragments and mismatched paths',()=>{
  assert.equal(telegramBotUrl.safeParse('https://t.me/example_bot#x').success,false);
  assert.equal(telegramUrlMatchesUsername('https://t.me/example_bot#x','example_bot'),false);
});

test('origin policy accepts same-origin and Telegram web clients',()=>{
  const old=process.env.NODE_ENV; process.env.NODE_ENV='production';
  assert.equal(isAllowedOrigin('https://store.example','store.example'),true);
  assert.equal(isAllowedOrigin('https://web.telegram.org','store.example'),true);
  assert.equal(isAllowedOrigin('https://evil.example','store.example'),false);
  if(old===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=old;
});
