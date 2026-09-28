import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';

class FakeSession {
  sessionId = 'test-copilot-session';
  handlers = new Set();
  on(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  emit(type, data) { for (const handler of this.handlers) handler({ type, data }); }
  async sendAndWait({ prompt, attachments }) {
    this.lastAttachments = attachments;
    if (prompt === 'wait') {
      await new Promise(resolve => { this.finish = resolve; });
      return;
    }
    if (prompt === 'question') {
      const result = await this.config.onUserInputRequest({ question: 'Which folder?', choices: ['Documents', 'Downloads'] });
      prompt = result.answer;
    }
    if (prompt === 'fail') throw new Error('Simulated Copilot failure');
    this.emit('tool.execution_start', { toolCallId: 'tool-1', toolName: 'read_file', arguments: { path: 'example.txt' } });
    this.emit('tool.execution_complete', { toolCallId: 'tool-1', success: true, result: { content: 'ok' } });
    const messageId = `reply-${Date.now()}`;
    this.emit('assistant.message_delta', { messageId, deltaContent: 'Hello ' });
    this.emit('assistant.message', { messageId, content: `Hello ${prompt}` });
  }
  async abort() { this.finish?.(); }
}
class FakeClient {
  session = new FakeSession();
  resumed = false;
  async start() {}
  async stop() {}
  async getAuthStatus() { return { isAuthenticated: true, login: 'test-user' }; }
  async listModels() { return [{ id: 'auto', name: 'Auto' }]; }
  async createSession(config) { this.session.config = config; return this.session; }
  async resumeSession(_id, config) { this.resumed = true; return this.createSession(config); }
}

async function setup(t, dataDir, client = new FakeClient()) {
  const instance = await createApp({ client, dataDir, home: tmpdir() });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/bootstrap`)).json();
  t.after(async () => { await instance.close(); await new Promise(resolve => server.close(resolve)); });
  const request = (url, body, headers = {}) => fetch(`${base}${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-assistant-token': token, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { base, request, client };
}

test('local API, conversation streaming, persistence and session resume', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { base, request } = await setup(t, dir);
  assert.equal((await fetch(`${base}/api/chats`)).status, 403);
  assert.equal((await request('/api/chats', undefined, { Origin: 'https://example.com' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/bootstrap`, { headers: { Host: 'evil.example:4317' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(`${base}/api/bootstrap`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/chats', { cwd: 'relative-path' })).status, 400);
  const chat = await (await request('/api/chats', { cwd: tmpdir(), model: 'auto' })).json();
  const stream = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'world' })).text();
  assert.match(stream, /event: delta/);
  assert.match(stream, /event: tool/);
  assert.match(stream, /Hello world/);
  assert.match(stream, /event: done/);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].content, 'Hello world');
  assert.equal(saved.busy, false);
  const second = await setup(t, dir);
  const restored = await (await second.request(`/api/chats/${chat.id}`)).json();
  assert.equal(restored.messages[0].content, 'world');
  await (await second.request(`/api/chats/${chat.id}/message`, { prompt: 'again' })).text();
  assert.equal(second.client.resumed, true);
});

test('stop cancels a turn and rejects overlapping messages', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-stop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  const response = await request(`/api/chats/${chat.id}/message`, { prompt: 'wait' });
  for (let i = 0; i < 100 && !client.session.finish; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(client.session.finish);
  assert.equal((await request(`/api/chats/${chat.id}/message`, { prompt: 'overlap' })).status, 409);
  await request(`/api/chats/${chat.id}/stop`, {});
  assert.match(await response.text(), /"stopped":true/);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.equal(saved.busy, false);
  assert.equal(saved.messages.at(-1).role, 'notice');
});

test('file and directory attachments are validated, sent to Copilot and persisted', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-attachments-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'résumé.txt');
  await writeFile(file, 'Attachment contents');
  const { request, client } = await setup(t, path.join(dir, 'chats'));
  const chat = await (await request('/api/chats', {})).json();
  const resolved = await (await request('/api/attachments/resolve', { paths: [file, dir, file] })).json();
  assert.deepEqual(resolved.map(item => item.type), ['file', 'directory']);
  const endpoint = `/api/chats/${chat.id}/message`;
  assert.equal((await request(endpoint, { prompt: '', attachments: [] })).status, 400);
  assert.equal((await request(endpoint, { prompt: 'Check', attachments: [{ path: 'relative.txt' }] })).status, 400);
  assert.equal((await request(endpoint, { prompt: 'Check', attachments: [{ path: path.join(dir, 'missing') }] })).status, 400);
  assert.equal((await request(endpoint, { prompt: 'Check', attachments: 'invalid' })).status, 400);
  const response = await request(endpoint, { prompt: '', attachments: resolved });
  assert.match(await response.text(), /event: done/);
  assert.deepEqual(client.session.lastAttachments, resolved);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.deepEqual(saved.messages[0].attachments, resolved);
  const restored = await setup(t, path.join(dir, 'chats'));
  assert.deepEqual((await (await restored.request(`/api/chats/${chat.id}`)).json()).messages[0].attachments, resolved);
});

test('question answers continue the turn and errors remain visible', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-question-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  const response = await request(`/api/chats/${chat.id}/message`, { prompt: 'question' });
  const reader = response.body.getReader();
  let received = '';
  while (!received.includes('event: question')) received += new TextDecoder().decode((await reader.read()).value);
  const question = JSON.parse(received.match(/event: question\ndata: (.+)/)[1]);
  await request(`/api/chats/${chat.id}/answer`, { id: question.id, answer: 'Documents', wasFreeform: false });
  while (true) { const next = await reader.read(); if (next.done) break; received += new TextDecoder().decode(next.value); }
  assert.match(received, /Hello Documents/);
  const failure = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'fail' })).text();
  assert.match(failure, /Simulated Copilot failure/);
  assert.match(failure, /event: done/);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.equal(saved.messages.at(-1).role, 'error');
});
