(function () {
  'use strict';
  const T = Terminal;

  function executeJS(session, code) {
    if (!code.trim()) return;

    const originalLog = console.log;
    console.log = function (...args) {
      session.printSystem(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    try {
      const result = window.eval(code);
      if (result !== undefined) {
        const out = typeof result === 'object' ? JSON.stringify(result) : String(result);
        session.printSuccess(out);
      }
    } catch (err) {
      session.printError(err.toString());
    } finally {
      console.log = originalLog;
    }
  }

  T.registerExtension({
    name: 'javascript',
    info: 'JavaScript Runtime loaded. Use RUN{javascript} or Mini{{javascript}}.',

    run: function () {
      this.mode = 'js';
      this.promptPrefix = 'js> ';
      this.updatePrompt();
      this.printSystem("Entered JavaScript REPL Mode.");
      this.printSystem("Type 'exit' to quit, 'clear' to clear screen.");
    },

    modes: {
      js: {
        onInput: async function (session, input) {
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);
          const trimmed = input.trim();

          if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'js.exit') {
            if (session.opts && session.opts.scope === 'pkg') {
              session.requestExit();
              return;
            }
            session.mode = 'shell';
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }

          if (trimmed === 'clear') {
            session.clear();
            return;
          }

          executeJS(session, input);
        }
      }
    },

    runners: {
      '.js': async function (filename, content) {
        this.printSystem(`Running ${filename}...`);
        executeJS(this, content);
      }
    }
  });
})();