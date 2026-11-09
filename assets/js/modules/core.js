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

window.state = { session: null, settings: loadSettings() };

const Terminal = {
  version: '2.4.9',
  commands: {}, extensions: {}, runners: {}, modeHandlers: {}, session: null,
  _sessionCleanupHooks: [],
  Storage: window.Storage, Utils: window.Utils, SecurityScanner: window.SecurityScanner,
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
  getUsername() { return window.state.settings.username; }
};
window.Terminal = Terminal;