(function () {
  'use strict';
  const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
  let worker = null, ready = null, abortFn = null, blobUrl = null;

  function makeWorker() {
    const code = `
      let pyodide;
      self.requestInput = (p) => self.postMessage({ type: 'input_request', prompt: p });
      
      // CACHE API INTERCEPTOR
      const originalFetch = self.fetch;
      self.fetch = async function(url, opts) {
          if (typeof url === 'string' && url.includes('pyodide')) {
              try {
                  const cache = await caches.open('pyodide-cache-v1');
                  const cached = await cache.match(url);
                  if (cached) {
                      return cached;
                  }
                  const res = await originalFetch(url, opts);
                  if (res.ok) {
                      cache.put(url, res.clone());
                  }
                  return res;
              } catch (e) {
                  return originalFetch(url, opts);
              }
          }
          return originalFetch(url, opts);
      };

      self.onmessage = async (e) => {
        const { id, type, code, input, pkg } = e.data;
        if (type === 'init') {
          try {
            const pyodideUrl = '${PYODIDE_CDN}';
            let pyodideCode;
            try {
                const cache = await caches.open('pyodide-cache-v1');
                const cached = await cache.match(pyodideUrl);
                if (cached) {
                    pyodideCode = await cached.text();
                } else {
                    const res = await fetch(pyodideUrl);
                    pyodideCode = await res.text();
                    cache.put(pyodideUrl, new Response(pyodideCode, { headers: { 'Content-Type': 'application/javascript' } }));
                }
            } catch(err) {
                const res = await fetch(pyodideUrl);
                pyodideCode = await res.text();
            }
            
            eval(pyodideCode); 

            pyodide = await loadPyodide({
              stdout: t => self.postMessage({ type: 'stdout', text: t }),
              stderr: t => self.postMessage({ type: 'stderr', text: t })
            });
            await pyodide.runPythonAsync(\`
import ast, asyncio, builtins, code as _code, js
async def _ai(prompt_text=""):
    js.requestInput(str(prompt_text))
    fut = asyncio.Future()
    js._resolve = fut.set_result
    return await fut
builtins.input = _ai
class _T(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and getattr(node.func, 'id', '') == 'input':
            return ast.copy_location(ast.Await(value=node), node)
        return node
def transform(src):
    try:
        t = _T().visit(ast.parse(src))
        return ast.unparse(t)
    except Exception:
        return src
def is_complete(src):
    try:
        return _code.compile_command(src) is not None
    except Exception:
        return True
\`);
            self.postMessage({ id, type: 'init_done' });
          } catch (err) {
            self.postMessage({ id, type: 'error', error: err.message });
          }
        } else if (type === 'input') {
          if (self._resolve) { self._resolve(input); self._resolve = null; }
        } else if (type === 'run') {
          try {
            const fn = pyodide.globals.get('transform');
            const res = await pyodide.runPythonAsync(fn(code));
            if (res !== undefined && res !== null) {
              const b = pyodide.pyimport('builtins');
              const r = b.repr(res);
              if (r !== 'None') self.postMessage({ type: 'stdout', text: r });
              b.destroy();
            }
            self.postMessage({ id, type: 'run_done' });
          } catch (err) {
            self.postMessage({ id, type: 'stderr', text: err.message });
            self.postMessage({ id, type: 'run_done' });
          }
        } else if (type === 'complete') {
          let ok = true;
          try { ok = pyodide.globals.get('is_complete')(code); } catch (e) {}
          self.postMessage({ id, type: 'complete_done', is_complete: ok });
        }
      };
    `;
    const blob = new Blob([code], { type: 'application/javascript' });
    blobUrl = URL.createObjectURL(blob);
    return new Worker(blobUrl);
  }

  function init() {
    if (ready) return ready;
    worker = makeWorker();
    ready = new Promise((res, rej) => {
      const onMsg = e => {
        if (e.data.type === 'init_done') { worker.removeEventListener('message', onMsg); res(); }
        else if (e.data.type === 'error') { worker.removeEventListener('message', onMsg); rej(new Error(e.data.error)); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id: 'init', type: 'init' });
    });
    ready.catch(() => { ready = null; });
    return ready;
  }

  function terminate() {
    if (worker) { try { if (blobUrl) URL.revokeObjectURL(blobUrl); worker.terminate(); } catch (e) {} worker = null; }
    ready = null; blobUrl = null; abortFn = null;
  }

  async function runBuffer(session, lines) {
    await init();
    const src = lines.join('\n');
    const complete = await new Promise(res => {
      const id = 'c' + Math.random().toString(36).slice(2);
      const h = e => {
        if (e.data.id === id && e.data.type === 'complete_done') { worker.removeEventListener('message', h); res(e.data.is_complete); }
      };
      worker.addEventListener('message', h);
      worker.postMessage({ id, type: 'complete', code: src });
      setTimeout(() => { worker.removeEventListener('message', h); res(true); }, 5000);
    });
    if (!complete) { session.promptPrefix = '... '; session.updatePrompt(); return; }
    
    session.replBuffer = [];
    session.promptPrefix = '>>> ';
    session.executing = true;
    const cap = document.getElementById('capture');
    cap.disabled = true;

    await new Promise(res => {
      const id = 'r' + Math.random().toString(36).slice(2);
      const h = e => {
        const d = e.data;
        if (d.type === 'stdout') session.printSystem(Terminal.Utils.truncate(d.text));
        else if (d.type === 'stderr') session.printError(d.text);
        else if (d.type === 'input_request') {
          session.mode = 'python_input';
          session.promptPrefix = d.prompt;
          session.updatePrompt();
          session._inputResolver = v => worker.postMessage({ type: 'input', input: v });
          cap.disabled = false; cap.focus();
        } else if (d.id === id && d.type === 'run_done') {
          worker.removeEventListener('message', h);
          session.mode = 'python';
          session.promptPrefix = '>>> ';
          session.updatePrompt();
          res();
        }
      };
      abortFn = () => { worker.removeEventListener('message', h); res(); };
      worker.addEventListener('message', h);
      worker.postMessage({ id, type: 'run', code: src });
    });
    session.executing = false;
    abortFn = null;
    if (session.mode !== 'python_input') { cap.disabled = false; cap.focus(); }
  }

  Terminal.registerExtension({
    name: 'python',
    info: 'Python Package installed successfully! Use RUN{python} to begin.',
    run: async function(session) {
      try { await init(); } 
      catch (e) { throw new Error('Python failed to start: ' + e.message); }
      
      session.mode = 'python'; 
      session.replBuffer = []; 
      session.promptPrefix = '>>> '; 
      session.updatePrompt();
      
      const cap = document.getElementById('capture');
      if (cap) { cap.disabled = false; cap.focus(); }
    },
    commands: {
      __PYTHON_EVAL__: async function (buf) { await runBuffer(this, buf); },
      __PYTHON_ABORT__: function () {
        if (abortFn) abortFn();
        terminate();
        this.replBuffer = []; this.mode = 'shell'; this.promptPrefix = ''; this.executing = false;
        this.updatePrompt();
        this.printSystem('Interrupted. Python engine restarted.');
        init().catch(() => {});
      }
    },
    runners: {
      '.py': async function (filename, content) { 
        await init(); 
        this.printSystem('Running ' + filename + '...');
        await runBuffer(this, [content]); 
      }
    }
  });
})();