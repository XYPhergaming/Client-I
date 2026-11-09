'use strict';

let _zCounter = 100;

TerminalSession.prototype._createWindowWrapper = function(opts) {
  const win = document.createElement('div');
  win.className = 'mini-window fade-in';
  win.style.zIndex = ++_zCounter;
  const count = Object.keys(UI.miniWindows).length;
  win.style.left = (50 + count * 30) + 'px';
  win.style.top = (80 + count * 30) + 'px';
  win.style.width = '340px';
  win.style.height = '260px';
  
  const header = document.createElement('div');
  header.className = 'mini-header';
  
  const title = document.createElement('span');
  title.className = 'mini-title';
  title.textContent = opts.title || opts.scopeName || 'terminal';
  
  const controls = document.createElement('div');
  controls.className = 'mini-controls';
  
  const mkBtn = (label, onClick, html) => {
    const b = document.createElement('button');
    b.className = 'mini-btn';
    if (html) b.innerHTML = html; else b.textContent = label;
    b.onmousedown = (e) => e.stopPropagation();
    b.ontouchstart = (e) => e.stopPropagation();
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
    return b;
  };
  const btnMinus = mkBtn('-', () => {
    win.style.width = Math.max(180, win.offsetWidth - 40) + 'px';
    win.style.height = Math.max(120, win.offsetHeight - 40) + 'px';
  });
  const btnPlus = mkBtn('+', () => {
    win.style.width = (win.offsetWidth + 40) + 'px';
    win.style.height = (win.offsetHeight + 40) + 'px';
  });
  const btnSet = mkBtn(null, () => UI.openMiniSettings(this), '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>');
  controls.appendChild(btnMinus); controls.appendChild(btnPlus); controls.appendChild(btnSet);
  header.appendChild(title); header.appendChild(controls);
  
  const body = document.createElement('div');
  body.className = 'mini-body';
  const term = document.createElement('div');
  term.className = 'mini-term';
  const cap = document.createElement('textarea');
  cap.className = 'mini-capture';
  cap.autocomplete = 'off'; cap.autocorrect = 'off'; cap.autocapitalize = 'off';
  cap.spellcheck = false;
  cap.setAttribute('enterkeyhint', 'go');
  body.appendChild(term); body.appendChild(cap);
  win.appendChild(header); win.appendChild(body);
  document.body.appendChild(win);
  this._bindDrag(win, header);
  const toFront = () => { win.style.zIndex = ++_zCounter; };
  win.addEventListener('mousedown', toFront);
  win.addEventListener('touchstart', toFront, { passive: true });
  return { win, term, cap, header, body };
};

TerminalSession.prototype._bindDrag = function(win, handle) {
  const startDrag = (e) => {
    if (e.target.closest('button')) return;
    if (e.target !== handle && !handle.contains(e.target)) return;
    const p = e.touches ? e.touches[0] : e;
    const sx = p.clientX, sy = p.clientY;
    const rect = win.getBoundingClientRect();
    const ox = rect.left, oy = rect.top;
    const move = (ev) => {
      const pt = ev.touches ? ev.touches[0] : ev;
      win.style.left = (ox + pt.clientX - sx) + 'px';
      win.style.top = (oy + pt.clientY - sy) + 'px';
    };
    const end = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    e.preventDefault();
  };
  handle.addEventListener('mousedown', startDrag);
  handle.addEventListener('touchstart', startDrag, { passive: false });
};

TerminalSession.prototype.closeWindow = function() {
  if (!this.wrapper) return;
  if (this._cleanupDone) return;
  this._cleanupDone = true;
  if (Terminal._sessionCleanupHooks) {
    for (const hook of Terminal._sessionCleanupHooks) {
      try { hook(this); } catch(e) {}
    }
  }
  this.wrapper.remove();
  const key = this.opts.windowKey || this.opts.scopeName;
  if (key && UI.miniWindows[key] === this) delete UI.miniWindows[key];
  if (UI.fallbackWindow === this) UI.fallbackWindow = null;
  if (UI.activeSession === this) {
    UI.activeSession = state.session;
    if (state.session && state.session.cap) state.session.cap.focus();
  }
};

TerminalSession.prototype.requestExit = function() {
  this.mode = 'pending_exit';
  this.cap.value = '';
  this.updatePrompt();
  this.lineEl.textContent = '';
};

// Removed _openFolderSettings entirely

TerminalSession.prototype.openMiniByName = async function(name) {
  const lower = name.toLowerCase();
  const ext = Terminal.extensions[lower];
  if (!ext) throw new Error('THIS NOT WORK !!!');
  if (ext.type === 'master') return this._openMasterMini(lower);
  throw new Error('THIS NOT WORK !!!');
};

TerminalSession.prototype._openMasterMini = async function(lower) {
  const ext = Terminal.extensions[lower];
  if (!ext) throw new Error('THIS NOT WORK !!!');
  if (ext.type !== 'master') throw new Error('THIS NOT WORK !!!');
  if (UI.miniWindows[lower]) { UI.focusWindow(UI.miniWindows[lower]); this.printSystem('ALREADY OPEN: ' + lower); return; }
  const session = new TerminalSession({ floating: true, scope: 'master', scopeName: lower, windowKey: lower, title: lower });
  UI.miniWindows[lower] = session;
  UI.attachInput(session);
  session.cap.focus();
  UI.activeSession = session;
};

