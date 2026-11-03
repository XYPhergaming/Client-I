(function () {
  'use strict';
  const T = Terminal, S = T.Storage, U = T.Utils;
  const start = Date.now();

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
    info: 'Master Key imported successfully! All advanced commands are now available.',
    commands: {
      // File System
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

      // Calculator & Utilities
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
        const a = tokenize(arg);
        let min = 0, max = 100;
        if (a.length === 2) {
          min = parseInt(a[0], 10);
          max = parseInt(a[1], 10);
          if (isNaN(min) || isNaN(max) || max < min) throw new Error('Usage: RANDOM [min max] — both must be integers and max >= min');
        } else if (a.length === 1) {
          throw new Error('Usage: RANDOM [min max] — provide both min and max, or neither for 0–100');
        }
        this.printSystem(String(Math.floor(Math.random() * (max - min + 1)) + min));
      },
      PASS: function (arg) {
        const len = parseInt(arg.trim(), 10);
        if (isNaN(len) || len < 1 || len > 256) {
          throw new Error('Usage: PASS [length] — length must be an integer between 1 and 256');
        }
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
        let p = '';
        for (let i = 0; i < len; i++) p += chars[Math.floor(Math.random() * chars.length)];
        this.printSystem(p);
      },

      // System Info
      WHOAMI: function () { this.printSystem(T.getUsername()); },
      UPTIME: function () {
        const sec = Math.floor((Date.now() - start) / 1000);
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
      }
    }
  });
})();