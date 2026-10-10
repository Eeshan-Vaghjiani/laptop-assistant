import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const env = { ...process.env, ASSISTANT_TEST_PROFILE: await mkdtemp(path.join(tmpdir(), 'assistant-queue-')) }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.argv.includes('--packaged') ? { executablePath: path.resolve('dist/Laptop Assistant-win32-x64/Laptop Assistant.exe') } : { args: [process.cwd()] }), env });
try {
  const page = await app.firstWindow(), pending = [], sent = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL('http://127.0.0.1:*/');
  await page.locator('#connection').filter({ hasText: 'Connected to GitHub Copilot' }).waitFor({ timeout: 60000 });
  const finish = async (outcome = {}) => {
    const { route, prompt, index } = pending.shift();
    await route.fulfill({ contentType: 'text/event-stream', body: `event: user\ndata: ${JSON.stringify({ id: `u${index}`, role: 'user', content: prompt })}\n\nevent: message\ndata: ${JSON.stringify({ id: `a${index}`, role: 'assistant', content: 'Answer given.' })}\n\nevent: done\ndata: ${JSON.stringify(outcome)}\n\n` });
  };
  await page.route('**/api/chats/*/message', async route => {
    const { prompt } = route.request().postDataJSON(); sent.push(prompt); pending.push({ route, prompt, index: sent.length });
  });
  await page.locator('#prompt').fill('First task'); await page.locator('#send').click();
  await page.locator('#stop').waitFor();
  assert.equal(await page.locator('#prompt').isEnabled(), true);
  await page.locator('#prompt').fill('Helpful follow-up'); await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await page.locator('#queue-list').filter({ hasText: 'Helpful follow-up' }).waitFor();
  await page.locator('#prompt').fill('Remove this'); await page.locator('#send').click();
  await page.locator('#queue-list li').last().getByRole('button', { name: 'Remove' }).click();
  await page.locator('#prompt').fill('Unsent draft must survive');
  while (!pending.length) await new Promise(r => setTimeout(r, 20));
  await finish();
  while (sent.length < 2) await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(sent, ['First task', 'Helpful follow-up']);
  assert.equal(await page.locator('#prompt').inputValue(), 'Unsent draft must survive');
  await page.locator('#prompt').fill('Paused message'); await page.locator('#send').click();
  await finish({ incomplete: true });
  await page.locator('#run-label').filter({ hasText: 'Answer incomplete' }).waitFor();
  await page.locator('#queue-resume').waitFor();
  assert.equal(sent.length, 2);
  await page.locator('#queue-resume').click();
  while (sent.length < 3) await new Promise(r => setTimeout(r, 20));
  assert.equal(sent[2], 'Paused message');
  await finish();
  await page.locator('#stop').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#message-queue').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: typing while busy, FIFO queue, remove, draft preservation, pause on incomplete, explicit resume.');
} finally { await app.close(); }
