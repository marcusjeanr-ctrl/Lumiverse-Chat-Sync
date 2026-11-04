// Chat Sync to GitHub — backend (runs in the Lumiverse extension worker).
// Turns a chat into one Markdown file and writes it to a GitHub repo through
// the Contents API. Each chat overwrites its own file, plus latest.md.

const TOKEN_KEY = 'github_token';
const SETTINGS_PATH = 'settings.json';
const DEFAULTS = { repo: '', branch: 'main', folder: 'chats', autoMinutes: 5, includeData: true };
const timers = new Map(); // `${userId}:${chatId}` -> timeout
const busy = new Set();

function cleanSettings(s = {}) {
  const repo = String(s.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return {
    repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '',
    branch: String(s.branch || 'main').trim() || 'main',
    folder: String(s.folder ?? 'chats').trim().replace(/^\/+|\/+$/g, ''),
    autoMinutes: [0, 1, 5, 15, 30].includes(Number(s.autoMinutes)) ? Number(s.autoMinutes) : 5,
    includeData: s.includeData !== false,
  };
}

async function loadSettings(userId) {
  try { return cleanSettings({ ...DEFAULTS, ...JSON.parse(await spindle.userStorage.read(SETTINGS_PATH, userId)) }); }
  catch { return { ...DEFAULTS }; }
}

async function hasToken(userId) {
  try { return await spindle.enclave.has(TOKEN_KEY, userId); } catch { return false; }
}

function slug(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'chat';
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function chatToMarkdown(chat, messages, includeData) {
  const firstBot = messages.find(m => !m.is_user)?.name;
  const title = chat?.name || firstBot || 'Chat';
  const lines = [
    `# ${title}`,
    '',
    `- Chat ID: ${chat?.id || messages[0]?.chat_id || 'unknown'}`,
    `- Exported: ${new Date().toISOString()}`,
    `- Messages: ${messages.length}`,
    '',
    '---',
  ];
  const sorted = [...messages].sort((a, b) => (a.index_in_chat ?? 0) - (b.index_in_chat ?? 0));
  for (const m of sorted) {
    const who = m.name || (m.is_user ? 'User' : 'Assistant');
    const when = m.send_date || m.created_at;
    const date = when ? ` · ${new Date(typeof when === 'number' && when < 1e12 ? when * 1000 : when).toISOString()}` : '';
    const swipe = m.swipes?.length > 1 ? ` · swipe ${m.swipe_id + 1}/${m.swipes.length}` : '';
    lines.push('', `### #${m.index_in_chat ?? '?'} · ${who} (${m.role || (m.is_user ? 'user' : 'assistant')})${date}${swipe}`, '', String(m.content ?? ''));
    if (includeData) {
      const data = {};
      if (m.extra && Object.keys(m.extra).length) data.extra = m.extra;
      if (m.metadata && Object.keys(m.metadata).length) data.metadata = m.metadata;
      if (Object.keys(data).length) {
        lines.push('', '<details><summary>message data</summary>', '', '```json', JSON.stringify(data), '```', '', '</details>');
      }
    }
  }
  return { title, markdown: lines.join('\n') + '\n' };
}

async function github(token, method, url, body) {
  const res = await spindle.cors(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lumiverse-chat-sync',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function putFile(token, s, path, content, message) {
  const base = `https://api.github.com/repos/${s.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const existing = await github(token, 'GET', `${base}?ref=${encodeURIComponent(s.branch)}`);
  if (existing.status === 401) throw new Error('GitHub rejected the token (401). Check it or make a new one.');
  const sha = existing.status === 200 ? existing.json?.sha : undefined;
  const res = await github(token, 'PUT', base, { message, content: toBase64(content), branch: s.branch, ...(sha ? { sha } : {}) });
  if (res.status === 200 || res.status === 201) return;
  if (res.status === 404) throw new Error(`Repo "${s.repo}" or branch "${s.branch}" not found, or the token can't write to it.`);
  if (res.status === 403) throw new Error('Token lacks permission. It needs Contents: Read and write on this repo.');
  if (res.status === 409) throw new Error('GitHub reported a conflict. Try again.');
  throw new Error(`GitHub error ${res.status}: ${res.json?.message || 'unknown'}`);
}

async function syncChat(userId, chatId, reason) {
  const key = `${userId}:${chatId}`;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const s = await loadSettings(userId);
    if (!s.repo) throw new Error('Set the repo first (owner/name).');
    const token = await spindle.enclave.get(TOKEN_KEY, userId);
    if (!token) throw new Error('Add your GitHub token first.');
    const chat = await spindle.chats.get(chatId, userId).catch(() => null);
    const messages = await spindle.chat.getMessages(chatId);
    if (!messages?.length) throw new Error('This chat has no messages yet.');
    const { title, markdown } = chatToMarkdown(chat, messages, s.includeData);
    const folder = s.folder ? `${s.folder}/` : '';
    const file = `${folder}${slug(title)}-${String(chatId).slice(0, 8)}.md`;
    const msg = `Sync "${title}" (${messages.length} messages)`;
    await putFile(token, s, file, markdown, msg);
    await putFile(token, s, `${folder}latest.md`, markdown, `latest: ${title}`);
    const status = { ok: true, text: `Pushed "${title}" (${messages.length} messages) to ${s.repo}/${file}`, at: Date.now(), reason };
    spindle.sendToFrontend({ type: 'chatsync:status', status }, userId);
    spindle.log.info(`[chat-sync] ${status.text}`);
  } catch (err) {
    const status = { ok: false, text: err?.message || String(err), at: Date.now(), reason };
    spindle.sendToFrontend({ type: 'chatsync:status', status }, userId);
    spindle.log.warn(`[chat-sync] ${status.text}`);
  } finally {
    busy.delete(key);
  }
}

async function sendState(userId) {
  spindle.sendToFrontend({ type: 'chatsync:state', settings: await loadSettings(userId), hasToken: await hasToken(userId) }, userId);
}

spindle.onFrontendMessage(async (payload, userId) => {
  if (!payload || typeof payload !== 'object') return;
  try {
    if (payload.type === 'chatsync:get_state') return sendState(userId);
    if (payload.type === 'chatsync:save') {
      const s = cleanSettings(payload.settings);
      await spindle.userStorage.write(SETTINGS_PATH, JSON.stringify(s), userId);
      if (typeof payload.token === 'string' && payload.token.trim()) await spindle.enclave.put(TOKEN_KEY, payload.token.trim(), userId);
      if (payload.clearToken) await spindle.enclave.delete(TOKEN_KEY, userId);
      spindle.sendToFrontend({ type: 'chatsync:status', status: { ok: true, text: 'Settings saved.', at: Date.now() } }, userId);
      return sendState(userId);
    }
    if (payload.type === 'chatsync:push_now') {
      const chat = await spindle.chats.getActive(userId);
      if (!chat) throw new Error('Open a chat first.');
      return syncChat(userId, chat.id, 'manual');
    }
  } catch (err) {
    spindle.sendToFrontend({ type: 'chatsync:status', status: { ok: false, text: err?.message || String(err), at: Date.now() } }, userId);
  }
});

// Auto-push: after an AI reply finishes, wait until the chat has been quiet
// for the chosen number of minutes, then push once. Keeps commit count low.
spindle.on('GENERATION_ENDED', async (payload, userId) => {
  const chatId = payload?.chatId;
  if (!chatId || payload?.error) return;
  const s = await loadSettings(userId);
  if (!s.autoMinutes || !s.repo) return;
  const key = `${userId}:${chatId}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); syncChat(userId, chatId, 'auto'); }, s.autoMinutes * 60_000));
});

spindle.log.info('Chat Sync to GitHub ready.');
