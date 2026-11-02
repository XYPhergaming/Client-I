(function () {
  'use strict';
  const T = Terminal;
  let SQL = null, db = null;
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';

  async function init() {
    if (db) return;
    if (!window.initSqlJs) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = CDN; s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    SQL = await window.initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    db = new SQL.Database();
  }

  T.registerExtension({
    name: 'sql',
    info: 'SQL Package installed successfully! Use RUN{sql} to begin.',
    run: async function(session) {
      // Message is handled by index.html
      try { await init(); } catch (e) { throw new Error('SQL failed to start: ' + e.message); }
      session.mode = 'sql';
      session.promptPrefix = 'sql> ';
      session.updatePrompt();
      const cap = document.getElementById('capture');
      if (cap) { cap.disabled = false; cap.focus(); }
    },
    commands: {
      __SQL_EVAL__: async function (query) {
        try {
          const res = db.exec(query);
          if (res.length === 0) {
            this.printSuccess('Statement(s) executed.');
            return;
          }
          for (const r of res) {
            this.printSystem('Columns: ' + r.columns.join(' | '));
            this.printSystem('-----------------------------------');
            for (const row of r.values) {
              this.printSystem(row.map(v => v === null ? 'NULL' : String(v)).join(' | '));
            }
            this.printSystem('Rows: ' + r.values.length);
          }
        } catch (e) { this.printError('SQL Error: ' + e.message); }
      }
    },
    runners: {
      '.sql': async function (filename, content) {
        await init();
        this.printSystem('Executing ' + filename + '...');
        await T.commands['__SQL_EVAL__'].call(this, content);
      }
    }
  });
})();