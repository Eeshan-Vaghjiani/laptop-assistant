// Optional integration check: uses the signed-in Copilot account and its allowance.
// Run explicitly with: node tests/verify-live.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'laptop-assistant-live-'));
const instance = await createApp({ dataDir: path.join(dir, 'chats') });
const server = instance.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: 'Connected to GitHub Copilot' }).waitFor({ timeout: 90000 });
  assert.equal(await page.locator('h1').innerText(), 'What can I help with?');
  await page.screenshot({ path: path.join(dir, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#folder-toggle').click();
  await page.locator('#folder').fill(process.cwd());
  await page.locator('#model').selectOption('gpt-5-mini');
  const target = path.join(dir, 'copilot-smoke.txt');
  const marker = `LAPTOP_ASSISTANT_OK_${Date.now()}`;
  await page.locator('#prompt').fill(`This is a local integration test. Using your filesystem/shell tools, write exactly ${marker} to the file ${JSON.stringify(target)}. Read the file back and report its contents. Only change that file. Do not ask a question.`);
  await page.locator('#send').click();
  await page.locator('#stop').waitFor({ state: 'visible' });
  await page.locator('#stop').waitFor({ state: 'hidden', timeout: 240000 });
  const text = await page.locator('#messages').innerText();
  console.log('Chat result:', text);
  assert.equal((await readFile(target, 'utf8')).trim(), marker);
  assert.ok(await page.locator('#tool-list .tool').count() > 0);
  await page.reload();
  await page.locator('.message.assistant').first().waitFor({ timeout: 90000 });
  assert.match(await page.locator('#messages').innerText(), new RegExp(marker));
  assert.deepEqual(errors, []);
  console.log('PASS: live Copilot file creation/readback outside starting folder, tool activity, chat reload, desktop/mobile layout, no browser errors.');
  console.log('Screenshots:', dir);
} finally {
  await browser?.close();
  await instance.close();
  await new Promise(resolve => server.close(resolve));
  // Keep screenshots for inspection; remove only this test's generated content.
  await rm(path.join(dir, 'chats'), { recursive: true, force: true });
  await rm(path.join(dir, 'copilot-smoke.txt'), { force: true });
}
