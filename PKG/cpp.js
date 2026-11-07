(function () {
  'use strict';
  const T = Terminal;

  async function executeCode(session, code, lang) {
    if (!code.trim()) {
      session.printSystem("No code provided to execute.");
      return;
    }

    session.printSystem(`Compiling and executing ${lang === 'c' ? 'C' : 'C++'}...`);

    try {
      const fileName = lang === 'c' ? 'main.c' : 'main.cpp';
      const payload = {
        language: lang,
        version: "*",
        files: [{ name: fileName, content: code }]
      };

      // Adding User-Agent header and a fallback API endpoint to fix 401 errors
      let response;
      try {
        response = await fetch('https://emkc.org/api/v2/piston/execute', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'Kalma-Terminal/1.0'
          },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        // Fallback to piston.rs if emkc fails
        response = await fetch('https://piston.rs/api/v2/execute', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'Kalma-Terminal/1.0'
          },
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
      
      const data = await response.json();

      if (data.compile && data.compile.code !== 0) {
        session.printError("Compilation Error:\n" + data.compile.output);
        return;
      }

      if (data.run) {
        if (data.run.code !== 0) {
          session.printError("Runtime Error (Exit Code " + data.run.code + "):\n" + (data.run.output || ""));
        } else {
          session.printSuccess(data.run.output || "Program finished with no output.");
        }
      } else {
        session.printSystem("Execution completed with an unexpected API response format.");
      }
    } catch (error) {
      session.printError("Failed to execute code: " + error.message);
    }
  }

  T.registerExtension({
    name: 'cpp',
    
    run: function () {
      this.mode = 'cpp';
      this.promptPrefix = 'cpp> ';
      this.updatePrompt();
      
      this._cppState = { buffer: [], emptyLines: 0 };
      
      this.printSystem("Entered C++ Mode.");
      this.printSystem("Type 'run' or leave two empty lines to compile and execute.");
      this.printSystem("Type 'exit' to return to shell.");
    },

    modes: {
      cpp: {
        onInput: async function (session, input) {
          // Print the input to the screen because index.html does not echo in custom modes
          session.print(session.promptEl.innerHTML + ' ' + T.Utils.escapeHTML(input), true);

          if (!session._cppState) session._cppState = { buffer: [], emptyLines: 0 };
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
            state.emptyLines = 0;
            await executeCode(session, code, 'c++');
            return;
          }

          if (trimmed === '') {
            state.emptyLines++;
            if (state.emptyLines >= 2) {
              const code = state.buffer.join('\n');
              state.buffer = [];
              state.emptyLines = 0;
              await executeCode(session, code, 'c++');
              return;
            }
          } else {
            state.emptyLines = 0;
          }

          state.buffer.push(input);
        }
      }
    },

    runners: {
      '.c': async function (filename, content) {
        await executeCode(this, content, 'c');
      },
      '.cpp': async function (filename, content) {
        await executeCode(this, content, 'c++');
      }
    }
  });
})();