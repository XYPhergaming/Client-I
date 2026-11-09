'use strict';

let keyAliases = {};
let cmdAliases = {};
let extAliases = {};

window.keyAliases = keyAliases;
window.cmdAliases = cmdAliases;
window.extAliases = extAliases;

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
    d.style.marginBottom = '8px';
    if (isHtml) d.innerHTML = html; else d.textContent = html;
    this.out.appendChild(d);
    if (isAtBottom) this.container.scrollTop = this.container.scrollHeight;
  }

  printElement(el) {
    const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 60;
    const wrapper = document.createElement('div');
    wrapper.className = 'fade-in';
    wrapper.style.marginBottom = '12px';
    wrapper.appendChild(el);
    this.out.appendChild(wrapper);
    if (isAtBottom) this.container.scrollTop = this.container.scrollHeight;
  }

  printChat(text, align = 'left') {
    const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 60;
    const d = document.createElement('div');
    d.className = 'mb-1 fade-in';
    d.style.marginBottom = '8px';
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

  _openFolderSettings(id, name, el, folderSvg) {
    const getCfg = (k, def) => {
      try { return JSON.parse(localStorage.getItem('folder_cfg_' + k)) || def; } catch (e) { return def; }
    };
    const cfg = getCfg(id, { color: '#00ff41' });
    
    const ov = document.createElement('div');
    ov.className = 'custom-select-overlay';
    ov.innerHTML = `
      <div class="custom-select-list" style="padding:20px; color:var(--fg-0);">
        <div class="custom-select-title" style="margin-bottom:15px;">FOLDER SETTINGS: ${name}</div>
        <label style="display:block; margin-bottom:5px; color:var(--cyan); font-size:10px;">COLOR (HEX)</label>
        <input type="color" id="f-color-${id}" value="${cfg.color}" style="width:100%; height:40px; background:var(--bg-1); border:1px solid var(--line-2); cursor:pointer; margin-bottom:20px; padding:0;" />
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button id="f-cancel-${id}" class="btn">CANCEL</button>
          <button id="f-save-${id}" class="btn-primary">SAVE</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    ov.querySelector('#f-cancel-'+id).onclick = () => ov.remove();
    ov.querySelector('#f-save-'+id).onclick = () => {
      const color = ov.querySelector('#f-color-'+id).value;
      localStorage.setItem('folder_cfg_' + id, JSON.stringify({ color }));
      ov.remove();
      
      const iconWrap = el.querySelector('.folder-icon');
      iconWrap.style.color = color;
      el.querySelector('.folder-label').style.color = color;
    };
  }

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
}
window.TerminalSession = TerminalSession;