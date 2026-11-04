// Chat Sync to GitHub — frontend: one drawer tab with settings and a Push button.

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>';

const CSS = `
.cs-wrap{padding:14px;display:flex;flex-direction:column;gap:12px;font-size:14px}
.cs-wrap label{display:flex;flex-direction:column;gap:4px;font-weight:600}
.cs-wrap small{font-weight:400;opacity:.7}
.cs-wrap input,.cs-wrap select{padding:8px;border-radius:8px;border:1px solid var(--lumiverse-border,#8884);background:transparent;color:inherit;font:inherit}
.cs-row{display:flex;gap:8px;align-items:center}
.cs-check{flex-direction:row!important;align-items:center;gap:8px!important;font-weight:400!important}
.cs-wrap button{padding:9px 12px;border-radius:8px;border:1px solid var(--lumiverse-border,#8884);background:transparent;color:inherit;font:inherit;cursor:pointer}
.cs-primary{background:var(--lumiverse-primary,#4a7)!important;color:#fff!important;border:none!important;font-weight:600!important}
.cs-status{padding:8px 10px;border-radius:8px;background:#8881;white-space:pre-wrap;word-break:break-word}
.cs-status.err{background:#c443}
.cs-status.ok{background:#4a73}
`;

export function setup(ctx) {
  const removeStyle = ctx.dom.addStyle(CSS);
  const tab = ctx.ui.registerDrawerTab({ id: 'chat-sync', title: 'Chat Sync', shortName: 'Sync', iconSvg: ICON, description: 'Push chats to GitHub' });
  const root = tab.root;
  root.innerHTML = `
    <div class="cs-wrap">
      <label>GitHub repo <small>owner/name, e.g. marcusjeanr-ctrl/lumiverse-chats</small><input id="cs-repo" autocomplete="off" spellcheck="false"></label>
      <div class="cs-row">
        <label style="flex:1">Branch<input id="cs-branch" autocomplete="off" spellcheck="false"></label>
        <label style="flex:1">Folder<input id="cs-folder" autocomplete="off" spellcheck="false"></label>
      </div>
      <label>GitHub token <small id="cs-token-state"></small><input id="cs-token" type="password" autocomplete="off" placeholder="Paste a new token to replace"></label>
      <label>Auto-push <small>after the chat has been quiet this long</small>
        <select id="cs-auto">
          <option value="0">Off (button only)</option>
          <option value="1">1 minute</option>
          <option value="5">5 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
        </select>
      </label>
      <label class="cs-check"><input type="checkbox" id="cs-data"> Include message data (tracker/extension info, useful for bug review)</label>
      <div class="cs-row"><button id="cs-save" style="flex:1">Save</button><button id="cs-push" class="cs-primary" style="flex:1">Push this chat now</button></div>
      <div id="cs-status" class="cs-status">Loading…</div>
    </div>`;
  const $ = id => root.querySelector('#' + id);
  const status = (text, kind = '') => { const el = $('cs-status'); el.textContent = text; el.className = 'cs-status ' + kind; };

  const send = payload => { try { ctx.sendToBackend(payload); } catch { status('Lost connection to Lumiverse. Refresh and try again.', 'err'); } };

  $('cs-save').addEventListener('click', () => {
    const token = $('cs-token').value;
    send({ type: 'chatsync:save', token, settings: {
      repo: $('cs-repo').value, branch: $('cs-branch').value, folder: $('cs-folder').value,
      autoMinutes: Number($('cs-auto').value), includeData: $('cs-data').checked,
    } });
    $('cs-token').value = '';
    status('Saving…');
  });
  $('cs-push').addEventListener('click', () => { status('Pushing…'); send({ type: 'chatsync:push_now' }); });

  const unsubscribe = ctx.onBackendMessage(msg => {
    if (msg?.type === 'chatsync:state') {
      const s = msg.settings;
      $('cs-repo').value = s.repo; $('cs-branch').value = s.branch; $('cs-folder').value = s.folder;
      $('cs-auto').value = String(s.autoMinutes); $('cs-data').checked = s.includeData;
      $('cs-token-state').textContent = msg.hasToken ? 'saved ✓ (stored encrypted)' : 'not set';
      if ($('cs-status').textContent === 'Loading…') status(s.repo && msg.hasToken ? 'Ready.' : 'Fill in the repo and token, then Save.');
    }
    if (msg?.type === 'chatsync:status') {
      const s = msg.status;
      status(`${s.reason === 'auto' ? 'Auto: ' : ''}${s.text}`, s.ok ? 'ok' : 'err');
    }
  });

  send({ type: 'chatsync:get_state' });
  return () => { unsubscribe?.(); removeStyle?.(); tab.destroy?.(); };
}
