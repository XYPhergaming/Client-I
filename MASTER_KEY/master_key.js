(function () {
  'use strict';
  const T = Terminal, S = T.Storage, U = T.Utils;

  async function readEntry(session, path) {
    const p = U.resolvePath(session.cwd, path);
    return { path: p, entry: await S.get(p, 'vfs') };
  }
  async function readText(session, path) {
    const { path: p, entry } = await readEntry(session, path);
    if (!entry || entry.type !== 'file') throw new Error('Not a file: ' + path);
    return { path: p, content: entry.content || '' };
  }
  function tokenize(line) { return line.trim().split(/\s+/).filter(Boolean); }

  T.registerExtension({
    name: 'master_key',
    info: 'Master Key imported successfully! All advanced commands (LS, CAT, CALC, UPTIME, etc.) are now available.',
    commands: {
      PWD: function () { this.printSystem(this.cwd); },
      LS: async function (arg) {
        const p = U.resolvePath(this.cwd, arg.trim() || this.cwd);
        const all = await S.keys('vfs');
        const pfx = p === '/' ? '/' : p + '/';
        const firsts = new Set();
        for (const k of all) if (k.startsWith(pfx) && k !== p) firsts.add(k.slice(pfx.length).split('/')[0]);
        const rows = [];
        for (const n of firsts) rows.push([n, await S.get(pfx + n, 'vfs') || { type: 'file' }]);
        rows.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [n, e] of rows) this.printSystem('  ' + n + (e.type === 'dir' ? '/' : ''));
      },
      CAT: async function (arg) {
        const a = tokenize(arg);
        if (!a.length) throw new Error('Usage: CAT <file>');
        for (const f of a) {
          const { content } = await readText(this, f);
          this.print(content);
        }
      },
      HEAD: async function (arg) {
        const a = tokenize(arg);
        if (!a.length) throw new Error('Usage: HEAD [n] <file>');
        let n = 10, file = a[0];
        if (a.length === 2) { n = parseInt(a[0], 10) || 10; file = a[1]; }
        const { content } = await readText(this, file);
        this.print(content.split('\n').slice(0, n).join('\n'));
      },
      TAIL: async function (arg) {
        const a = tokenize(arg);
        if (!a.length) throw new Error('Usage: TAIL [n] <file>');
        let n = 10, file = a[0];
        if (a.length === 2) { n = parseInt(a[0], 10) || 10; file = a[1]; }
        const { content } = await readText(this, file);
        this.print(content.split('\n').slice(-n).join('\n'));
      },
      CP: async function (arg) {
        const a = tokenize(arg);
        if (a.length !== 2) throw new Error('Usage: CP <src> <dst>');
        const src = await readEntry(this, a[0]);
        if (!src.entry) throw new Error('Not found: ' + a[0]);
        const dstPath = U.resolvePath(this.cwd, a[1]);
        if (await S.get(dstPath, 'vfs')) throw new Error('Already exists: ' + a[1]);
        await S.set(dstPath, JSON.parse(JSON.stringify(src.entry)), 'vfs');
        if (src.entry.type === 'dir') {
          const all = await S.keys('vfs');
          for (const k of all) {
            if (k.startsWith(src.path + '/')) {
              const v = await S.get(k, 'vfs');
              await S.set(dstPath + k.slice(src.path.length), JSON.parse(JSON.stringify(v)), 'vfs');
            }
          }
        }
      },
      MV: async function (arg) {
        const a = tokenize(arg);
        if (a.length !== 2) throw new Error('Usage: MV <src> <dst>');
        const src = await readEntry(this, a[0]);
        if (!src.entry) throw new Error('Not found: ' + a[0]);
        const dstPath = U.resolvePath(this.cwd, a[1]);
        if (await S.get(dstPath, 'vfs')) throw new Error('Already exists: ' + a[1]);
        await S.set(dstPath, src.entry, 'vfs');
        if (src.entry.type === 'dir') {
          const all = await S.keys('vfs');
          for (const k of all) if (k.startsWith(src.path + '/')) {
            const v = await S.get(k, 'vfs');
            await S.set(dstPath + k.slice(src.path.length), v, 'vfs');
            await S.remove(k, 'vfs');
          }
        }
        await S.remove(src.path, 'vfs');
      },
      TREE: async function (arg) {
        const root = U.resolvePath(this.cwd, arg.trim() || '.');
        const all = await S.keys('vfs');
        const lines = [];
        const walk = async (dir, prefix) => {
          const pfx = dir === '/' ? '/' : dir + '/';
          const firsts = new Set();
          for (const k of all) if (k.startsWith(pfx) && k !== dir) firsts.add(k.slice(pfx.length).split('/')[0]);
          const items = [];
          for (const n of firsts) items.push([n, await S.get(pfx + n, 'vfs')]);
          items.sort((a, b) => a[0].localeCompare(b[0]));
          for (let i = 0; i < items.length; i++) {
            const [n, e] = items[i];
            const last = i === items.length - 1;
            lines.push(prefix + (last ? '`-- ' : '|-- ') + n + (e && e.type === 'dir' ? '/' : ''));
            if (e && e.type === 'dir') await walk(pfx + n, prefix + (last ? '    ' : '|   '));
          }
        };
        lines.push(root);
        await walk(root, '');
        this.print(lines.join('\n'));
      },
      CALC: function (arg) {
        if (!arg) throw new Error('Usage: CALC <expression>');
        try {
          const sanitized = arg.replace(/[^0-9+\-*/().%\s]/g, '');
          const result = new Function('return ' + sanitized)();
          this.printSystem(String(result));
        } catch (e) { throw new Error('Invalid expression'); }
      },
      UUID: function () {
        const u = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        this.printSystem(u);
      },
      RANDOM: function (arg) {
        const a = arg.trim().split(/\s+/);
        let min = 0, max = 100;
        if (a.length === 2) { min = parseInt(a[0], 10); max = parseInt(a[1], 10); }
        const range = max - min + 1;
        if (!Number.isFinite(range) || range <= 0) throw new Error('Invalid range');
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        this.printSystem(String(min + (buf[0] % range)));
      },
      PASS: function (arg) {
        const len = Math.max(1, Math.min(256, parseInt(arg.trim(), 10) || 16));
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        let p = '';
        for (let i = 0; i < len; i++) p += chars[arr[i] % chars.length];
        this.printSystem(p);
      },
      WHOAMI: function () { this.printSystem(T.getUsername()); },
      UPTIME: function () {
        const sec = Math.floor(performance.now() / 1000);
        const m = Math.floor(sec / 60), s = sec % 60;
        this.printSystem('Uptime: ' + m + 'm ' + s + 's');
      },
      PS: function () {
        this.printSystem('PID  CMD');
        this.printSystem('1    terminal');
        if (T.extensions['python']) this.printSystem('2    python-worker');
        if (T.extensions['sql']) this.printSystem('3    sql-engine');
      },
      ENV: function () {
        this.printSystem('USER=' + T.getUsername());
        this.printSystem('PWD=' + (T.session ? T.session.cwd : '/'));
        this.printSystem('TERM=xterm-256color');
      },
      MEM: function () {
        if (performance && performance.memory) {
          this.printSystem('Used JS Heap: ' + (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB');
        } else this.printSystem('Memory API not supported.');
      },
      BASE64: function (arg) {
        const bytes = new TextEncoder().encode(arg);
        let bin = '';
        bytes.forEach(b => bin += String.fromCharCode(b));
        this.printSystem(btoa(bin));
      },
      UNBASE64: function (arg) {
        try {
          const bin = atob(arg);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          this.printSystem(new TextDecoder().decode(bytes));
        } catch (e) { throw new Error('Invalid Base64 string'); }
      }
    }
  });
})();