TerminalSession.prototype._openPkgMini = async function(lower, autoRun = false, displayName = null) {
  const key = 'mini:' + lower;
  if (UI.miniWindows[key]) { UI.focusWindow(UI.miniWindows[key]); this.printSystem('ALREADY OPEN: ' + lower); return; }
  const ext = Terminal.extensions[lower];
  if (!ext) throw new Error('THIS NOT WORK !!!');
  if (ext.type !== 'pkg') throw new Error('THIS NOT WORK !!!');

  let fn = ext.run;
  if (typeof fn !== 'function') {
    const selfCmd = ext.commands && ext.commands[lower.toUpperCase()];
    const isScopedOnly = ext._scopedOnlyCommands && ext._scopedOnlyCommands.has(lower.toUpperCase());
    if (selfCmd && !isScopedOnly) fn = selfCmd;
  }
  const hasOwnMode = extHasOwnMode(ext);

  if (autoRun && typeof fn !== 'function' && hasOwnMode) {
    throw new Error('THIS NOT WORK !!!');
  }

  const session = new TerminalSession({ floating: true, scope: 'pkg', scopeName: lower, windowKey: key, title: displayName || lower });
  UI.miniWindows[key] = session;
  UI.attachInput(session);
  session.cap.focus();
  UI.activeSession = session;

  if (!autoRun) return;

  if (typeof fn === 'function') {
    let tick = 0;
    const seq = [3, 2, 1, 2];
    session.lineEl.textContent = '';
    session._hideCursor = true;
    const anim = setInterval(() => {
      if (session.mode !== 'shell' || !session.executing) return;
      const d = '.'.repeat(seq[tick % 4]);
      session.promptEl.innerHTML = `<span class="text-blue-600">${Utils.escapeHTML(lower)}${d}</span>`;
      tick++;
    }, 200);
    session.executing = true;
    try { await fn.call(session); }
    catch (e) { session.printError(String(e.message || e).toUpperCase()); }
    finally {
      session.executing = false;
      clearInterval(anim);
      session._hideCursor = false;
      session.updateLine();
      if (session.mode === 'shell') session.updatePrompt();
    }
  }

  if (ext.type === 'pkg' && session.mode === 'shell' && !hasOwnMode) {
    enterPkgRepl(session, lower, ext);
  }
};

TerminalSession.prototype._openKitMini = async function(name) {
  const lower = name.toLowerCase();
  const key = 'kit:' + lower;

  if (UI.kitWindows[key]) {
    UI.kitWindows[key].win.style.zIndex = ++_zCounter;
    return;
  }

  let reg;
  try {
    reg = await ExtensionManager.loadRegistry(window.URLS.kitRegistry, true);
  } catch (e) {
    throw new Error('THIS NOT WORK !!!');
  }
  const list = (reg && (reg.kits || reg.extensions)) || [];
  const entry = list.find(x => x.name.toLowerCase() === lower);
  if (!entry) throw new Error('THIS NOT WORK !!!');

  const relPath = (window.URLS.kit || {})[lower];
  if (!relPath) throw new Error('THIS NOT WORK !!!');

  const abs = ExtensionManager.resolveUrl(relPath);
  const fetchUrl = abs + (abs.includes('?') ? '&' : '?') + 'v=' + Terminal.version;

  let html;
  try {
    html = await ExtensionManager.fetchRaw(fetchUrl);
  } catch (e) {
    throw new Error('THIS NOT WORK !!!');
  }

  if (entry.sha256) {
    const h = await Terminal.sha256(html);
    if (h !== entry.sha256) throw new Error('THIS NOT WORK !!!');
  }

  UI.kitWindows[key] = this._createKitWindow(lower, html);
};

