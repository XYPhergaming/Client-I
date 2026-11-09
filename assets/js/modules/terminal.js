'use strict';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('webterm_settings') || '{}');
    const br = parseFloat(s.brightness);
    return {
      username: (typeof s.username === 'string' && s.username.trim()) ? s.username : 'user',
      fontColor: ['text-black','text-white','text-green-600','text-green-400','text-cyan-400','text-yellow-400'].includes(s.fontColor) ? s.fontColor : 'text-black',
      bgColor: ['bg-white','bg-black'].includes(s.bgColor) ? s.bgColor : 'bg-white',
      fontFamily: Object.keys(FONT_FAMILIES).includes(s.fontFamily) ? s.fontFamily : 'mono',
      brightness: (!isNaN(br) && br >= 0.5 && br <= 2.5) ? br : 1.0
    };
  } catch (e) {
    return { username: 'user', fontColor: 'text-black', bgColor: 'bg-white', fontFamily: 'mono', brightness: 1.0 };
  }
}

const state = { session: null, settings: loadSettings() };

let keyAliases = {};
let cmdAliases = {};
let extAliases = {};
let _zCounter = 100;

function nameTaken(name) {
  const lower = name.toLowerCase();
  const reserved = ['import','install','export','mini','del','edit','go','cre','create','?','*','**','..go','@sys','@key','@pkg','@master_key','@kit','kit','clear','asa','run','runx','exit'];
  if (reserved.includes(lower)) return true;
  for (const k of Object.keys(keyAliases)) if (k.toLowerCase() === lower) return true;
  for (const k of Object.keys(cmdAliases)) if (k.toLowerCase() === lower) return true;
  for (const k of Object.keys(extAliases)) if (k.toLowerCase() === lower) return true;
  for (const k of Object.keys(Terminal.extensions)) if (k.toLowerCase() === lower) return true;
  return false;
}

function isPackageEntryCommand(cmdName) {
  const base = String(cmdName).replace(/\{[\s\S]*\}$/, '').trim().toUpperCase();
  const ext = Terminal.extensions[base.toLowerCase()];
  return !!(ext && ext.type === 'pkg');
}

function splitTopLevelAmp(input) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of String(input)) {
    if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === '&' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function isValidCommandSource(src) {
  src = src.trim();
  if (!src) return false;
  if (src.includes('&')) return splitTopLevelAmp(src).every(p => isValidCommandSource(p.trim()));
  const parts = src.split(/\s+/);
  const firstWord = parts[0];
  let cmdName;
  const braceWordMatch = firstWord.match(/^([A-Za-z0-9_]+)(\{[\s\S]*\})$/);
  if (braceWordMatch) cmdName = braceWordMatch[1].toUpperCase() + braceWordMatch[2];
  else cmdName = firstWord.toUpperCase();
  const simpleKeys = ['GO','..GO','CRE','CREATE','EDIT','CLEAR','ASA','KIT','?','*','**','@SYS','@KEY','@PKG','@MASTER_KEY','@KIT'];
  if (simpleKeys.includes(cmdName)) return true;
  if (typeof CORE_HANDLERS !== 'undefined' && CORE_HANDLERS[cmdName]) return true;
  if (typeof Terminal !== 'undefined' && Terminal.commands && Terminal.commands[cmdName]) return true;
  if (/^Import\(\s*\)$/i.test(src)) return true;
  if (/^Import\{\s*.+\}$/i.test(src)) return true;
  if (/^Install\{\s*.+\}$/i.test(src)) return true;
  if (/^Export\(\s*\)$/i.test(src)) return true;
  if (/^Export\(\s*.+\s*\)$/i.test(src)) return true;
  if (/^del\(\s*.+\s*\)$/i.test(src)) return true;
  if (/^del\{\s*.+\}$/i.test(src)) return true;
  if (/^RUN\{\s*.+\}$/i.test(src)) return true;
  if (/^RUN\(\s*.+\s*\)$/i.test(src)) return true;
  if (/^run\s+[a-zA-Z0-9_]+$/i.test(src)) return true;
  if (/^Kit\{\s*.+\}$/i.test(src)) return true;
  const m = src.match(/^([^.]+)\./);
  if (m && Terminal.extensions[m[1].toLowerCase()]) return true;
  if (/^[A-Za-z0-9_]+\(\s*[\s\S]*?\s*\)$/.test(src)) return true;
  return false;
}

function resolveExtensionCommand(ext, input) {
  input = String(input || '').trim();
  if (!input) return null;
  const direct = input.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\{([^{}]*)\})?(?:\s+([\s\S]*))?$/);
  if (direct) {
    const cmdName = direct[1].toUpperCase();
    let cmdArg = direct[2] !== undefined ? direct[2] : (direct[3] || '');
    cmdArg = cmdArg.trim();
    const wrapped = cmdArg.match(/^\{([\s\S]*)\}$/);
    if (wrapped) cmdArg = wrapped[1];
    if (ext.commands && typeof ext.commands[cmdName] === 'function') {
      return { handler: ext.commands[cmdName], arg: cmdArg };
    }
  }
  if (Array.isArray(ext.routes)) {
    for (const route of ext.routes) {
      const m = input.match(route.pattern);
      if (m) {
        const key = String(route.handler || '').toUpperCase();
        const handler = ext.commands && ext.commands[key];
        if (typeof handler === 'function') {
          const captures = m.slice(1);
          const arg = captures.length === 0 ? '' : (captures.length === 1 ? captures[0] : captures);
          return { handler, arg };
        }
      }
    }
  }
  return null;
}

