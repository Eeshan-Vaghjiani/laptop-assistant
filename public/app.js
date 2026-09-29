import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
const $ = id => document.getElementById(id);
let token, current = null, busy = false, ready = false, pendingQuestion = null;
const messageNodes = new Map();
const toolNodes = new Map();
let toastTimer;
let attachments = [], clipboardAttachments = [], readingClipboard = false, draftVersion = 0;
const attachmentKey = item => window.desktop?.platform === 'linux' ? item.path : item.path.toLowerCase();

function attachmentChip(item, remove) {
  const chip = document.createElement('div');
  chip.className = 'attachment-chip';
  chip.title = item.path;
  const label = document.createElement('span');
  label.textContent = `${item.type === 'directory' ? '▱ Folder' : '▤ File'} · ${item.displayName}`;
  chip.append(label);
  if (remove) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '×';
    button.setAttribute('aria-label', `Remove ${item.displayName}`);
    button.disabled = busy;
    button.onclick = remove;
    chip.append(button);
  }
  return chip;
}
function renderAttachments() {
  $('attachments').hidden = !attachments.length;
  $('attachments').replaceChildren(...attachments.map(item => attachmentChip(item, () => {
    attachments = attachments.filter(other => attachmentKey(other) !== attachmentKey(item));
    renderAttachments();
    controls();
  })));
  renderClipboard();
}
function addAttachments(items, version = draftVersion) {
  if (busy || version !== draftVersion) return;
  const merged = new Map(attachments.map(item => [attachmentKey(item), item]));
  for (const item of items) merged.set(attachmentKey(item), item);
  if (merged.size > 100) throw new Error('Attach up to 100 files or folders at a time.');
  attachments = [...merged.values()];
  renderAttachments();
  controls();
  $('prompt').focus();
}
function renderClipboard() {
  const available = clipboardAttachments.filter(item => !attachments.some(other => attachmentKey(other) === attachmentKey(item)));
  $('clipboard-preview').hidden = busy || !available.length;
  $('clipboard-label').textContent = available.length === 1
    ? `From clipboard: ${available[0].displayName}`
    : `${available.length} files or folders on clipboard`;
  $('clipboard-label').title = available.map(item => item.path).join('\n');
}
async function refreshClipboard() {
  if (!window.desktop || readingClipboard || !document.hasFocus() || document.hidden) return;
  readingClipboard = true;
  try { clipboardAttachments = await window.desktop.clipboardFiles(); }
  catch { clipboardAttachments = []; }
  finally { readingClipboard = false; renderClipboard(); }
}
async function pasteAttachments() {
  const version = draftVersion;
  try { addAttachments(await window.desktop.clipboardFiles(), version); }
  catch (error) { toast(error.message); }
}
async function chooseAttachments(kind) {
  const version = draftVersion;
  try {
    if (window.desktop) addAttachments(await window.desktop.chooseAttachments(kind), version);
    else {
      const filePath = window.prompt(`Enter the full path of the ${kind === 'directory' ? 'folder' : 'file'} on this laptop:`);
      if (filePath?.trim()) addAttachments(await post('/api/attachments/resolve', { paths: [filePath.trim().replace(/^"|"$/g, '')] }), version);
    }
  } catch (error) { toast(error.message); }
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000);
}
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'x-assistant-token': token, ...options.headers } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return res.json();
}
const post = (url, body = {}) => api(url, { method: 'POST', body: JSON.stringify(body) });
function controls() {
  $('permissions').textContent = current?.allowAll ? 'Allow all active · Reset' : 'Ask before actions';
  $('permissions').disabled = !current?.allowAll;
  $('send').disabled = !ready || busy || (!$('prompt').value.trim() && !attachments.length);
  $('send').hidden = busy;
  $('stop').hidden = !busy;
  $('new-chat').disabled = busy;
  $('model').disabled = busy || !!current;
  $('folder').disabled = busy || !!current;
  $('browse-folder').disabled = busy || !!current;
  $('prompt').disabled = busy;
  $('add-files').disabled = busy;
  $('add-folder').disabled = busy;
  $('attachments').querySelectorAll('button').forEach(button => { button.disabled = busy; });
  renderClipboard();
  $('run-status').textContent = busy ? 'Working…' : '';
}
function scrollIfNearBottom() {
  const scroller = $('chat-scroll');
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 450) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
}
function showMessage(message, delta = false) {
  $('welcome').hidden = true;
  $('messages').hidden = false;
  let node = messageNodes.get(message.id);
  if (!node) {
    node = document.createElement('article');
    node.className = `message ${message.role || 'assistant'}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = message.role === 'user' ? 'You' : message.role === 'error' ? 'Connection error' : message.role === 'notice' ? 'Activity' : '✳ Laptop Assistant';
    const content = document.createElement('div');
    content.className = 'message-content';
    node.append(label, content);
    if (!message.role || message.role === 'assistant') {
      const copy = document.createElement('button');
      copy.className = 'copy-message';
      copy.textContent = 'Copy response';
      copy.onclick = async () => {
        try { await (window.desktop ? window.desktop.copyText(node.rawContent || '') : navigator.clipboard.writeText(node.rawContent || '')); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy response'; }, 1500); }
        catch (error) { toast(error.message); }
      };
      node.append(copy);
    }
    $('messages').append(node);
    messageNodes.set(message.id, node);
  }
  const content = node.querySelector('.message-content');
  node.rawContent = delta ? (node.rawContent || '') + message.content : message.content;
  if (node.classList.contains('assistant')) {
    content.innerHTML = DOMPurify.sanitize(marked.parse(node.rawContent), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'form', 'input', 'button', 'style'], FORBID_ATTR: ['style'] });
  } else content.textContent = node.rawContent;
  if (message.attachments?.length && !node.querySelector('.message-attachments')) {
    const list = document.createElement('div');
    list.className = 'message-attachments';
    list.append(...message.attachments.map(item => attachmentChip(item)));
    node.append(list);
  }
  scrollIfNearBottom();
}
function showTool(data) {
  $('activity').hidden = false;
  let entry = toolNodes.get(data.id);
  if (!entry) {
    const node = document.createElement('details');
    node.className = 'tool';
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    node.append(summary, pre);
    $('tool-list').append(node);
    entry = { node, summary, pre, data: {} };
    toolNodes.set(data.id, entry);
  }
  Object.assign(entry.data, data);
  entry.summary.textContent = `${data.state === 'running' ? '◌' : data.state === 'failed' ? '×' : '✓'} ${entry.data.name || 'Tool'} — ${data.state}`;
  entry.pre.textContent = JSON.stringify({ arguments: entry.data.arguments, result: entry.data.result, error: entry.data.error }, null, 2);
  $('activity-title').textContent = data.state === 'running' ? `Using ${entry.data.name || 'a tool'}…` : 'Tool activity';
  $('activity-count').textContent = `${toolNodes.size} operation${toolNodes.size === 1 ? '' : 's'}`;
  scrollIfNearBottom();
}
async function history() {
  const chats = await api('/api/chats');
  $('chat-list').replaceChildren();
  if (!chats.length) {
    const p = document.createElement('p');
    p.className = 'empty-history';
    p.textContent = 'A fresh start. Your chats will appear here.';
    $('chat-list').append(p);
  }
  for (const chat of chats) {
    const button = document.createElement('button');
    button.className = `chat-item${chat.id === current?.id ? ' selected' : ''}`;
    button.textContent = chat.title;
    button.title = chat.title;
    button.onclick = () => { if (!busy) openChat(chat.id).catch(e => toast(e.message)); };
    $('chat-list').append(button);
  }
  filterChats();
}
function resetView() {
  draftVersion++;
  attachments = [];
  renderAttachments();
  messageNodes.clear();
  toolNodes.clear();
  $('messages').replaceChildren();
  $('tool-list').replaceChildren();
  $('activity').hidden = true;
  $('question').hidden = true;
  pendingQuestion = null;
}
async function openChat(id) {
  const chat = await api(`/api/chats/${id}`);
  if (chat.busy) throw new Error('This chat is running in another window. Stop it there before continuing.');
  current = chat;
  localStorage.setItem('lastChat', chat.id);
  resetView();
  $('chat-title').textContent = chat.title;
  if (![...$('model').options].some(o => o.value === chat.model)) $('model').add(new Option(chat.model, chat.model));
  $('model').value = chat.model;
  $('folder').value = chat.cwd;
  updateFolder();
  $('welcome').hidden = !!chat.messages.length;
  $('messages').hidden = !chat.messages.length;
  for (const message of chat.messages) showMessage(message);
  controls();
  await history();
}
function newChat() {
  if (busy) return;
  current = null;
  localStorage.removeItem('lastChat');
  resetView();
  $('welcome').hidden = false;
  $('messages').hidden = true;
  $('chat-title').textContent = 'New conversation';
  $('prompt').value = '';
  $('folder-panel').hidden = true;
  controls();
  history().catch(e => toast(e.message));
  $('prompt').focus();
}
function updateFolder() {
  $('folder-label').textContent = $('folder').value;
  $('folder-toggle').title = $('folder').value;
}
async function connection() {
  $('connection').className = 'connection';
  $('connection').textContent = 'Connecting to GitHub Copilot…';
  try {
    const status = await api('/api/status');
    ready = status.authenticated;
    if (!ready) throw new Error(window.desktop ? 'Sign in to GitHub to connect your Copilot account.' : 'Run copilot login in a terminal, then click Retry.');
    $('sign-in-panel').hidden = true;
    $('connection').textContent = `Connected to GitHub Copilot${status.login ? ` · ${status.login}` : ''}`;
    $('account-name').replaceChildren(document.createTextNode(status.login || 'Your workspace'));
    const accountDetail = document.createElement('small');
    accountDetail.textContent = 'GitHub Copilot';
    $('account-name').append(accountDetail);
    document.querySelector('.profile-icon').textContent = (status.login || 'U').slice(0, 1).toUpperCase();
    const selected = current?.model || $('model').value;
    $('model').replaceChildren(...status.models.map(m => new Option(m.name, m.id)));
    if (![...$('model').options].some(o => o.value === selected)) $('model').add(new Option(selected, selected));
    $('model').value = selected;
  } catch (error) {
    ready = false;
    $('connection').className = 'connection error';
    $('connection').textContent = error.message;
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = connection;
    $('connection').append(retry);
    if (window.desktop) {
      const signInButton = document.createElement('button');
      signInButton.textContent = 'Sign in to GitHub';
      signInButton.onclick = startSignIn;
      $('connection').append(signInButton);
    }
  }
  controls();
}
let signInTimer;
async function startSignIn() {
  clearTimeout(signInTimer);
  $('sign-in-panel').hidden = false;
  $('sign-in-retry').hidden = true;
  try {
    const state = await window.desktop.signIn();
    $('sign-in-output').textContent = state.output;
    const poll = async () => {
      try {
        const status = await window.desktop.signInStatus();
        $('sign-in-output').textContent = status.output + (status.error ? `\n${status.error}` : '');
        if (status.running) signInTimer = setTimeout(poll, 1000);
        else if (status.error) $('sign-in-retry').hidden = false;
        else await connection();
      } catch (error) { $('sign-in-output').textContent = error.message; $('sign-in-retry').hidden = false; }
    };
    await poll();
  } catch (error) { $('sign-in-output').textContent = error.message; $('sign-in-retry').hidden = false; }
}
$('sign-in-browser').onclick = () => { openLink('https://github.com/login/device').catch(error => toast(error.message)); };
$('sign-in-retry').onclick = startSignIn;
if (window.desktop?.platform === 'linux') {
  const checkLaptop = document.querySelector('[data-prompt^="Check my Windows"]');
  checkLaptop.dataset.prompt = 'Check my Linux distribution, available disk space, and memory using read-only commands. Give me a short overview.';
}
function question(data) {
  pendingQuestion = data.id;
  $('question').hidden = false;
  $('question-text').textContent = data.question;
  $('question-details').hidden = !data.details;
  $('question-details').textContent = data.details || '';
  $('question-choices').replaceChildren();
  $('answer-input').value = '';
  $('answer-form').hidden = data.allowFreeform === false && !!data.choices?.length;
  for (const choice of data.choices || []) {
    const button = document.createElement('button');
    button.textContent = choice;
    button.onclick = () => answer(choice, false);
    $('question-choices').append(button);
  }
  $('run-status').textContent = 'Waiting for your answer';
  $('question').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function answer(text, wasFreeform = true) {
  if (!text.trim() || !pendingQuestion) return;
  const id = pendingQuestion;
  try {
    await post(`/api/chats/${current.id}/answer`, { id, answer: text, wasFreeform });
    if (pendingQuestion === id) {
      pendingQuestion = null;
      $('question').hidden = true;
      $('run-status').textContent = 'Working…';
    }
  } catch (error) { toast(error.message); }
}
function handleEvent(type, data) {
  if (type === 'permissions' && current) { current.allowAll = data.allowAll; controls(); }
  if (type === 'delta') showMessage({ ...data, role: 'assistant' }, true);
  if (type === 'message' || type === 'user') showMessage(data);
  if (type === 'tool') showTool(data);
  if (type === 'question') question(data);
  if (type === 'error') showMessage({ id: crypto.randomUUID(), role: 'error', content: data.message });
  if (type === 'done' && data.stopped) showMessage({ id: crypto.randomUUID(), role: 'notice', content: 'Stopped. Actions already completed are retained.' });
}
async function send() {
  const prompt = $('prompt').value.trim();
  if ((!prompt && !attachments.length) || busy || !ready) return;
  busy = true;
  controls();
  toolNodes.clear();
  $('tool-list').replaceChildren();
  $('activity').hidden = true;
  let accepted = false;
  let reader;
  try {
    if (!current) {
      current = await post('/api/chats', { model: $('model').value, cwd: $('folder').value });
      localStorage.setItem('lastChat', current.id);
    }
    const res = await fetch(`/api/chats/${current.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-assistant-token': token },
      body: JSON.stringify({ prompt, attachments }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not send message.');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', doneEvent = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = event.split('\n');
        const type = lines.find(line => line.startsWith('event: '))?.slice(7);
        const raw = lines.find(line => line.startsWith('data: '))?.slice(6);
        if (!type || !raw) continue;
        if (type === 'user') { accepted = true; $('prompt').value = ''; attachments = []; draftVersion++; renderAttachments(); }
        if (type === 'done') doneEvent = true;
        handleEvent(type, JSON.parse(raw));
      }
    }
    if (!doneEvent) throw new Error('Connection interrupted. Reopen this conversation to see saved progress.');
  } catch (error) {
    await reader?.cancel().catch(() => {});
    toast(error.message);
    if (!accepted) $('prompt').value = prompt;
  } finally {
    busy = false;
    pendingQuestion = null;
    $('question').hidden = true;
    $('activity-title').textContent = 'Tool activity';
    controls();
    try {
      if (current) { current = await api(`/api/chats/${current.id}`); $('chat-title').textContent = current.title; }
      await history();
    } catch (error) { toast(error.message); }
    $('prompt').focus();
  }
}
$('composer').addEventListener('submit', e => { e.preventDefault(); void send(); });
$('add-files').onclick = () => { void chooseAttachments('file'); };
$('add-folder').onclick = () => { void chooseAttachments('directory'); };
$('paste-files').onclick = () => { void pasteAttachments(); };
if (!window.desktop) $('attachment-hint').textContent = 'Attach a local file or folder by its full path';
window.addEventListener('focus', () => { void refreshClipboard(); });
document.addEventListener('visibilitychange', () => { void refreshClipboard(); });
setInterval(() => { void refreshClipboard(); }, 1200);
void refreshClipboard();

