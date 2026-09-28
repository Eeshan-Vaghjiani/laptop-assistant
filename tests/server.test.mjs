import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';
import { runtimeEnv } from '../runtime-env.mjs';

class FakeSession {
  sessionId = 'test-copilot-session';
  rpc = { permissions: { configure: async options => { this.permissionOptions = options; return { success: true }; } } };
  handlers = new Set();
  on(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  emit(type, data, agentId) { for (const handler of this.handlers) handler({ type, data, agentId }); }
  async sendAndWait({ prompt, attachments }) {
    this.lastAttachments = attachments;
    if (prompt === 'permissions') {
      this.permissions = await Promise.all(['read', 'shell', 'write', 'url', 'mcp', 'unknown'].map(kind => this.config.onPermissionRequest({ kind, path: 'private.txt', command: 'example', url: 'https://example.com' }, { sessionId: this.sessionId })));
    }
    if (prompt === 'wait') {
      await new Promise(resolve => { this.finish = resolve; });
      return;
    }
    if (prompt === 'question') {
      const result = await this.config.onUserInputRequest({ question: 'Which folder?', choices: ['Documents', 'Downloads'] });
      prompt = result.answer;
    }
    if (prompt === 'fail') throw new Error('Simulated Copilot failure');
    if (prompt === 'managed') {
      this.permissions = [];
      for (let i = 0; i < 2; i++) this.permissions.push(await this.config.onPermissionRequest({}, { sessionId: this.sessionId, managedSettingsEnabled: true }));
    }
    if (prompt === 'agents') {
      this.emit('assistant.message_delta', { messageId: 'agent', deltaContent: 'hidden subagent' }, 'agent-1');
      this.emit('assistant.message', { messageId: 'agent', content: 'hidden subagent' }, 'agent-1');
      this.emit('assistant.message', { messageId: 'legacy', content: 'hidden legacy', parentToolCallId: 'tool-1' });
    }
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
  async getSessionMetadata(id) { return id === this.session.sessionId ? { sessionId: id } : undefined; }
  async createSession(config) { this.session.config = config; return this.session; }
  async resumeSession(_id, config) { this.resumed = true; return this.createSession(config); }
}

async function setup(t, dataDir, client = new FakeClient(), options = {}) {
  const instance = await createApp({ client, dataDir, home: tmpdir(), ...options });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = instance;
  t.after(async () => { await instance.close(); await new Promise(resolve => server.close(resolve)); });
  const request = (url, body, headers = {}) => fetch(`${base}${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-assistant-token': token, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { base, request, client, token, instance };
}

async function streamEvents(response) {
  const reader = response.body.getReader();
  let buffer = '';
  const decoder = new TextDecoder();
  return {
    reader,
    async next(type) {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const lines = buffer.slice(0, end).split('\n');
          buffer = buffer.slice(end + 2);
          if (lines.includes(`event: ${type}`)) return JSON.parse(lines.find(line => line.startsWith('data: ')).slice(6));
        } else {
          const chunk = await reader.read();
          if (chunk.done) throw new Error(`Stream ended before ${type}`);
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      }
    },
  };
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

test('bootstrap and all API routes require the private token and never return it', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { base, request, token } = await setup(t, dir);
  for (const route of ['/api', '/API/bootstrap', '/api/bootstrap', '/api/status', '/api/chats', '/api/attachments/resolve', '/api/chats/unknown/message', '/api/chats/unknown/stop', '/api/chats/unknown/answer', '/api/chats/unknown/permissions', '/api/unknown']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base + route, { method });
      assert.equal(response.status, 403);
      assert.ok(!(await response.text()).includes(token));
    }
  }
  for (const value of ['', 'x', 'x'.repeat(64), 'x'.repeat(65)]) assert.equal((await request('/api/bootstrap', undefined, { 'x-assistant-token': value })).status, 403);
  assert.deepEqual(await (await request('/api/bootstrap')).json(), { home: tmpdir() });
});

test('host, origin and fetch-site checks protect static and API routes', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-origins-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, base } = await setup(t, dir);
  for (const route of ['/', '/app.js', '/vendor/marked.js', '/api/bootstrap', '/api/status', '/api/unknown']) {
    for (const headers of [{ Host: 'evil.example:4317' }, { Origin: 'null' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const status = await new Promise((resolve, reject) => {
        const req = httpRequest(base + route, { headers }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
      });
      assert.equal(status, 403, `${route}: ${JSON.stringify(headers)}`);
    }
  }
  const response = await request('/');
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-src 'none'; object-src 'none'/);
});

test('invalid body fields and malformed JSON cannot crash or disclose the token', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-validation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, base, token } = await setup(t, dir);
  for (const body of [null, [], { cwd: false }, { cwd: 1 }, { cwd: 'x'.repeat(32768) }, { cwd: '\\\\server\\share' }, { cwd: tmpdir() + '\0' }, { model: null }, { model: [] }, { model: '' }, { model: 'x'.repeat(101) }, { model: 'a\nb' }]) {
    assert.equal((await request('/api/chats', body)).status, 400);
  }
  for (const body of [token + '{', '{"prompt":"' + 'a'.repeat(1024 * 1024) + '"}']) {
    const response = await fetch(base + '/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-assistant-token': token }, body });
    assert.ok([400, 413].includes(response.status));
    assert.ok(!(await response.text()).includes(token));
  }
  assert.equal((await request('/api/chats', undefined)).status, 200);
  const chat = await (await request('/api/chats', {})).json();
  for (const id of ['invalid', 'x'.repeat(201), '..%2Foutside']) assert.equal((await request(`/api/chats/${id}`)).status, 400);
  for (const paths of [null, {}, [1], ['x'.repeat(32768)], Array(101).fill(dir), ['\\\\server\\share'], [dir + '\0']]) {
    assert.equal((await request('/api/attachments/resolve', { paths })).status, 400);
  }
  for (const body of [{ prompt: 1 }, { prompt: 'x'.repeat(100001) }, { prompt: 'ok', attachments: [null] }]) {
    assert.equal((await request(`/api/chats/${chat.id}/message`, body)).status, 400);
  }
});

test('runtime privacy configuration disables telemetry, exports, discovery and updates', async t => {
  const env = runtimeEnv({ PATH: 'kept', COPILOT_ALLOW_ALL: 'true', ELECTRON_RUN_AS_NODE: '1', COPILOT_AUTO_UPDATE: 'true', COPILOT_OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://example.com', COPILOT_OTEL_FILE_EXPORTER_PATH: 'private.json' });
  assert.deepEqual(env, { PATH: 'kept', COPILOT_AUTO_UPDATE: 'false', COPILOT_OTEL_ENABLED: 'false' });
  assert.equal(runtimeEnv({ COPILOT_CLI_PATH: 'cli.js' }).ELECTRON_RUN_AS_NODE, '1');
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-privacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  await (await request(`/api/chats/${chat.id}/message`, { prompt: 'hello' })).text();
  for (const key of ['enableSessionTelemetry', 'enableSessionStore', 'enableConfigDiscovery', 'enableFileHooks', 'requestExtensions']) assert.equal(client.session.config[key], false);
  assert.equal(client.session.config.remoteSession, 'off');
  assert.equal(client.session.permissionOptions.approveAllToolPermissionRequests, false);
  assert.equal(client.session.permissionOptions.approveAllReadPermissionRequests, false);
});

test('permissions queue serializes requests, validates decisions, allows once and denies', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-permissions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  const stream = await streamEvents(await request(`/api/chats/${chat.id}/message`, { prompt: 'permissions' }));
  const results = [];
  for (let i = 0; i < 6; i++) {
    const q = await stream.next('question');
    assert.equal(q.permission, true);
    assert.match(q.details, /private.txt/);
    assert.equal((await request(`/api/chats/${chat.id}/answer`, { id: q.id, answer: 'yes', wasFreeform: false })).status, 400);
    const answer = i % 2 ? 'Deny' : 'Allow once';
    assert.equal((await request(`/api/chats/${chat.id}/answer`, { id: q.id, answer, wasFreeform: false })).status, 200);
    results.push({ kind: i % 2 ? 'reject' : 'approve-once' });
  }
  await stream.next('done');
  assert.deepEqual(client.session.permissions, results);
  assert.deepEqual(await client.session.config.onPermissionRequest({ kind: 'shell' }, {}), { kind: 'user-not-available' });
});

test('allow-all is per-chat, resettable, and does not survive restart or managed restrictions', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-allowall-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  client.session.sendAndWait = async () => {
    client.session.permissions = [];
    for (let i = 0; i < 2; i++) client.session.permissions.push(await client.session.config.onPermissionRequest({ kind: 'shell' }, {}));
  };
  const stream = await streamEvents(await request(`/api/chats/${chat.id}/message`, { prompt: 'allow' }));
  const q = await stream.next('question');
  await request(`/api/chats/${chat.id}/answer`, { id: q.id, answer: 'Allow all for this chat', wasFreeform: false });
  assert.equal((await stream.next('permissions')).allowAll, true);
  await stream.next('done');
  assert.deepEqual(client.session.permissions, [{ kind: 'approve-once' }, { kind: 'approve-once' }]);
  assert.equal((await (await request(`/api/chats/${chat.id}`)).json()).allowAll, true);
  const other = await (await request('/api/chats', {})).json();
  assert.equal((await (await request(`/api/chats/${other.id}`)).json()).allowAll, false);
  const reopened = await setup(t, dir);
  assert.equal((await (await reopened.request(`/api/chats/${chat.id}`)).json()).allowAll, false);
  client.session.sendAndWait = FakeSession.prototype.sendAndWait;
  assert.match(await (await request(`/api/chats/${chat.id}/message`, { prompt: 'managed' })).text(), /Organisation-managed/);
  assert.deepEqual(client.session.permissions, [{ kind: 'user-not-available' }, { kind: 'user-not-available' }]);
  assert.equal((await request(`/api/chats/${chat.id}/permissions`, { allowAll: true })).status, 400);
  assert.equal((await request(`/api/chats/${chat.id}/permissions`, { allowAll: false })).status, 200);
  assert.equal((await (await request(`/api/chats/${chat.id}`)).json()).allowAll, false);
});

test('Stop and disconnect deny all waiting permissions', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-deny-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  for (const disconnect of [false, true]) {
    const stream = await streamEvents(await request(`/api/chats/${chat.id}/message`, { prompt: 'permissions' }));
    await stream.next('question');
    if (disconnect) await stream.reader.cancel();
    else { await request(`/api/chats/${chat.id}/stop`, {}); await stream.next('done'); }
    for (let i = 0; i < 100 && (await (await request(`/api/chats/${chat.id}`)).json()).busy; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(client.session.permissions, Array(6).fill({ kind: 'user-not-available' }));
  }
});

test('manual permission enforcement failures prevent sending to Copilot', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  client.session.rpc.permissions.configure = async () => ({ success: false });
  client.session.sendAndWait = async () => assert.fail('Must not send');
  const chat = await (await request('/api/chats', {})).json();
  const stream = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'hello' })).text();
  assert.match(stream, /Could not enforce manual/);
});

test('managed human-only requests cannot use the per-chat allow-all choice', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-human-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  client.session.sendAndWait = async () => {
    client.session.decision = await client.session.config.onPermissionRequest({ kind: 'shell', managedApprovalRequired: true }, {});
  };
  const stream = await streamEvents(await request(`/api/chats/${chat.id}/message`, { prompt: 'hello' }));
  const q = await stream.next('question');
  assert.deepEqual(q.choices, ['Allow once', 'Deny']);
  assert.equal((await request(`/api/chats/${chat.id}/answer`, { id: q.id, answer: 'Allow all for this chat', wasFreeform: false })).status, 400);
  await request(`/api/chats/${chat.id}/answer`, { id: q.id, answer: 'Deny', wasFreeform: false });
  await stream.next('done');
  assert.deepEqual(client.session.decision, { kind: 'reject' });
});

test('encrypted chat storage migrates atomically, resumes and preserves undecryptable files', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-encryption-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = randomBytes(32);
  const storage = {
    encrypt(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const first = await setup(t, dir);
  const chat = await (await first.request('/api/chats', {})).json();
  await (await first.request(`/api/chats/${chat.id}/message`, { prompt: 'private history' })).text();
  const file = path.join(dir, `${chat.id}.json`);
  const plain = await readFile(file, 'utf8');
  await assert.rejects(createApp({ client: new FakeClient(), dataDir: dir, storage: { ...storage, encrypt() { throw new Error('Encryption failed'); } } }), /Encryption failed/);
  assert.equal(await readFile(file, 'utf8'), plain);
  const second = await setup(t, dir, new FakeClient(), { storage });
  assert.doesNotMatch(await readFile(file, 'utf8'), /private history/);
  await (await second.request(`/api/chats/${chat.id}/message`, { prompt: 'encrypted reply' })).text();
  assert.equal(second.client.resumed, true);
  const third = await setup(t, dir, new FakeClient(), { storage });
  assert.match(await (await third.request(`/api/chats/${chat.id}`)).text(), /encrypted reply/);
  const encrypted = await readFile(file, 'utf8');
  await assert.rejects(createApp({ client: new FakeClient(), dataDir: dir }), /Encrypted history requires/);
  await assert.rejects(createApp({ client: new FakeClient(), dataDir: dir, storage: { ...storage, decrypt() { throw new Error('Wrong account'); } } }), /Could not decrypt/);
  assert.equal(await readFile(file, 'utf8'), encrypted);
});

test('SDK errors redact the API token from responses and saved history', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-redaction-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client, token } = await setup(t, dir);
  client.getAuthStatus = async () => { throw new Error(`Failure ${token}`); };
  const status = await request('/api/status');
  assert.equal(status.status, 503);
  assert.doesNotMatch(await status.text(), new RegExp(token));
  const chat = await (await request('/api/chats', {})).json();
  client.session.sendAndWait = async () => { throw new Error(`Failure ${token}`); };
  const stream = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'hello' })).text();
  assert.doesNotMatch(stream, new RegExp(token));
  assert.match(stream, /redacted/);
  assert.doesNotMatch(await (await request(`/api/chats/${chat.id}`)).text(), new RegExp(token));
});

test('malformed saved chat metadata is ignored without breaking chat listing', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = '00000000-0000-4000-8000-000000000000';
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, messages: [], updatedAt: {} }));
  const { request } = await setup(t, dir);
  assert.deepEqual(await (await request('/api/chats')).json(), []);
});

test('sub-agent events are neither streamed nor saved and long Unicode prompts work', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-unicode-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  const endpoint = `/api/chats/${chat.id}/message`;
  const stream = await (await request(endpoint, { prompt: 'agents' })).text();
  assert.doesNotMatch(stream, /hidden/);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.doesNotMatch(JSON.stringify(saved), /hidden/);
  assert.equal(saved.messages.at(-1).content, 'Hello agents');
  const response = await request(endpoint, { prompt: '中'.repeat(100000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /event: done/);
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
  for (const fields of [{ id: {} }, { id: 'x'.repeat(201) }, { wasFreeform: 1 }, { answer: [] }, { answer: 'x'.repeat(100001) }]) {
    assert.equal((await request(`/api/chats/${chat.id}/answer`, { id: question.id, answer: 'Documents', ...fields })).status, 400);
  }
  await request(`/api/chats/${chat.id}/answer`, { id: question.id, answer: 'Documents', wasFreeform: false });
  while (true) { const next = await reader.read(); if (next.done) break; received += new TextDecoder().decode(next.value); }
  assert.match(received, /Hello Documents/);
  const failure = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'fail' })).text();
  assert.match(failure, /Simulated Copilot failure/);
  assert.match(failure, /event: done/);
  const saved = await (await request(`/api/chats/${chat.id}`)).json();
  assert.equal(saved.messages.at(-1).role, 'error');
});

test('missing context starts a new session but metadata failures do not', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-missing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await setup(t, dir);
  const chat = await (await first.request('/api/chats', {})).json();
  chat.sessionId = 'missing';
  await writeFile(path.join(dir, `${chat.id}.json`), JSON.stringify(chat));
  const second = await setup(t, dir);
  const stream = await (await second.request(`/api/chats/${chat.id}/message`, { prompt: 'again' })).text();
  assert.match(stream, /Earlier Copilot context/);
  assert.match(stream, /Hello again/);
  assert.equal(second.client.resumed, false);
  const saved = await (await second.request(`/api/chats/${chat.id}`)).json();
  assert.equal(saved.sessionId, second.client.session.sessionId);
  assert.equal(saved.messages.filter(m => m.role === 'notice').length, 1);
  const client = new FakeClient();
  client.getSessionMetadata = async () => { throw new Error('Metadata unavailable'); };
  const third = await setup(t, dir, client);
  const failure = await (await third.request(`/api/chats/${chat.id}/message`, { prompt: 'again' })).text();
  assert.match(failure, /Metadata unavailable/);
  assert.equal(client.session.config, undefined);
});

test('managed permissions are denied with exactly one notice per run', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-managed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request, client } = await setup(t, dir);
  const chat = await (await request('/api/chats', {})).json();
  for (let i = 1; i <= 2; i++) {
    const stream = await (await request(`/api/chats/${chat.id}/message`, { prompt: 'managed' })).text();
    assert.equal(stream.split('Organisation-managed').length - 1, 1);
    assert.deepEqual(client.session.permissions, [{ kind: 'user-not-available' }, { kind: 'user-not-available' }]);
    const saved = await (await request(`/api/chats/${chat.id}`)).json();
    assert.equal(saved.messages.filter(m => m.role === 'notice').length, i);
  }
});
