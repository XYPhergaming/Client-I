(function () {
  'use strict';
  const T = Terminal;

  function executeJS(session, code) {
    if (!code.trim()) return;
    
    // Capture console.log to print inside the terminal
    const originalLog = console.log;
    console.log = function(...args) {
      session.printSystem(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    try {
      // Use window.eval to keep variables persistent in the REPL mode
      const result = window.eval(code);
      
      // If the code returns a value (like 2+2), print it
      if (result !== undefined) {
        const out = typeof result === 'object' ? JSON.stringify(result) : String(result);
        session.printSuccess(out);
      }
    } catch (err) {
      session.printError(err.toString());
    } finally {
      // Restore original console.log
      console.log = originalLog;
    }
  }

  T.registerExtension({
    name: 'js',
    info: 'JavaScript Runtime loaded. Use RUN{js} or MINI{{js}}.',
    
    // This function triggers when the user types RUN{js}
    run: function () {
      this.mode = 'js';
      this.promptPrefix = 'js> ';
      this.updatePrompt();
      
      this.printSystem("Entered JavaScript REPL Mode.");
      this.printSystem("Type 'exit' to quit, 'clear' to clear screen.");
    },

    // Custom mode logic for the REPL (Read-Eval-Print Loop)
    modes: {
      js: {
        onInput: async function (session, input) {
          // Echo the input so the text doesn't disappear on screen
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);
          
          const trimmed = input.trim();

          // Exit logic
          if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'js.exit') {
            session.mode = 'shell';
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }

          // Clear logic
          if (trimmed === 'clear') {
            session.clear();
            return;
          }

          // Execute the JavaScript
          executeJS(session, input);
        }
      }
    },

    // File runner: RUN(script.js) will execute the file content
    runners: {
      '.js': async function (filename, content) {
        this.printSystem(`Running ${filename}...`);
        executeJS(this, content);
      }
    }
  });
})();