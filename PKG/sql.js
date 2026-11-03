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
    info: 'SQL Package installed successfully! Use SQL to enter the prompt or RUN file.sql.',
    commands: {
      SQL: function () {
        if (!db) throw new Error('Run a .sql file first to initialize the database.');
        this.mode = 'sql';
        this.promptPrefix = 'sql> ';
        this.updatePrompt();
      },
      __SQL_EVAL__: async function (input) {
        if (input.trim().toUpperCase() === 'EXIT') {
          this.mode = 'shell'; this.promptPrefix = ''; this.updatePrompt();
          this.printSystem('SQL session ended.');
          return;
        }
        await execSQL(this, input);
      }
    },
    runners: {
      '.sql': async function (filename, content) {
        await init();
        this.printSystem('Executing ' + filename + '...');
        await execSQL(this, content);
      }
    }
  });

  async function execSQL(session, query) {
    try {
      const res = db.exec(query);
      if (res.length === 0) return;
      for (const r of res) {
        session.printSystem('Columns: ' + r.columns.join(' | '));
        session.printSystem('-----------------------------------');
        for (const row of r.values) {
          session.printSystem(row.map(v => v === null ? 'NULL' : String(v)).join(' | '));
        }
        session.printSystem('Rows: ' + r.values.length);
      }
    } catch (e) { session.printError('SQL Error: ' + e.message); }
  }
})();
