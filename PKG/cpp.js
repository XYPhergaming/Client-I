(function () {
    'use strict';

    // Helper function to compile and execute the buffered code using Piston API
    async function executeCode(session, state) {
        const code = state.buffer.join('\n');
        
        // Reset buffer and empty line counter after a run attempt
        state.buffer = [];
        state.emptyLines = 0;

        if (!code.trim()) {
            session.printSystem("No code provided to execute.");
            return;
        }

        session.printSystem("Compiling and executing...");

        try {
            const fileName = state.lang === 'c' ? 'main.c' : 'main.cpp';
            const payload = {
                language: state.lang,
                version: "*",
                files: [
                    {
                        name: fileName,
                        content: code
                    }
                ]
            };

            const response = await fetch('https://emkc.org/api/v2/piston/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Handle compilation phase output
            if (data.compile && data.compile.code !== 0) {
                session.printError("Compilation Error:\n" + data.compile.output);
                return;
            }

            // Handle runtime phase output
            if (data.run) {
                if (data.run.code !== 0) {
                    session.printError("Runtime Error (Exit Code " + data.run.code + "):\n" + (data.run.output || ""));
                } else {
                    session.printSuccess(data.run.output || "Program finished executing with no output.");
                }
            } else {
                session.printSystem("Execution completed with an unexpected API response format.");
            }

        } catch (error) {
            session.printError("Failed to execute code: " + error.message);
        }
    }

    // Register the PKG Extension with the global Terminal object
    Terminal.registerExtension({
        name: 'cpp',
        run: function (session, args) {
            try {
                // Determine whether to use 'c' or 'c++' based on runtime arguments
                let lang = 'c++';
                if (args) {
                    const argStr = Array.isArray(args) ? args[0] : String(args);
                    if (argStr.trim().toLowerCase() === 'c') {
                        lang = 'c';
                    }
                }

                // Initialize a local state attached to the session object
                session._cppState = {
                    buffer: [],
                    emptyLines: 0,
                    lang: lang
                };

                session.printSystem(`Entered ${lang === 'c' ? 'C' : 'C++'} Mode.`);
                session.printSystem("Type 'run' or leave two empty lines to compile and execute.");
                session.printSystem("Type 'exit' or 'quit' to return to default mode.");

                // Change terminal mode to 'cpp'
                if (typeof session.setMode === 'function') {
                    session.setMode('cpp');
                } else {
                    session.mode = 'cpp';
                }

                // If the terminal supports dynamic prompt switching, set it directly
                if (typeof session.setPrompt === 'function') {
                    session._cppOriginalPrompt = session.prompt || '> ';
                    session.setPrompt('cpp> ');
                }
            } catch (error) {
                session.printError("Failed to initialize C/C++ mode: " + error.message);
            }
        },
        modes: {
            cpp: {
                prompt: 'cpp> ', // Some terminal variants read the prompt string from the mode definition
                onInput: async function (session, input) {
                    try {
                        // Ensure state exists to prevent null reference errors
                        if (!session._cppState) {
                            session._cppState = { buffer: [], emptyLines: 0, lang: 'c++' };
                        }

                        const state = session._cppState;
                        const trimmedInput = input.trim();

                        // Handle graceful exit command
                        if (trimmedInput === 'exit' || trimmedInput === 'quit') {
                            state.buffer = [];
                            state.emptyLines = 0;
                            
                            session.printSystem("Exiting C/C++ mode.");
                            
                            // Restore original prompt if modified
                            if (typeof session.setPrompt === 'function' && session._cppOriginalPrompt) {
                                session.setPrompt(session._cppOriginalPrompt);
                            }

                            // Switch back to the default terminal mode
                            if (typeof session.exitMode === 'function') {
                                session.exitMode();
                            } else if (typeof session.setMode === 'function') {
                                session.setMode('default');
                            } else {
                                session.mode = 'default';
                            }
                            return;
                        }

                        // Explicit run trigger
                        if (trimmedInput === 'run') {
                            await executeCode(session, state);
                            return;
                        }

                        // Monitor empty lines to trigger execution on double empty line
                        if (trimmedInput === '') {
                            state.emptyLines += 1;
                            if (state.emptyLines >= 2) {
                                await executeCode(session, state);
                                return;
                            }
                        } else {
                            // Reset empty line counter whenever valid code is entered
                            state.emptyLines = 0;
                        }

                        // Store the multiline input into the buffer
                        state.buffer.push(input);

                    } catch (error) {
                        session.printError("Error processing input: " + error.message);
                    }
                }
            }
        }
    });

})();