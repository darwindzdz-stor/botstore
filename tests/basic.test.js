import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyTelegramInitData } from '../src/middleware/auth.js';

test('project metadata',()=>{assert.ok(process.version.startsWith('v'))});
test('invalid Telegram init data is rejected safely',()=>{assert.equal(verifyTelegramInitData('hash=not-a-valid-hash','token'),null);assert.equal(verifyTelegramInitData('', 'token'),null)});
test('Telegram hash verification accepts a valid signed payload',()=>{
  const token='123456:TEST_TOKEN'; const user=JSON.stringify({id:42,first_name:'Darwin'}); const authDate=Math.floor(Date.now()/1000);
  const pairs=[['auth_date',String(authDate)],['user',user]]; const data=pairs.sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const hash=crypto.createHmac('sha256',secret).update(data).digest('hex');
  const init=`user=${encodeURIComponent(user)}&auth_date=${authDate}&hash=${hash}`;
  assert.equal(verifyTelegramInitData(init,token).id,42);
});
