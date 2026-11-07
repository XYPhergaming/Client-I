(function () {
  'use strict';
  const T = Terminal;

  // Helper function to compile and execute the buffered code using Piston API
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

      const response = await fetch('https://emkc.org/api/v2/piston/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

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
    
    // 1. RUN{cpp} বা MINI{{cpp}} দিলে এই ফাংশনটি চলবে
    run: function () {
      this.mode = 'cpp';
      this.promptPrefix = 'cpp> ';
      this.updatePrompt();
      
      this._cppState = { buffer: [], emptyLines: 0 };
      
      this.printSystem("Entered C++ Mode.");
      this.printSystem("Type 'run' or leave two empty lines to compile and execute.");
      this.printSystem("Type 'exit' to return to shell.");
    },

    // 2. টার্মিনালের ভেতরে ঢুকে কোড লেখার সময় যা হবে (modes)
    modes: {
      cpp: {
        onInput: async function (session, input) {
          if (!session._cppState) session._cppState = { buffer: [], emptyLines: 0 };
          const state = session._cppState;
          const trimmed = input.trim();

          // Exit logic
          if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'cpp.exit') {
            session.mode = 'shell';
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }

          // Run logic
          if (trimmed === 'run') {
            const code = state.buffer.join('\n');
            state.buffer = [];
            state.emptyLines = 0;
            await executeCode(session, code, 'c++');
            return;
          }

          // Double empty line trigger
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

          // Add code to buffer
          state.buffer.push(input);
        }
      }
    },

    // 3. .c এবং .cpp ফাইল সরাসরি রান করার জন্য (runners)
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