function extHasOwnMode(ext) {
  if (!ext) return false;
  if (!ext.modes || typeof ext.modes !== 'object') return false;
  return Object.keys(ext.modes).length > 0;
}

function getPkgPrompt(session, ext) {
  if (ext && ext.prompt) {
    if (typeof ext.prompt === 'function') {
      try { return String(ext.prompt.call(session, session)); } catch (e) {}
    }
    return String(ext.prompt);
  }
  return '~> ';
}

function enterPkgRepl(session, pkgName, ext) {
  session.mode = 'pkg_repl';
  session._pkgReplName = pkgName;
  session._pkgReplExt = ext;
  session.promptPrefix = getPkgPrompt(session, ext);
  session.updatePrompt();
}

const Terminal = {
  version: '2.4.9',
  commands: {}, extensions: {}, runners: {}, modeHandlers: {}, session: null,
  _sessionCleanupHooks: [],
  Storage, Utils, SecurityScanner,
  registerMode(name, handler) { this.modeHandlers[name] = handler; },
  unregisterMode(name) { delete this.modeHandlers[name]; },
  registerExtension(spec) {
    if (!spec || !spec.name) throw new Error('Extension must have a name');
    const name = spec.name.toLowerCase();
    if (this.extensions[name]) throw new Error('Extension already registered: ' + spec.name);
    spec.name = name;
    spec.commands = spec.commands || {};
    spec._scopedOnlyCommands = new Set();
    const scopedOnlyNames = new Set();
    if (spec.scopedOnly && typeof spec.scopedOnly === 'object') {
      for (const [k, fn] of Object.entries(spec.scopedOnly)) {
        if (typeof fn !== 'function') continue;
        spec.commands[k] = fn;
        scopedOnlyNames.add(k.toUpperCase());
        spec._scopedOnlyCommands.add(k.toUpperCase());
      }
    }
    this.extensions[name] = spec;
    for (const [cmd, fn] of Object.entries(spec.commands)) {
      if (typeof fn !== 'function') continue;
      if (scopedOnlyNames.has(cmd.toUpperCase())) continue;
      this.commands[cmd.toUpperCase()] = fn;
    }
    for (const [ext, fn] of Object.entries(spec.runners || {})) {
      if (typeof fn !== 'function') continue;
      this.runners[ext.toLowerCase()] = fn;
    }
    for (const [modeName, modeHandler] of Object.entries(spec.modes || {})) {
      this.registerMode(modeName, modeHandler);
    }
  },
  unregisterExtension(name) {
    const lower = name.toLowerCase();
    const spec = this.extensions[lower];
    if (!spec) return;
    for (const c of Object.keys(spec.commands || {})) delete this.commands[c.toUpperCase()];
    for (const e of Object.keys(spec.runners || {})) delete this.runners[e.toLowerCase()];
    for (const m of Object.keys(spec.modes || {})) this.unregisterMode(m);
    delete this.extensions[lower];
  },
  async sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  print(t) { if (this.session) this.session.print(t); },
  printSystem(t) { if (this.session) this.session.printSystem(t); },
  printError(t) { if (this.session) this.session.printError(t); },
  printSuccess(t) { if (this.session) this.session.printSuccess(t); },
  get cwd() { return this.session ? this.session.cwd : '/home/user'; },
  getUsername() { return state.settings.username; }
};
window.Terminal = Terminal;

Terminal.registerMode('pkg_repl', {
  async onInput(session, input) {
    const pkg = session._pkgReplName;
    const trimmed = String(input || '').trim();

    session.print(session.promptEl.innerHTML + ' ' + Utils.escapeHTML(input), true);
    if (!trimmed) return;
    session.history.push(input);
    session.historyIndex = session.history.length;

    if (trimmed.toLowerCase() === 'exit') {
      if (session.wrapper) {
        session.closeWindow();
      } else {
        session.mode = 'shell';
        session.promptPrefix = '';
        session._pkgReplName = null;
        session._pkgReplExt = null;
        session.updatePrompt();
      }
      return;
    }

    const ext = pkg ? Terminal.extensions[pkg] : null;
    if (!ext) {
      session.printError('SCOPE LOST: ' + (pkg || 'unknown'));
      if (session.wrapper) {
        session.closeWindow();
      } else {
        session.mode = 'shell';
        session.promptPrefix = '';
        session._pkgReplName = null;
        session._pkgReplExt = null;
        session.updatePrompt();
      }
      return;
    }

    const resolved = resolveExtensionCommand(ext, trimmed);
    if (!resolved) {
      session.printError('INVALID KEY: ' + trimmed);
      return;
    }

    try {
      await resolved.handler.call(session, resolved.arg);
    } catch (e) {
      session.printError(String(e.message || e).toUpperCase());
    }

    if (session.mode === 'pkg_repl' && session._pkgReplExt === ext) {
      session.promptPrefix = getPkgPrompt(session, ext);
      session.updatePrompt();
    }
  }
});