// Capture file paste before Chromium inserts a filename as text. Preserve normal
// text editing in the composer and the other inputs.
document.addEventListener('paste', e => {
  if (!window.desktop || busy) return;
  const editingElsewhere = e.target.closest('input, textarea, [contenteditable="true"]') && e.target !== $('prompt');
  if (editingElsewhere) return;
  const files = [...(e.clipboardData?.files || [])];
  const hasText = !!e.clipboardData?.getData('text/plain');
  if (!files.length && (hasText || !clipboardAttachments.length)) return;
  e.preventDefault();
  const version = draftVersion;
  const paths = files.map(file => window.desktop.filePath(file)).filter(Boolean);
  if (paths.length) window.desktop.resolveAttachments(paths).then(items => addAttachments(items, version)).catch(error => toast(error.message));
  else void pasteAttachments();
});
// Explorer folder clipboards can have no web paste payload at all.
$('prompt').addEventListener('keydown', e => {
  if (!window.desktop || busy || !((e.ctrlKey && e.key.toLowerCase() === 'v') || (e.shiftKey && e.key === 'Insert'))) return;
  e.preventDefault();
  const version = draftVersion;
  const input = $('prompt'), start = input.selectionStart, end = input.selectionEnd, value = input.value;
  window.desktop.clipboardFiles().then(async items => {
    if (version !== draftVersion || busy) return;
    if (items.length) addAttachments(items, version);
    else {
      const text = await window.desktop.readText();
      if (version !== draftVersion || busy || input.value !== value) return;
      input.setRangeText(text.slice(0, Math.max(0, input.maxLength - value.length + end - start)), start, end, 'end');
      controls();
    }
  }).catch(error => toast(error.message));
});
let dragDepth = 0;
const fileDrag = e => [...(e.dataTransfer?.types || [])].includes('Files');
function clearDrag() { dragDepth = 0; $('drop-overlay').hidden = true; $('composer').classList.remove('drag-over'); }
document.addEventListener('dragenter', e => {
  if (!fileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  if (!busy) { $('drop-overlay').hidden = false; $('composer').classList.add('drag-over'); }
});
document.addEventListener('dragover', e => {
  if (!fileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
});
document.addEventListener('dragleave', e => { if (fileDrag(e) && --dragDepth <= 0) clearDrag(); });
document.addEventListener('dragend', clearDrag);
window.addEventListener('blur', clearDrag);
document.addEventListener('drop', e => {
  clearDrag();
  if (!fileDrag(e)) return;
  e.preventDefault();
  if (busy) { toast('Wait for the current response before attaching files.'); return; }
  if (!window.desktop) { toast('Open the desktop app to drag and drop files or folders, or use Add files / Add folder to enter a path.'); return; }
  const version = draftVersion;
  const paths = [...e.dataTransfer.files].map(file => window.desktop.filePath(file)).filter(Boolean);
  if (!paths.length) { toast('Drag files or folders from File Explorer.'); return; }
  window.desktop.resolveAttachments(paths).then(items => addAttachments(items, version)).catch(error => toast(error.message));
});
$('prompt').addEventListener('input', controls);
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); } });
$('new-chat').onclick = newChat;
document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); } });
document.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => { $('prompt').value = button.dataset.prompt; controls(); $('prompt').focus(); }; });
$('stop').onclick = async () => {
  if (!current) return;
  $('stop').disabled = true;
  $('run-status').textContent = 'Stopping…';
  try { await post(`/api/chats/${current.id}/stop`); } catch (error) { toast(error.message); }
  finally { $('stop').disabled = false; }
};
$('permissions').onclick = async () => {
  try { await post(`/api/chats/${current.id}/permissions`, { allowAll: false }); current.allowAll = false; controls(); }
  catch (error) { toast(error.message); }
};
$('folder-toggle').onclick = () => { $('folder-panel').hidden = !$('folder-panel').hidden; };
$('folder').addEventListener('input', updateFolder);
$('browse-folder').hidden = !window.desktop;
$('browse-folder').onclick = async () => {
  try {
    const folder = await window.desktop.chooseFolder();
    if (folder) { $('folder').value = folder; updateFolder(); }
  } catch (error) { toast(error.message); }
};
$('sidebar-toggle').onclick = () => { document.body.classList.toggle('sidebar-collapsed'); };
function filterChats() {
  const query = $('search-chats').value.trim().toLowerCase();
  document.querySelectorAll('.chat-item').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
}
$('search-chats').addEventListener('input', filterChats);
async function openLink(href) {
  const url = new URL(href);
  if (href.length > 8192 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid web link.');
  if (window.desktop) await window.desktop.openLink(url.href);
  else window.open(url.href, '_blank', 'noopener,noreferrer');
}
function followLink(e) {
  const link = e.target.closest('a');
  if (!link) return;
  e.preventDefault();
  if (e.type === 'click' || e.button === 1) openLink(link.href).catch(error => toast(error.message));
}
$('messages').addEventListener('click', followLink);
$('messages').addEventListener('auxclick', followLink);
$('answer-form').addEventListener('submit', e => { e.preventDefault(); void answer($('answer-input').value); });
window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

try {
  let bootstrap;
  if (window.desktop) {
    bootstrap = await window.desktop.bootstrap();
    token = bootstrap.token;
  } else {
    const fragment = location.hash.slice(1);
    window.history.replaceState(null, '', location.pathname + location.search);
    if (/^[a-f0-9]{64}$/.test(fragment)) sessionStorage.setItem('assistantToken', fragment);
    token = sessionStorage.getItem('assistantToken') || '';
    bootstrap = await api('/api/bootstrap');
  }
  $('folder').value = bootstrap.home;
  updateFolder();
  await connection();
  const last = localStorage.getItem('lastChat');
  if (last) await openChat(last).catch(e => { toast(e.message); localStorage.removeItem('lastChat'); });
  await history();
  $('prompt').focus();
} catch (error) {
  $('connection').textContent = `Unable to connect: ${error.message}`;
  $('connection').className = 'connection error';
}
