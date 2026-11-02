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
    name: 'fileutils',
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
      LL: async function (arg) {
        const p = U.resolvePath(this.cwd, arg.trim() || this.cwd);
        const all = await S.keys('vfs');
        const pfx = p === '/' ? '/' : p + '/';
        const firsts = new Set();
        for (const k of all) if (k.startsWith(pfx) && k !== p) firsts.add(k.slice(pfx.length).split('/')[0]);
        const rows = [];
        for (const n of firsts) rows.push([n, await S.get(pfx + n, 'vfs') || { type: 'file' }]);
        rows.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [n, e] of rows) {
          const kind = e.type === 'dir' ? 'd' : '-';
          const size = e.type === 'dir' ? '-' : String((e.content || '').length);
          this.printSystem('  ' + kind + '  ' + size.padStart(8) + '  ' + n);
        }
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
      FIND: async function (arg) {
        const q = arg.trim();
        if (!q) throw new Error('Usage: FIND <substring>');
        const all = await S.keys('vfs');
        let found = 0;
        for (const k of all) if (k.toLowerCase().includes(q.toLowerCase())) { this.printSystem(k); found++; }
        if (!found) this.printSystem('No matches.');
      },
      GREP: async function (arg) {
        const a = tokenize(arg);
        if (a.length !== 2) throw new Error('Usage: GREP <pattern> <file>');
        const { content } = await readText(this, a[1]);
        const lines = content.split('\n');
        let hits = 0;
        for (let i = 0; i < lines.length; i++) if (lines[i].includes(a[0])) { this.printSystem((i + 1) + ': ' + lines[i]); hits++; }
        if (!hits) this.printSystem('No matches.');
      },
      STAT: async function (arg) {
        const { path: p, entry } = await readEntry(this, arg.trim());
        if (!entry) throw new Error('Not found: ' + arg);
        this.printSystem('Path: ' + p);
        this.printSystem('Type: ' + entry.type);
        if (entry.type === 'file') this.printSystem('Size: ' + U.formatSize((entry.content || '').length));
      },
      TOUCH: async function (arg) {
        const name = arg.trim();
        if (!name) throw new Error('Usage: TOUCH <file>');
        const p = U.resolvePath(this.cwd, name);
        if (!(await S.get(p, 'vfs'))) await S.set(p, { type: 'file', content: '' }, 'vfs');
      },
      RMDIR: async function (arg) {
        const name = arg.trim();
        if (!name) throw new Error('Usage: RMDIR <folder>');
        const p = U.resolvePath(this.cwd, name);
        const e = await S.get(p, 'vfs');
        if (!e || e.type !== 'dir') throw new Error('Not a folder: ' + name);
        const all = await S.keys('vfs');
        const pfx = p === '/' ? '/' : p + '/';
        for (const k of all) if (k !== p && k.startsWith(pfx)) throw new Error('Folder not empty: ' + name);
        await S.remove(p, 'vfs');
      },
      WC: async function (arg) {
        const { content } = await readText(this, arg.trim());
        const lines = content.split('\n');
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        this.printSystem('Lines: ' + lines.length + '  Words: ' + words + '  Chars: ' + content.length);
      },
      SORT: async function (arg) {
        const a = tokenize(arg);
        if (a.length === 1 && a[0] !== '-r') {
          const { content } = await readText(this, a[0]);
          this.print(content.split('\n').sort().join('\n'));
        } else if (a.length === 2 && a[0] === '-r') {
          const { content } = await readText(this, a[1]);
          this.print(content.split('\n').sort().reverse().join('\n'));
        } else throw new Error('Usage: SORT [-r] <file>');
      },
      UNIQ: async function (arg) {
        const { content } = await readText(this, arg.trim());
        const out = [];
        let prev = null;
        for (const line of content.split('\n')) if (line !== prev) { out.push(line); prev = line; }
        this.print(out.join('\n'));
      }
    }
  });
})();