const ExtensionManager = {
  get baseUrl() { return window.URLS.base; },
  resolveUrl(p) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;
    try { return new URL(p, this.baseUrl).href; } catch (e) { return p; }
  },
  async fetchWithFallback(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error('Server returned HTML (likely 404)');
    }
    return text;
  },
  async fetchRaw(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  },
  async loadRegistry(url, refresh = false) {
    const absUrl = this.resolveUrl(url);
    const cacheKey = 'reg_' + absUrl.split('/').pop().split('?')[0];
    if (!refresh) {
      const cached = await Storage.get(cacheKey, 'system');
      if (cached) return cached;
    }
    const fetchUrl = absUrl + (absUrl.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    try {
      const text = await this.fetchWithFallback(fetchUrl);
      const data = JSON.parse(text);
      await Storage.set(cacheKey, data, 'system');
      return data;
    } catch (e) {
      const cached = await Storage.get(cacheKey, 'system');
      if (cached) return cached;
      throw new Error('Registry unavailable: ' + e.message);
    }
  },
  async installPkg(name, onProgress) {
    const reg = await this.loadRegistry(window.URLS.pkgRegistry, true);
    const entry = reg.extensions.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!entry) throw new Error('NOT EXIST: ' + name);
    if (Terminal.extensions[entry.name.toLowerCase()]) throw new Error('ALREADY EXIST: ' + entry.name);
    const relPath = (window.URLS.pkg || {})[entry.name.toLowerCase()];
    if (!relPath) throw new Error('NOT EXIST: ' + entry.name);
    if (onProgress) onProgress('Downloading ' + entry.name + '...');
    const abs = this.resolveUrl(relPath);
    const fetchUrl = abs + (abs.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    const code = await this.fetchWithFallback(fetchUrl);
    if (entry.sha256) {
      const h = await Terminal.sha256(code);
      if (h !== entry.sha256) throw new Error('Integrity check failed: ' + entry.name);
    }
    if (Terminal.extensions[entry.name.toLowerCase()]) Terminal.unregisterExtension(entry.name);
    new Function('Terminal', code)(Terminal);
    if (!Terminal.extensions[entry.name.toLowerCase()]) throw new Error('Extension failed to register: ' + entry.name);
    Terminal.extensions[entry.name.toLowerCase()].type = 'pkg';
    await Storage.set('ext:' + entry.name.toLowerCase(), code, 'system');
    await Storage.set('ext_type:' + entry.name.toLowerCase(), 'pkg', 'system');
    return { name: entry.name, info: 'INSTALL SUCCESSFUL: ' + entry.name.toUpperCase() };
  },
  async installMaster(name, onProgress) {
    const lower = name.toLowerCase();
    if (Terminal.extensions[lower]) throw new Error('ALREADY EXIST: ' + name);
    const reg = await this.loadRegistry(window.URLS.masterRegistry, true);
    const entry = reg.extensions.find(x => x.name.toLowerCase() === lower);
    if (!entry) throw new Error('NOT EXIST: ' + name);
    const relPath = (window.URLS.master || {})[entry.name.toLowerCase()];
    if (!relPath) throw new Error('NOT EXIST: ' + entry.name);
    if (onProgress) onProgress('Importing ' + entry.name + '...');
    const abs = this.resolveUrl(relPath);
    const fetchUrl = abs + (abs.includes('?') ? '&' : '?') + 'v=' + Terminal.version;
    const code = await this.fetchWithFallback(fetchUrl);
    if (entry.sha256) {
      const h = await Terminal.sha256(code);
      if (h !== entry.sha256) throw new Error('Integrity check failed: ' + entry.name);
    }
    new Function('Terminal', code)(Terminal);
    if (!Terminal.extensions[lower]) throw new Error('Master key failed to register: ' + entry.name);
    Terminal.extensions[lower].type = 'master';
    return { name: entry.name, info: 'IMPORT SUCCESSFUL: ' + entry.name.toUpperCase() };
  },
  async remove(name) {
    const lower = name.toLowerCase();
    if (Terminal.extensions[lower]) {
      Terminal.unregisterExtension(lower);
      await Storage.remove('ext:' + lower, 'system');
      await Storage.remove('ext_type:' + lower, 'system');
      for (const [alias, ext] of Object.entries(extAliases)) if (ext === lower) delete extAliases[alias];
    }
  },
  async loadAll() {
    const keys = await Storage.keys('system');
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith('ext:')) continue;
      const name = key.slice(4);
      const type = await Storage.get('ext_type:' + name, 'system');
      if (type !== 'pkg') {
        await Storage.remove(key, 'system');
        await Storage.remove('ext_type:' + name, 'system');
        continue;
      }
      const code = await Storage.get(key, 'system');
      if (!code) continue;
      try {
        new Function('Terminal', code)(Terminal);
        if (Terminal.extensions[name.toLowerCase()]) Terminal.extensions[name.toLowerCase()].type = type;
      } catch (e) { console.warn('Failed to load ' + name + ': ' + e.message); }
    }
  }
};
window.ExtensionManager = ExtensionManager;

