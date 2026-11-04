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
        s.src = CDN; 
        s.onload = res; 
        s.onerror = () => rej(new Error('Failed to load SQL engine (CDN blocked)'));
        document.head.appendChild(s);
      });
    }
    SQL = await window.initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    db = new SQL.Database();
  }

  async function execSQL(session, query) {
    if (!query.trim()) return;
    try {
      const res = db.exec(query);
      if (res.length === 0) {
        session.printSystem('Query OK, 0 rows affected.');
        return;
      }
      for (const r of res) {
        session.printSystem('Columns: ' + r.columns.join(' | '));
        session.printSystem('-----------------------------------');
        if (r.values.length === 0) {
          session.printSystem('(No data)');
        } else {
          for (const row of r.values) {
            session.printSystem(row.map(v => v === null ? 'NULL' : String(v)).join(' | '));
          }
        }
        session.printSystem('Rows: ' + r.values.length);
      }
    } catch (e) { 
      session.printError('SQL Error: ' + e.message); 
    }
  }

  function exitSQL(session) {
    session.mode = 'shell';
    session.promptPrefix = '';
    session.updatePrompt();
    // Removed the "SQL session ended." message here
  }

  T.registerExtension({
    name: 'sql',
    info: 'SQL Package installed successfully! Use RUN{sql} to begin.',
    commands: {
      SQL: async function () {
        try {
          await init();
          this.mode = 'sql';
          this.promptPrefix = 'sql> ';
          this.updatePrompt();
        } catch (e) {
          throw new Error('SQL Init Failed: ' + e.message);
        }
      }
    },
    runners: {
      '.sql': async function (filename, content) {
        await init();
        this.printSystem('Executing ' + filename + '...');
        await execSQL(this, content);
      }
    },
    modes: {
      sql: {
        async onInput(session, input) {
          session.print(session.promptEl.innerHTML + Terminal.Utils.escapeHTML(input), true);
          const up = input.trim().toUpperCase();
          if (['EXIT','QUIT'].includes(up)) {
            exitSQL(session);
            return;
          }
          session.executing = true;
          try { 
            await execSQL(session, input); 
          } finally { 
            session.executing = false; 
          }
        },
        onAbort(session) {
          exitSQL(session);
        }
      }
    }
  });
})();
