(function () {
  'use strict';
  const T = Terminal;
  let jscppLoaded = false;

  // Load JSCPP (Local C++ Interpreter) from CDN
  async function loadJSCPP() {
    if (jscppLoaded || window.JSCPP) { jscppLoaded = true; return; }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jscpp@2.0.3/dist/jscpp.es5.min.js';
      script.onload = () => { jscppLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load JSCPP engine. Check your internet connection.'));
      document.head.appendChild(script);
    });
  }

  // Execute the C++ code locally
  async function executeCode(session, code) {
    if (!code.trim()) {
      session.printSystem("No code provided to execute.");
      return;
    }

    session.printSystem("Compiling and executing (Local JSCPP)...");

    try {
      await loadJSCPP();

      let output = '';
      const config = {
        stdio: {
          write: function (s) { output += s; }
        }
      };

      // Run the code
      window.JSCPP.run(code, 'main.cpp', config);

      if (output) {
        session.printSuccess(output);
      } else {
        session.printSystem("Program finished with no output.");
      }
    } catch (error) {
      session.printError("Execution Error: " + error.message);
    }
  }

  T.registerExtension({
    name: 'cpp',
    
    run: function () {
      this.mode = 'cpp';
      this.promptPrefix = 'cpp> ';
      this.updatePrompt();
      
      this._cppState = { buffer: [] };
      
      this.printSystem("Entered C++ Mode (Local Interpreter).");
      this.printSystem("Type 'run' to compile and execute, or 'exit' to quit.");
    },

    modes: {
      cpp: {
        onInput: async function (session, input) {
          // FIX: Echo the input so it doesn't disappear on screen
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);

          if (!session._cppState) session._cppState = { buffer: [] };
          const state = session._cppState;
          const trimmed = input.trim();

          if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'cpp.exit') {
            session.mode = 'shell';
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }

          if (trimmed === 'run') {
            const code = state.buffer.join('\n');
            state.buffer = [];
            await executeCode(session, code);
            return;
          }

          // Add code to buffer
          state.buffer.push(input);
        }
      }
    },

    runners: {
      '.c': async function (filename, content) {
        await executeCode(this, content);
      },
      '.cpp': async function (filename, content) {
        await executeCode(this, content);
      }
    }
  });
})();