TerminalSession.prototype._createKitWindow = function(name, html) {
  const key = 'kit:' + name;

  const win = document.createElement('div');
  win.className = 'mini-window fade-in';
  Object.assign(win.style, {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--line-2)',
    boxShadow: '0 10px 40px rgba(0,0,0,.35)',
    overflow: 'hidden',
    minWidth: '260px',
    minHeight: '280px',
    left: (80 + Object.keys(UI.kitWindows).length * 30) + 'px',
    top: (80 + Object.keys(UI.kitWindows).length * 30) + 'px',
    width: '320px',
    height: '420px',
    zIndex: ++_zCounter
  });

  const header = document.createElement('div');
  header.className = 'mini-header';

  const title = document.createElement('span');
  title.className = 'mini-title';
  title.textContent = 'kit:' + name;

  const controls = document.createElement('div');
  controls.className = 'mini-controls';

  const record = { win, iframe: null };

  const mkBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.className = 'mini-btn';
    b.textContent = label;
    b.onmousedown = (e) => e.stopPropagation();
    b.ontouchstart = (e) => e.stopPropagation();
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
    return b;
  };

  const btnMinus = mkBtn('-', () => {
    win.style.width = Math.max(260, win.offsetWidth - 40) + 'px';
    win.style.height = Math.max(280, win.offsetHeight - 40) + 'px';
  });
  const btnPlus = mkBtn('+', () => {
    win.style.width = (win.offsetWidth + 40) + 'px';
    win.style.height = (win.offsetHeight + 40) + 'px';
  });
  const btnClose = mkBtn('Close', () => {
    win.remove();
    if (UI.kitWindows[key] === record) delete UI.kitWindows[key];
  });

  controls.appendChild(btnMinus);
  controls.appendChild(btnPlus);
  controls.appendChild(btnClose);
  header.appendChild(title);
  header.appendChild(controls);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1; overflow:hidden; background:#fff; display:flex;';

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%; height:100%; border:0; display:block; background:#fff;';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.srcdoc = html;

  body.appendChild(iframe);
  win.appendChild(header);
  win.appendChild(body);
  document.body.appendChild(win);

  record.iframe = iframe;

  this._bindDrag(win, header);

  const toFront = () => { win.style.zIndex = ++_zCounter; };
  win.addEventListener('mousedown', toFront);
  win.addEventListener('touchstart', toFront, { passive: true });

  return record;
};

TerminalSession.prototype.openFallbackWindow = async function() {
  if (UI.fallbackWindow) { UI.focusWindow(UI.fallbackWindow); this.printSystem('ALREADY OPEN: DMS'); return; }
  const session = new TerminalSession({ floating: true, scope: 'root', title: state.settings.username });
  UI.fallbackWindow = session;
  UI.attachInput(session);
  session.cap.focus();
  UI.activeSession = session;
};

TerminalSession.prototype._openExplorerWindow = function(type, path) {
  const key = 'explorer:' + type + (path || '');
  if (UI.miniWindows[key]) {
    UI.miniWindows[key].win.style.zIndex = ++_zCounter;
    return;
  }

  const win = document.createElement('div');
  win.className = 'mini-window fade-in';
  Object.assign(win.style, {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--line-2)',
    boxShadow: '0 10px 40px rgba(0,0,0,.8), var(--glow-green)',
    overflow: 'hidden',
    minWidth: '200px',
    minHeight: '200px',
    left: (100 + Object.keys(UI.miniWindows).length * 30) + 'px',
    top: (100 + Object.keys(UI.miniWindows).length * 30) + 'px',
    width: '260px',
    height: '300px',
    zIndex: ++_zCounter
  });

  const header = document.createElement('div');
  header.className = 'mini-header';
  
  const title = document.createElement('span');
  title.className = 'mini-title';
  title.textContent = type === 'FILES' ? 'PATH: ' + path : type;
  
  const controls = document.createElement('div');
  controls.className = 'mini-controls';

  const btnClose = document.createElement('button');
  btnClose.className = 'mini-btn';
  btnClose.textContent = 'Close';
  btnClose.onmousedown = (e) => e.stopPropagation();
  btnClose.onclick = (e) => {
    e.stopPropagation();
    win.remove();
    delete UI.miniWindows[key];
  };

  controls.appendChild(btnClose);
  header.appendChild(title); 
  header.appendChild(controls);
  
  const body = document.createElement('div');
  body.className = 'mini-body';
  body.style.padding = '10px';
  
  const term = document.createElement('div');
  term.className = 'mini-term';
  body.appendChild(term);

  win.appendChild(header); 
  win.appendChild(body);
  document.body.appendChild(win);

  const fakeSession = { win, wrapper: win, container: term };
  UI.miniWindows[key] = fakeSession;
  
  UI.applyMiniTheme(fakeSession);

  this._bindDrag(win, header);
  const toFront = () => { win.style.zIndex = ++_zCounter; };
  win.addEventListener('mousedown', toFront);
  win.addEventListener('touchstart', toFront, { passive: true });

  if (type === 'FILES') {
    this._renderVfsTree(path, term);
  } else if (type === 'PKG') {
    const pkgs = Object.entries(Terminal.extensions).filter(([_, e]) => e.type === 'pkg').map(([n]) => n).sort();
    if (!pkgs.length) term.innerHTML = '<span style="color:var(--fg-2)">(none)</span>';
    else pkgs.forEach(n => term.innerHTML += `<div class="vfs-item"><div class="vfs-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg></div>${n}</div>`);
  } else if (type === 'MASTER_KEY') {
    const masters = Object.entries(Terminal.extensions).filter(([_, e]) => e.type === 'master').map(([n]) => n).sort();
    if (!masters.length) term.innerHTML = '<span style="color:var(--fg-2)">(none)</span>';
    else masters.forEach(n => term.innerHTML += `<div class="vfs-item"><div class="vfs-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg></div>${n}</div>`);
  } else if (type === 'KIT') {
    const openKits = Object.keys(UI.kitWindows).map(k => k.replace(/^kit:/, '')).sort();
    if (!openKits.length) term.innerHTML = '<span style="color:var(--fg-2)">(none)</span>';
    else openKits.forEach(n => term.innerHTML += `<div class="vfs-item"><div class="vfs-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg></div>${n}</div>`);
  }
};