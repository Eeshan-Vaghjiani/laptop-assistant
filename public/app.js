import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
const $ = id => document.getElementById(id);
let token, current = null, busy = false, ready = false, pendingQuestion = null;
const messageNodes = new Map();
const toolNodes = new Map();
let toastTimer;
let settings = { model: 'gpt-6-astra', effort: 'max', access: 'ask' }, models = [], changingModel = false;
let queue = [], queuePaused = false, interruptRequested = false;
function renderQueue() {
  $('message-queue').hidden = !queue.length;
  $('queue-label').textContent = `${queue.length} follow-up${queue.length === 1 ? '' : 's'} ${queuePaused ? 'paused' : 'queued'} · sent in order after this response`;
  $('queue-resume').hidden = !queuePaused;
  $('queue-list').replaceChildren(...queue.map((item, index) => {
    const li = document.createElement('li'), text = document.createElement('span');
    text.textContent = `${index + 1}. ${item.prompt || 'Attached files'}${item.attachments.length ? ` · ${item.attachments.length} attachment(s)` : ''}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
    edit.onclick = () => {
      if ($('prompt').value.trim() || attachments.length) { toast('Send or clear your current draft before editing a queued message.'); return; }
      queue.splice(index, 1); $('prompt').value = item.prompt; attachments = item.attachments; renderAttachments(); renderQueue(); controls(); $('prompt').focus();
    };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.onclick = () => { queue.splice(index, 1); renderQueue(); };
    li.append(text, edit, remove); return li;
  }));
  $('new-chat').disabled = busy || queue.length > 0;
}
function progress(text) {
  if (!text || $('progress-log').lastElementChild?.dataset.text === text) return;
  const li = document.createElement('li'); li.dataset.text = text;
  li.textContent = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${text}`;
  $('progress-log').append(li);
  while ($('progress-log').children.length > 60) $('progress-log').firstElementChild.remove();
  $('progress-summary').textContent = text;
  $('progress-log').scrollTop = $('progress-log').scrollHeight;
}
const toolSummary = (name, args = {}) => name === 'assistant_find_files' ? `Searching ${args.kind || 'all'} files${args.query ? ` for “${args.query}”` : ''}${args.days ? ` · last ${args.days} days` : ''}`
  : name === 'assistant_read_document' ? `Reading ${String(args.path || 'document').split(/[\\/]/).at(-1)}${args.page ? ` · page ${args.page}` : ''}`
  : name === 'assistant_inspect_images' ? `Inspecting ${args.paths?.length || ''} image(s) visually`
  : name === 'assistant_show_files' ? 'Preparing file results' : `Using ${name || 'a tool'}`;
let runPhase = 'idle', runLabel = 'Ready when you are', runStarted = 0, runFinished = 0, lastSignal = 0;
const effortNames = { auto: 'Model default', none: 'None', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
function setRun(phase, label) {
  runPhase = phase; runLabel = label; lastSignal = Date.now();
  if (['done', 'stopped', 'error', 'incomplete'].includes(phase)) runFinished = Date.now();
  renderRun();
}
function renderRun() {
  $('run-indicator').dataset.phase = runPhase;
  $('run-label').textContent = runLabel;
  const seconds = runStarted ? Math.floor(((runFinished || Date.now()) - runStarted) / 1000) : 0;
  $('run-elapsed').textContent = runStarted ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
  const working = busy && !['done', 'stopped', 'error', 'incomplete'].includes(runPhase);
  $('chat-scroll').setAttribute('aria-busy', String(working));
  const activeTools = [...toolNodes.values()].filter(e => e.data.state === 'running');
  $('run-detail').textContent = runPhase === 'waiting' ? 'Your response is needed to continue'
    : working && Date.now() - lastSignal > 25000 ? 'Still working — waiting for the next update'
    : activeTools.length && working ? `${activeTools.length} operation${activeTools.length > 1 ? 's' : ''} in progress · expand Tool activity for details`
    : working ? 'You can stop this task at any time. Thinking text stays private.'
    : runPhase === 'done' ? 'Response finished — ready for your next message'
    : runPhase === 'incomplete' ? 'No final answer received. Add a follow-up or ask to continue.'
    : runPhase === 'error' ? 'The task did not finish successfully. Check the message above.'
    : runPhase === 'stopped' ? 'Stopped by you. Completed actions are retained.'
    : `${$('model').selectedOptions[0]?.textContent || 'Your assistant'} · ${effortNames[$('effort').value] || 'Model default'}`;
  $('run-status').textContent = working ? runLabel : runPhase === 'done' ? '✓ Done' : '';
}
setInterval(renderRun, 1000);
function renderEffort(preferred = settings.effort) {
  const model = models.find(m => m.id === $('model').value);
  const efforts = model?.efforts || [];
  $('effort').replaceChildren(...(efforts.length ? ['auto', ...efforts] : ['auto']).map(e => new Option(effortNames[e] || e, e)));
  $('effort').value = efforts.includes(preferred) || preferred === 'auto' ? preferred : model?.defaultEffort || efforts.at(-1) || 'auto';
  $('effort').disabled = busy || changingModel || !efforts.length;
}
async function persistSettings(patch) { settings = await post('/api/settings', patch); return settings; }
async function rememberChat(id) { try { await persistSettings({ lastChat: id }); } catch (error) { toast(error.message); } }
async function changeModel() {
  if (busy || changingModel) return;
  changingModel = true; controls();
  try {
    const choice = { model: $('model').value, effort: $('effort').value };
    if (current) { Object.assign(current, await post(`/api/chats/${current.id}/model`, choice)); }
    await persistSettings(choice);
    setRun('idle', 'Model ready');
  } catch (error) { toast(error.message); $('model').value = current?.model || settings.model; renderEffort(current?.effort || settings.effort); }
  finally { changingModel = false; controls(); }
}

function fileCard(file) {
  const card = document.createElement('article'); card.className = 'file-card';
  const title = document.createElement('strong'); title.textContent = `${file.kind === 'image' ? '▧' : file.kind === 'folder' ? '▱' : '▤'} ${file.displayName}`;
  const location = document.createElement('small'); location.textContent = file.path; location.title = file.path;
  const meta = document.createElement('p'); meta.textContent = `${file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : ''}${file.size ? ` · ${(file.size / 1024).toFixed(0)} KB` : ''}`;
  const evidence = document.createElement('p'); evidence.className = 'file-evidence'; evidence.textContent = file.evidence || 'Attached file';
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const button = (label, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => Promise.resolve().then(action).catch(e => toast(e.message)); actions.append(b); };
  button('Preview', () => preview(file.path));
  if (window.desktop) { button('Show in folder', () => window.desktop.fileAction(file.path, 'reveal')); button('Open', () => window.desktop.fileAction(file.path, 'open')); }
  button('Attach', async () => { addAttachments(await post('/api/attachments/resolve', { paths: [file.path] })); });
  card.append(title, location, meta, evidence, actions); return card;
}
function showFiles(data) {
  $('file-results').hidden = false;
  $('file-results-title').textContent = data.title || `${data.files.length} files found`;
  $('file-results-note').textContent = `${data.note || ''}${data.scanned !== undefined ? ` Checked ${data.scanned} files.` : ''}${!data.files.length ? ' No matching files in this search.' : ''}`;
  $('file-results-list').replaceChildren(...data.files.map(fileCard));
  scrollIfNearBottom();
}
let previewPath, previewPage = 1, previewVersion = 0;
async function preview(filePath, page = 1) {
  const version = ++previewVersion; previewPath = filePath; previewPage = page;
  $('preview-title').textContent = 'Loading preview…'; $('preview-path').textContent = filePath;
  $('preview-body').textContent = 'Loading…';
  $('preview-previous').hidden = true; $('preview-next').hidden = true; $('preview-page').textContent = '';
  $('preview-reveal').hidden = !window.desktop;
  if (!$('preview-dialog').open) $('preview-dialog').showModal();
  try {
    const data = await post('/api/files/preview', { path: filePath, page });
    if (version !== previewVersion) return;
    $('preview-title').textContent = data.displayName;
    const content = document.createElement(data.data ? 'img' : 'pre');
    if (data.data) { content.src = `data:${data.mimeType};base64,${data.data}`; content.alt = data.displayName; }
    else content.textContent = data.text || 'No text available.';
    $('preview-body').replaceChildren(content);
    $('preview-previous').hidden = !data.pageCount || page <= 1;
    $('preview-next').hidden = !data.pageCount || page >= data.pageCount;
    $('preview-page').textContent = data.pageCount ? `Page ${page} / ${data.pageCount}` : data.truncated ? 'Excerpt shown' : '';
  } catch (error) { if (version === previewVersion) { $('preview-title').textContent = 'Preview unavailable'; $('preview-body').textContent = error.message; } }
}
let attachments = [], clipboardAttachments = [], readingClipboard = false, draftVersion = 0;
const attachmentKey = item => window.desktop?.platform === 'linux' ? item.path : item.path.toLowerCase();

function attachmentChip(item, remove) {
  const chip = document.createElement('div');
  chip.className = 'attachment-chip';
  chip.title = item.path;
  const label = document.createElement('span');
  label.textContent = `${item.type === 'directory' ? '▱ Folder' : '▤ File'} · ${item.displayName}`;
  chip.append(label);
  label.tabIndex = 0;
  label.setAttribute('role', 'button');
  label.title = 'Preview attachment';
  label.onclick = () => { void preview(item.path); };
  label.onkeydown = e => { if (e.key === 'Enter') void preview(item.path); };
  if (remove) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '×';
    button.setAttribute('aria-label', `Remove ${item.displayName}`);
    button.disabled = false;
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
  if (version !== draftVersion) return;
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
  $('clipboard-preview').hidden = !available.length;
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
  $('permissions').textContent = settings.access === 'full' ? '● Full control' : current?.allowAll ? '● Chat access enabled' : '◉ Ask before actions';
  $('permissions').disabled = false;
  $('send').disabled = !ready || changingModel || (!$('prompt').value.trim() && !attachments.length);
  $('send').hidden = false;
  $('send').textContent = busy ? '＋' : '↑';
  $('send').setAttribute('aria-label', busy ? 'Queue message' : 'Send message');
  $('send').title = busy ? 'Queue this follow-up for after the current response' : 'Send message';
  $('prompt').placeholder = busy ? 'Add information or a follow-up… Enter to queue' : 'Message Laptop Assistant';
  $('interrupt-send').hidden = !busy;
  $('interrupt-send').disabled = !$('prompt').value.trim() && !attachments.length;
  $('stop').hidden = !busy;
  $('new-chat').disabled = busy || queue.length > 0;
  $('model').disabled = busy || changingModel;
  $('effort').disabled = busy || changingModel || !(models.find(m => m.id === $('model').value)?.efforts?.length);
  $('folder').disabled = busy || !!current;
  $('browse-folder').disabled = busy || !!current;
  $('prompt').disabled = false;
  $('add-files').disabled = false;
  $('add-folder').disabled = false;
  $('attachments').querySelectorAll('button').forEach(button => { button.disabled = false; });
  renderClipboard();
  renderRun();
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
  if (message.files?.length && !node.querySelector('.file-grid')) { const files = document.createElement('div'); files.className = 'file-grid'; files.append(...message.files.map(fileCard)); node.append(files); }
  if (message.progress) { node.classList.add('progress-message'); node.querySelector('.message-label').textContent = 'Activity update'; progress(message.content); }
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
  if (data.state === 'running') { progress(toolSummary(entry.data.name, entry.data.arguments)); $('progress-panel').open = true; }
  else progress(`${data.state === 'failed' ? 'Failed' : 'Finished'}: ${entry.data.name || 'tool'}`);
  if (busy && runPhase !== 'waiting') setRun(data.state === 'running' ? 'tool' : 'thinking', data.state === 'running' ? `Using ${entry.data.name || 'a tool'}` : 'Reviewing results');
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
    button.onclick = () => { if (queue.length) return toast('Send or remove queued messages before switching chats.'); if (!busy) openChat(chat.id).catch(e => toast(e.message)); };
    $('chat-list').append(button);
  }
  filterChats();
}
function resetView() {
  $('progress-log').replaceChildren(); $('progress-summary').textContent = 'Ready';
  runStarted = 0; runFinished = 0; setRun('idle', 'Ready when you are');
  $('file-results').hidden = true;
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
  void rememberChat(chat.id);
  resetView();
  $('chat-title').textContent = chat.title;
  if (![...$('model').options].some(o => o.value === chat.model)) $('model').add(new Option(chat.model, chat.model));
  $('model').value = chat.model;
  renderEffort(chat.effort || settings.effort);
  $('folder').value = chat.cwd;
  updateFolder();
  $('welcome').hidden = !!chat.messages.length;
  $('messages').hidden = !chat.messages.length;
  for (const message of chat.messages) showMessage(message);
  controls();
  await history();
}
function newChat() {
  if (busy || queue.length) return;
  current = null;
  localStorage.removeItem('lastChat');
  void rememberChat(null);
  resetView();
  $('welcome').hidden = false;
  $('messages').hidden = true;
  $('chat-title').textContent = 'New conversation';
  $('prompt').value = '';
  $('folder-panel').hidden = true;
  if (models.some(m => m.id === settings.model)) $('model').value = settings.model;
  renderEffort();
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
    if (status.settings) settings = status.settings;
    models = status.models;
    const selected = current?.model || (models.some(m => m.id === settings.model) ? settings.model : 'auto');
    $('model').replaceChildren(...status.models.map(m => new Option(m.name, m.id)));
    if (![...$('model').options].some(o => o.value === selected)) $('model').add(new Option(selected, selected));
    $('model').value = selected;
    renderEffort(current?.effort || settings.effort);
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
  setRun('waiting', data.permission ? 'Approval needed' : 'Waiting for your answer');
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
      setRun('thinking', 'Continuing');
    }
  } catch (error) { toast(error.message); }
}
function handleEvent(type, data) {
  lastSignal = Date.now();
  if (type === 'status' && !pendingQuestion) { setRun(data.phase, data.label); progress(data.label); }
  if (type === 'files') { showFiles(data); progress(`Found ${data.files.length} candidate(s); contents still need verification`); }
  if (type === 'permissions' && current) { current.allowAll = data.allowAll; controls(); }
  if (type === 'delta') { setRun('writing', 'Writing response'); showMessage({ ...data, role: 'assistant' }, true); }
  if (type === 'message' || type === 'user') showMessage(data);
  if (type === 'tool') showTool(data);
  if (type === 'question') question(data);
  if (type === 'error') { setRun('error', 'Something went wrong'); showMessage({ id: crypto.randomUUID(), role: 'error', content: data.message }); }
  if (type === 'done') {
    setRun(data.stopped ? 'stopped' : data.failed ? 'error' : data.incomplete ? 'incomplete' : 'done', data.stopped ? 'Stopped' : data.failed ? 'Could not finish' : data.incomplete ? 'Answer incomplete' : 'Response finished');
    progress(runLabel);
    if ((data.stopped || data.failed || data.incomplete) && !interruptRequested) queuePaused = true;
    renderQueue();
  }
  if (type === 'done' && data.stopped) showMessage({ id: crypto.randomUUID(), role: 'notice', content: 'Stopped. Actions already completed are retained.' });
}
async function send(queuedItem = null) {
  const item = queuedItem || { prompt: $('prompt').value.trim(), attachments: [...attachments] };
  const prompt = item.prompt;
  if ((!prompt && !item.attachments.length) || changingModel || !ready) return;
  if (busy) {
    if (queue.length >= 10) return toast('Up to 10 follow-ups can be queued.');
    queue.push(item); $('prompt').value = ''; attachments = []; draftVersion++; renderAttachments(); renderQueue(); controls();
    return;
  }
  if (!queuedItem) { $('prompt').value = ''; attachments = []; draftVersion++; renderAttachments(); }
  busy = true;
  runStarted = Date.now(); runFinished = 0; setRun('connecting', 'Starting your task');
  controls();
  toolNodes.clear();
  $('tool-list').replaceChildren();
  $('activity').hidden = true;
  $('progress-log').replaceChildren(); progress('Task started');
  let accepted = false;
  let reader;
  try {
    if (!current) {
      current = await post('/api/chats', { model: $('model').value, effort: $('effort').value, cwd: $('folder').value });
      localStorage.setItem('lastChat', current.id);
      void rememberChat(current.id);
    }
    const res = await fetch(`/api/chats/${current.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-assistant-token': token },
      body: JSON.stringify({ prompt, attachments: item.attachments }),
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
        if (type === 'user') { accepted = true; }
        if (type === 'done') doneEvent = true;
        handleEvent(type, JSON.parse(raw));
      }
    }
    if (!doneEvent) throw new Error('Connection interrupted. Reopen this conversation to see saved progress.');
  } catch (error) {
    setRun('error', 'Connection or task interrupted');
    await reader?.cancel().catch(() => {});
    toast(error.message);
    queuePaused = true;
    if (!accepted) { queue.unshift(item); renderQueue(); }
  } finally {
    pendingQuestion = null;
    $('question').hidden = true;
    $('activity-title').textContent = 'Tool activity';
    try {
      if (current) { current = await api(`/api/chats/${current.id}`); $('chat-title').textContent = current.title; }
      await history();
    } catch (error) { toast(error.message); }
    busy = false;
    if (interruptRequested) { queuePaused = false; interruptRequested = false; }
    controls(); renderQueue();
    $('prompt').focus();
    if (queue.length && !queuePaused) { const next = queue.shift(); renderQueue(); void send(next); }
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
  if (!window.desktop) return;
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
  if (!window.desktop || !((e.ctrlKey && e.key.toLowerCase() === 'v') || (e.shiftKey && e.key === 'Insert'))) return;
  e.preventDefault();
  const version = draftVersion;
  const input = $('prompt'), start = input.selectionStart, end = input.selectionEnd, value = input.value;
  window.desktop.clipboardFiles().then(async items => {
    if (version !== draftVersion) return;
    if (items.length) addAttachments(items, version);
    else {
      const text = await window.desktop.readText();
      if (version !== draftVersion || input.value !== value) return;
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
  $('drop-overlay').hidden = false; $('composer').classList.add('drag-over');
});
document.addEventListener('dragover', e => {
  if (!fileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', e => { if (fileDrag(e) && --dragDepth <= 0) clearDrag(); });
document.addEventListener('dragend', clearDrag);
window.addEventListener('blur', clearDrag);
document.addEventListener('drop', e => {
  clearDrag();
  if (!fileDrag(e)) return;
  e.preventDefault();
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
  queuePaused = true; interruptRequested = false; renderQueue();
  if (!current) return;
  $('stop').disabled = true;
  setRun('stopping', 'Stopping safely…');
  try { await post(`/api/chats/${current.id}/stop`); } catch (error) { toast(error.message); }
  finally { $('stop').disabled = false; }
};
$('permissions').onclick = () => $('settings-open').click();
$('model').onchange = () => { renderEffort(); void changeModel(); };
$('effort').onchange = () => { void changeModel(); };
$('settings-open').onclick = () => { $('access-mode').value = settings.access; $('settings-status').textContent = ''; $('settings-dialog').showModal(); };
$('settings-close').onclick = () => $('settings-dialog').close();
$('settings-save').onclick = async () => {
  $('settings-save').disabled = true;
  try {
    await persistSettings({ access: $('access-mode').value });
    if (settings.access === 'ask' && current?.allowAll) { await post(`/api/chats/${current.id}/permissions`, { allowAll: false }); current.allowAll = false; }
    $('settings-status').textContent = 'Saved for all conversations'; controls();
  }
  catch (error) { $('settings-status').textContent = error.message; }
  finally { $('settings-save').disabled = false; }
};
$('queue-resume').onclick = () => { queuePaused = false; renderQueue(); if (!busy && queue.length) { const next = queue.shift(); renderQueue(); void send(next); } };
$('interrupt-send').onclick = async () => {
  if (!busy || !current || (!$('prompt').value.trim() && !attachments.length)) return;
  if (queue.length >= 10) return toast('Remove a queued message first (10 maximum).');
  const item = { prompt: $('prompt').value.trim(), attachments: [...attachments] };
  queue.unshift(item); $('prompt').value = ''; attachments = []; draftVersion++; renderAttachments();
  interruptRequested = true; queuePaused = true; renderQueue(); controls(); setRun('stopping', 'Stopping — your follow-up is next');
  try { await post(`/api/chats/${current.id}/stop`, {}); }
  catch (error) { interruptRequested = false; toast(error.message); }
};
$('files-open').onclick = () => $('file-search-dialog').showModal();
$('file-search-close').onclick = () => $('file-search-dialog').close();
$('file-results-close').onclick = () => { $('file-results').hidden = true; };
$('file-search-form').onsubmit = async e => {
  e.preventDefault(); $('file-search-submit').disabled = true; $('file-search-status').textContent = 'Searching your folders…';
  try {
    const result = await post('/api/files/search', { query: $('file-query').value, kind: $('file-kind').value, days: Number($('file-days').value), content: $('file-content').checked });
    showFiles(result); $('file-search-dialog').close(); $('file-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('file-search-status').textContent = '';
  } catch (error) { $('file-search-status').textContent = error.message; }
  finally { $('file-search-submit').disabled = false; }
};
$('preview-close').onclick = () => { previewVersion++; $('preview-dialog').close(); };
$('preview-previous').onclick = () => { void preview(previewPath, previewPage - 1); };
$('preview-next').onclick = () => { void preview(previewPath, previewPage + 1); };
$('preview-reveal').onclick = () => window.desktop.fileAction(previewPath, 'reveal').catch(e => toast(e.message));
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
window.addEventListener('beforeunload', e => { if (busy || queue.length) { e.preventDefault(); e.returnValue = ''; } });

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
   const last = settings.lastChat || localStorage.getItem('lastChat');
  if (last) await openChat(last).catch(e => { toast(e.message); localStorage.removeItem('lastChat'); });
  await history();
  $('prompt').focus();
} catch (error) {
  $('connection').textContent = `Unable to connect: ${error.message}`;
  $('connection').className = 'connection error';
}