class TerminalSession {
  constructor(opts = {}) {
    this.opts = opts;
    this.cwd = '/home/' + state.settings.username;
    this.history = [];
    this.historyIndex = -1;
    this.mode = 'shell';
    this.replBuffer = [];
    this.executing = false;
    this.promptPrefix = '';
    this.wrapper = null;
    this.customTheme = null;
    this.state = {};
    this._composing = false;
    this._hideCursor = false;
    this._pkgReplName = null;
    this._pkgReplExt = null;

    this.out = document.createElement('div');
    this.out.className = 'flex flex-col whitespace-pre-wrap break-all fade-in';
    this.inputContainer = document.createElement('div');
    this.inputContainer.className = 'flex items-start mt-1';
    this.promptEl = document.createElement('span');
    this.promptEl.className = 'mr-2 font-bold whitespace-pre';
    this.lineEl = document.createElement('span');
    this.lineEl.className = 'whitespace-pre-wrap break-all';
    this.lineEl.style.minWidth = '0';
    this.lineEl.style.flex = '0 1 auto';
    this.lineEl.style.maxWidth = '100%';
    this.inputContainer.append(this.promptEl, this.lineEl);

    if (opts.floating) {
      const w = this._createWindowWrapper(opts);
      this.wrapper = w.win;
      this.container = w.term;
      this.cap = w.cap;
      this.container.appendChild(this.out);
      this.container.appendChild(this.inputContainer);
      w.body.addEventListener('click', (e) => {
        const sel = window.getSelection();
        if (sel && sel.toString().length) return;
        this.cap.focus();
      });
      UI.applyMiniTheme(this);
    } else {
      this.cap = document.getElementById('capture');
      this.container = document.createElement('div');
      this.container.className = 'term absolute inset-0 overflow-y-auto p-4 flex flex-col ' + state.settings.fontColor + ' ' + state.settings.bgColor;
      this.container.appendChild(this.out);
      this.container.appendChild(this.inputContainer);
      document.getElementById('workspace').appendChild(this.container);
      if (state.settings.brightness && state.settings.brightness !== 1.0) {
        this.container.style.filter = 'brightness(' + state.settings.brightness + ')';
      }
    }
    this.updatePrompt();
    this.updateLine();
  }

  _createWindowWrapper(opts) {
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
  }

  _bindDrag(win, handle) {
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
  }

  closeWindow() {
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
  }

  requestExit() {
    this.mode = 'pending_exit';
    this.cap.value = '';
    this.updatePrompt();
    this.lineEl.textContent = '';
  }

  updatePrompt() {
    if (this.mode === 'pending_exit') {
      this.promptEl.innerHTML = '<span class="text-blue-600">Press Enter to Exit</span>';
      return;
    }
    if (this.mode !== 'shell') {
      this.promptEl.innerHTML = '<span>' + Utils.escapeHTML(this.promptPrefix || '') + '</span>';
      return;
    }
    let displayPath = state.settings.username;
    const home = '/home/' + state.settings.username;
    if (this.cwd === '/') displayPath = '/';
    else if (this.cwd !== home) {
      if (this.cwd.startsWith(home + '/')) displayPath += '/' + this.cwd.slice(home.length + 1);
      else displayPath = this.cwd;
    }
    this.promptEl.innerHTML = `<span class="font-bold">${Utils.escapeHTML(displayPath)}:</span>`;
  }

  updateLine() {
    if (this._composing) return;
    if (this._hideCursor) { this.lineEl.innerHTML = ''; return; }
    const val = this.cap.value;
    const pos = this.cap.selectionStart;
    if (pos === null || pos === undefined) {
      this.lineEl.innerHTML = Utils.escapeHTML(val) + '<span class="cursor-block"></span>';
      return;
    }
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    let html = Utils.escapeHTML(before);
    html += '<span class="cursor-block"></span>';
    if (after.length > 0) html += Utils.escapeHTML(after);
    this.lineEl.innerHTML = html;
  }

  print(html, isHtml = false) {
    const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 60;
    const d = document.createElement('div');
    d.className = 'mb-1 fade-in';
    if (isHtml) d.innerHTML = html; else d.textContent = html;
    this.out.appendChild(d);
    if (isAtBottom) this.container.scrollTop = this.container.scrollHeight;
  }

  printChat(text, align = 'left') {
    const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 60;
    const d = document.createElement('div');
    d.className = 'mb-1 fade-in';
    d.style.display = 'flex'; d.style.width = '100%';
    d.style.justifyContent = align === 'right' ? 'flex-end' : 'flex-start';
    const inner = document.createElement('div');
    inner.style.color = 'var(--purple)';
    inner.style.maxWidth = '85%';
    inner.style.wordBreak = 'break-word';
    inner.style.whiteSpace = 'pre-wrap';
    inner.textContent = String(text);
    d.appendChild(inner);
    this.out.appendChild(d);
    if (isAtBottom) this.container.scrollTop = this.container.scrollHeight;
  }

  printSystem(t) { this.print('<span class="text-blue-600">' + Utils.escapeHTML(t) + '</span>', true); }
  printError(t) { this.print('<span class="text-red-600">' + Utils.escapeHTML(String(t)) + '</span>', true); }
  printSuccess(t) { this.print('<span class="text-yellow-600">' + Utils.escapeHTML(t) + '</span>', true); }
  clear() { this.out.innerHTML = ''; }

  async processInput(input) {
    if (this.mode === 'pending_exit') { this.closeWindow(); return; }
    if (this.mode !== 'shell') {
      const handler = Terminal.modeHandlers[this.mode];
      if (handler && handler.onInput) return handler.onInput(this, input);
      this.mode = 'shell';
      this.promptPrefix = '';
      this._pkgReplName = null;
      this._pkgReplExt = null;
      this.updatePrompt();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;
    this.print(this.promptEl.innerHTML + ' ' + Utils.escapeHTML(input), true);
    this.history.push(input);
    this.historyIndex = this.history.length;
    if (this.opts && (this.opts.scope === 'master' || this.opts.scope === 'pkg' || this.opts.scope === 'root')) {
      await this.executeScoped(trimmed);
      return;
    }
    if (this.tryDefineAlias(trimmed)) return;
    await this.executeKey(trimmed);
  }

  tryDefineAlias(input) {
    const m = input.match(/^(.+?)\s+asa\s+(.+)$/i);
    if (m) {
      const source = m[1].trim();
      const alias = m[2].trim();
      if (!alias.endsWith('...')) { this.printError('INVALID KEY: ' + alias); return true; }
      if (!isValidCommandSource(source)) { this.printError('INVALID KEY: ' + source); return true; }
      const isCmd = /[(){}]/.test(source) || /\s/.test(source) || source.includes('&');
      if (isCmd) this.defineCmdAlias(source, alias);
      else this.defineKeyAlias(source, alias);
      return true;
    }
    return false;
  }
  defineKeyAlias(source, alias) {
    if (nameTaken(alias)) { this.printError('THIS KEY IS ALREADY EXIST: ' + alias); return; }
    keyAliases[alias] = source;
    this.printSuccess('ASA KEY CREATE: ' + alias);
  }
  defineCmdAlias(source, alias) {
    if (nameTaken(alias)) { this.printError('THIS KEY IS ALREADY EXIST: ' + alias); return; }
    cmdAliases[alias] = source;
    this.printSuccess('ASA KEY CREATE: ' + alias);
  }
  resolveAlias(input) {
    const lower = input.toLowerCase();
    for (const [alias, cmd] of Object.entries(cmdAliases)) {
      const la = alias.toLowerCase();
      if (lower === la) return cmd;
      if (lower.startsWith(la + ' ')) return cmd + input.slice(alias.length);
    }
    const extList = Object.entries(extAliases).sort((a, b) => b[0].length - a[0].length);
    for (const [alias, ext] of extList) {
      const la = alias.toLowerCase();
      if (lower.startsWith(la + '.')) return ext + input.slice(alias.length);
    }
    const m = input.match(/^(\S+)([\s\S]*)$/);
    if (m) {
      const first = m[1].toLowerCase();
      for (const [alias, src] of Object.entries(keyAliases)) {
        if (alias.toLowerCase() === first) return src + m[2];
      }
    }
    return input;
  }

  async executeScoped(input) {
    input = String(input || '').trim();
    if (!input) return true;

    const keyMatch = input.match(/^@key\.([\s\S]+)$/i);
    if (keyMatch) return await this.executeKey(keyMatch[1].trim());
    if (/^@key$/i.test(input)) { CORE_HANDLERS['@KEY'].call(this); return true; }

    const ampParts = splitTopLevelAmp(input);
    if (ampParts.length > 1) {
      for (const p of ampParts) {
        if (!p.trim()) continue;
        const ok = await this.executeScoped(p.trim());
        if (!ok) return false;
      }
      return true;
    }

    if (/^exit$/i.test(input)) { this.closeWindow(); return true; }

    if (this.opts.scope === 'root') {
      return await this.executeKey(input);
    }

    const scopeName = this.opts.scopeName;
    const ext = scopeName ? Terminal.extensions[scopeName] : null;
    if (!ext) { this.printError('SCOPE LOST: ' + (scopeName || 'unknown') + ' (reinstall)'); return false; }
    const resolved = resolveExtensionCommand(ext, input);
    if (!resolved) { this.printError('INVALID KEY: ' + input); return false; }
    try { await resolved.handler.call(this, resolved.arg); return true; }
    catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
  }

  async executeKey(input) {
    input = String(input || '').trim();
    if (!input) return true;
    const keyMatch = input.match(/^@key\.([\s\S]+)$/i);
    if (keyMatch) return await this.executeKey(keyMatch[1].trim());
    input = this.resolveAlias(input);
    const ampParts = splitTopLevelAmp(input);
    if (ampParts.length > 1) {
      for (const p of ampParts) {
        if (!p.trim()) continue;
        const ok = await this.executeKey(p.trim());
        if (!ok) return false;
      }
      return true;
    }
    const upper = input.toUpperCase();
    if (/^\//.test(input) || /^(ex|im)\//i.test(input)) {
      this.printError('INVALID KEY: ' + input + ' (use <ext>.' + input.replace(/\s+/g, '') + ')');
      return false;
    }
    if (isPackageEntryCommand(upper)) {
      this.printError('USE RUN{' + input + '}');
      return false;
    }

    const extDispatch = input.match(/^([^.]+)\.([\s\S]+)$/);
    if (extDispatch) {
      const extName = extDispatch[1].toLowerCase();
      const rest = extDispatch[2];
      const ext = Terminal.extensions[extName];
      if (ext) {
        const resolved = resolveExtensionCommand(ext, rest);
        if (resolved) {
          try { await resolved.handler.call(this, resolved.arg); return true; }
          catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
        }
      }
    }

    let m;

    if (/^Import\(\s*\)$/i.test(input)) {
      try { await this.cmdImportDevice(); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }
    m = input.match(/^Import\{\s*([\s\S]+?)\s*\}$/i);
    if (m) { const ok = await this.cmdImportMasters(m[1].trim()); return ok; }

    m = input.match(/^Install\{\s*([\s\S]+?)\s*\}$/i);
    if (m) {
      const ok = await this.cmdInstallPkg(m[1].trim());
      return ok !== false;
    }

    if (/^Export\(\s*\)$/i.test(input)) {
      try { await this.cmdExportDir(this.cwd); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }
    m = input.match(/^Export\(\s*([\s\S]+?)\s*\)$/i);
    if (m) {
      const a = m[1].trim();
      try {
        if (a === '*') await this.cmdExportAll();
        else await this.cmdExportFile(a);
        return true;
      } catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    if (/^MINI\{\{[\s\S]*\}\}$/i.test(input)) {
      this.printError('THIS NOT WORK !!!');
      return false;
    }

    m = input.match(/^Mini\{\s*([\s\S]*?)\s*\}$/i);
    if (m) {
      const name = m[1].trim();
      try {
        if (!name) await this.openFallbackWindow();
        else await this.openMiniByName(name);
        return true;
      } catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    m = input.match(/^Kit\{\s*([\s\S]*?)\s*\}$/i);
    if (m) {
      const name = m[1].trim();
      if (!name) {
        await CORE_HANDLERS.KIT.call(this);
        return true;
      }
      try { await this._openKitMini(name); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    m = input.match(/^del\(\s*([\s\S]+?)\s*\)$/i);
    if (m) {
      const a = m[1].trim();
      try {
        if (a === '*') await this.cmdDelAllFiles();
        else await this.cmdDelFile(a);
        return true;
      } catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }
    m = input.match(/^del\{\s*([\s\S]+?)\s*\}$/i);
    if (m) {
      const a = m[1].trim();
      try {
        if (a === '*') await this.cmdDelAllExts();
        else await this.cmdDelExt(a);
        return true;
      } catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    m = input.match(/^RUN\{\s*([\s\S]+?)\s*\}$/i);
    if (m) {
      const raw = m[1].trim();
      const lower = raw.toLowerCase();
      try { await this._openPkgMini(lower, true, raw); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    m = input.match(/^RUN\(\s*([\s\S]+?)\s*\)$/i);
    if (m) {
      try { await this.cmdRunFile(m[1].trim()); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }

    m = input.match(/^([A-Za-z0-9_]+)\(\s*([\s\S]*?)\s*\)$/);
    if (m) {
      const gName = m[1].toUpperCase();
      const gArg = m[2];
      if (CORE_HANDLERS[gName]) {
        try { await CORE_HANDLERS[gName].call(this, gArg); return true; }
        catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
      }
      if (Terminal.commands[gName]) {
        try { await Terminal.commands[gName].call(this, gArg); return true; }
        catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
      }
    }

    const parts = input.split(/\s+/);
    const firstWord = parts[0];
    let cmdName;
    const braceWordMatch = firstWord.match(/^([A-Za-z0-9_]+)(\{[\s\S]*\})$/);
    if (braceWordMatch) cmdName = braceWordMatch[1].toUpperCase() + braceWordMatch[2];
    else cmdName = firstWord.toUpperCase();
    const arg = parts.slice(1).join(' ');

    if (CORE_HANDLERS[cmdName]) {
      try { await CORE_HANDLERS[cmdName].call(this, arg); return true; }
      catch (e) { this.printError(String(e.message || e).toUpperCase()); return false; }
    }
    this.printError('INVALID KEY: ' + input);
    return false;
  }

  async cmdImportDevice() {
    if (!window.showOpenFilePicker) throw new Error('File System Access API not supported');
    try {
      const files = await window.showOpenFilePicker({ multiple: true });
      for (const h of files) {
        try {
          const f = await h.getFile();
          const name = h.name;
          if (/\.\.[\/\\]/.test(name) || /^[\/\\]/.test(name)) { this.printError('SKIPPED ' + name + ': PATH TRAVERSAL'); continue; }
          if (EXECUTABLE_EXT.test(name.toLowerCase())) { this.printError('SKIPPED ' + name + ': EXECUTABLE BLOCKED'); continue; }
          if (NATIVE_SCRIPT_EXT.test(name.toLowerCase())) { this.printError('SKIPPED ' + name + ': NATIVE SCRIPT BLOCKED'); continue; }
          const binary = await Utils.isBinaryFile(f);
          if (binary) {
            await Storage.set(Utils.resolvePath(this.cwd, name), { type: 'file', content: f, isBinary: true }, 'vfs');
            this.printSuccess('Imported: ' + name + ' (binary)');
          } else {
            const content = await f.text();
            const scan = Terminal.SecurityScanner.scan(name, content);
            if (!scan.safe) { this.printError('SKIPPED ' + name + ': ' + scan.reason); continue; }
            await Storage.set(Utils.resolvePath(this.cwd, name), { type: 'file', content }, 'vfs');
            this.printSuccess('Imported: ' + name);
          }
        } catch (e) { this.printError('FAILED ' + h.name + ': ' + (e.message || e)); }
      }
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('File selection aborted');
      throw e;
    }
  }

  async cmdImportMasters(arg) {
    const rawNames = String(arg).split('&').map(s => s.trim()).filter(Boolean);
    if (!rawNames.length) { this.printError('Usage: Import{name} or Import{name & name & ...}'); return false; }

    for (const rawName of rawNames) {
      const name = Utils.cleanName(rawName);
      if (!name || /[/\\{}]/.test(name) || name.length > 100) {
        this.printError('INVALID NAME: ' + name);
        return false;
      }
      if (Terminal.extensions[name.toLowerCase()]) {
        this.printError('ALREADY EXIST: ' + name);
        return false;
      }
      const id = Utils.generateId();
      this.print('<span id="' + id + '" class="text-blue-600">Importing ' + Utils.escapeHTML(name) + '...</span>', true);
      try {
        const res = await ExtensionManager.installMaster(name, msg => {
          const el = document.getElementById(id); if (el) el.textContent = msg;
        });
        const el = document.getElementById(id);
        if (el) { el.className = 'text-yellow-600'; el.textContent = res.info; }
      } catch (e) {
        const el = document.getElementById(id);
        const msg = String(e.message || e).toUpperCase();
        if (el) { el.className = 'text-red-600'; el.textContent = msg; }
        else this.printError(msg);
        return false;
      }
    }
    return true;
  }

  async cmdInstallPkg(name) {
    name = String(name).trim();
    if (!name) { this.printError('Usage: Install{pkg}'); return false; }
    if (Terminal.extensions[name.toLowerCase()]) { this.printError('ALREADY EXIST: ' + name); return false; }
    const id = Utils.generateId();
    this.print('<span id="' + id + '" class="text-blue-600">Installing ' + Utils.escapeHTML(name) + '...</span>', true);
    try {
      const res = await ExtensionManager.installPkg(name, msg => {
        const el = document.getElementById(id); if (el) el.textContent = msg;
      });
      const el = document.getElementById(id);
      if (el) { el.className = 'text-yellow-600'; el.textContent = res.info; }
      return true;
    } catch (e) {
      const el = document.getElementById(id);
      const msg = String(e.message || e).toUpperCase();
      if (el) { el.className = 'text-red-600'; el.textContent = msg; }
      else this.printError(msg);
      return false;
    }
  }

  async cmdExportDir(dir) {
    const all = await Storage.keys('vfs');
    const data = {};
    const pfx = dir === '/' ? '/' : dir + '/';
    let count = 0;
    for (const k of all) {
      if (k.startsWith(pfx) || k === dir) {
        const entry = await Storage.get(k, 'vfs');
        if (entry && entry.isBinary && entry.content instanceof Blob) {
          const b64 = await Utils.blobToBase64(entry.content);
          data[k] = { type: 'file', isBinary: true, base64: b64, name: k.split('/').pop() };
        } else if (entry && entry.type === 'file') {
          const scan = Terminal.SecurityScanner.scan(Utils.basename(k), entry.content);
          if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + k + ' -> ' + scan.reason);
          data[k] = entry;
        } else { data[k] = entry; }
        count++;
      }
    }
    if (count === 0) throw new Error('EMPTY DIRECTORY');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dirName = dir === '/' ? 'root' : dir.split('/').filter(Boolean).pop() || 'root';
    a.download = dirName + '-backup-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.printSuccess('Exported folder: ' + dir);
  }

  async cmdExportAll() {
    const all = await Storage.keys('vfs');
    const data = {};
    for (const k of all) {
      const entry = await Storage.get(k, 'vfs');
      if (entry && entry.isBinary && entry.content instanceof Blob) {
        const b64 = await Utils.blobToBase64(entry.content);
        data[k] = { type: 'file', isBinary: true, base64: b64, name: k.split('/').pop() };
      } else if (entry && entry.type === 'file') {
        const scan = Terminal.SecurityScanner.scan(Utils.basename(k), entry.content);
        if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + k + ' -> ' + scan.reason);
        data[k] = entry;
      } else { data[k] = entry; }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vfs-full-backup-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.printSuccess('Exported entire system');
  }

  async cmdExportFile(name) {
    const target = Utils.resolvePath(this.cwd, name);
    const entry = await Storage.get(target, 'vfs');
    if (!entry || entry.type !== 'file') throw new Error('NOT EXIST: ' + name);
    let blob;
    if (entry.isBinary && entry.content instanceof Blob) {
      blob = entry.content;
    } else {
      const scan = Terminal.SecurityScanner.scan(Utils.basename(name), entry.content);
      if (!scan.safe) throw new Error('EXPORT BLOCKED: ' + scan.reason);
      blob = new Blob([entry.content || ''], { type: 'text/plain' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name.split('/').pop();
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.printSuccess('Exported: ' + name);
  }

  async openMiniByName(name) {
    const lower = name.toLowerCase();
    const ext = Terminal.extensions[lower];
    if (!ext) throw new Error('THIS NOT WORK !!!');
    if (ext.type === 'master') return this._openMasterMini(lower);
    throw new Error('THIS NOT WORK !!!');
  }

  async _openMasterMini(lower) {
    const ext = Terminal.extensions[lower];
    if (!ext) throw new Error('THIS NOT WORK !!!');
    if (ext.type !== 'master') throw new Error('THIS NOT WORK !!!');
    if (UI.miniWindows[lower]) { UI.focusWindow(UI.miniWindows[lower]); this.printSystem('ALREADY OPEN: ' + lower); return; }
    const session = new TerminalSession({ floating: true, scope: 'master', scopeName: lower, windowKey: lower, title: lower });
    UI.miniWindows[lower] = session;
    UI.attachInput(session);
    session.cap.focus();
    UI.activeSession = session;
  }

  async _openPkgMini(lower, autoRun = false, displayName = null) {
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
  }

  async _openKitMini(name) {
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
  }

  _createKitWindow(name, html) {
    const key = 'kit:' + name;

    const win = document.createElement('div');
    win.className = 'mini-window fade-in';
    Object.assign(win.style, {
      position: 'fixed',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-1)',
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
    const btnClose = mkBtn('X', () => {
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
  }

  async openFallbackWindow() {
    if (UI.fallbackWindow) { UI.focusWindow(UI.fallbackWindow); this.printSystem('ALREADY OPEN: DMS'); return; }
    const session = new TerminalSession({ floating: true, scope: 'root', title: state.settings.username });
    UI.fallbackWindow = session;
    UI.attachInput(session);
    session.cap.focus();
    UI.activeSession = session;
  }

  async cmdDelFile(name) {
    const t = Utils.resolvePath(this.cwd, name);
    const prot = new Set(['/', '/home', '/home/' + state.settings.username]);
    if (prot.has(t)) throw new Error('Core folder is protected');
    const e = await Storage.get(t, 'vfs');
    if (!e) throw new Error('NOT EXIST: ' + name);
    if (e.type === 'dir') {
      const all = await Storage.keys('vfs');
      for (const k of all) if (k.startsWith(t + '/')) await Storage.remove(k, 'vfs');
    }
    await Storage.remove(t, 'vfs');
    this.printSuccess('Deleted: ' + name);
  }

  async cmdDelAllFiles() {
    const all = await Storage.keys('vfs');
    const prot = new Set(['/', '/home', '/home/' + state.settings.username]);
    let n = 0;
    for (const k of all) if (!prot.has(k)) { await Storage.remove(k, 'vfs'); n++; }
    this.printSuccess('Deleted ' + n + ' items');
  }

  async cmdDelExt(name) {
    const lower = name.toLowerCase();

    if (lower.startsWith('kit:')) {
      const kitName = lower.slice(4);
      const key = 'kit:' + kitName;
      const k = UI.kitWindows[key];
      if (k) {
        try { k.win.remove(); } catch (e) {}
        delete UI.kitWindows[key];
        this.printSuccess('Closed kit: ' + kitName);
      } else {
        this.printSuccess('No open kit: ' + kitName);
      }
      return;
    }

    if (!Terminal.extensions[lower]) throw new Error('NOT EXIST: ' + name);
    await ExtensionManager.remove(lower);
    this.printSuccess('Removed: ' + name);
  }

  async cmdDelAllExts() {
    for (const extName of Object.keys(Terminal.extensions)) Terminal.unregisterExtension(extName);
    const keys = await Storage.keys('system');
    for (const k of keys) {
      if (typeof k !== 'string') continue;
      if (k.startsWith('ext:')) {
        const n = k.slice(4);
        await Storage.remove(k, 'system');
        await Storage.remove('ext_type:' + n, 'system');
      }
    }
    extAliases = {};
    this.printSuccess('All extensions removed');
  }

  async cmdRunFile(arg) {
    if (!arg) throw new Error('Usage: RUN(file)');
    const fn = arg.split('/').pop();
    const dot = fn.lastIndexOf('.');
    const ext = dot > 0 ? '.' + fn.slice(dot + 1).toLowerCase() : '';
    const target = Utils.resolvePath(this.cwd, arg);
    const entry = await Storage.get(target, 'vfs');
    if (!entry || entry.type !== 'file') throw new Error('NOT EXIST: ' + arg);
    if (ext && Terminal.runners[ext]) return Terminal.runners[ext].call(this, fn, entry.content);
    this.print(entry.content);
  }
}

window.TerminalSession = TerminalSession;
window.state = state;
window.keyAliases = keyAliases;
window.cmdAliases = cmdAliases;
window.extAliases = extAliases;