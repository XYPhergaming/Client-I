(function () {
  'use strict';
  const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
  let worker = null, ready = null, abortFn = null, blobUrl = null;

  function makeWorker() {
    const code = `
      let pyodide;
      self.requestInput = (p) => self.postMessage({ type: 'input_request', prompt: p });
      self.onmessage = async (e) => {
        const { id, type, code, input, pkg } = e.data;
        if (type === 'init') {
          try {
            self.importScripts('${PYODIDE_CDN}');
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
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id == 'input' and isinstance(node.ctx, ast.Store):
                return src
        t = _T().visit(tree)
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
        } else if (type === 'pip') {
          try {
            await pyodide.loadPackage('micropip');
            const mp = pyodide.pyimport('micropip');
            try { await mp.install(pkg); } finally { mp.destroy(); }
            self.postMessage({ id, type: 'pip_done' });
          } catch (err) {
            self.postMessage({ id, type: 'pip_error', error: err.message });
          }
        } else if (type === 'run') {
          try {
            const transformFn = pyodide.globals.get('transform');
            let res;
            try { res = await pyodide.runPythonAsync(transformFn(code)); }
            finally { transformFn.destroy(); }
            if (res !== undefined && res !== null) {
              const b = pyodide.pyimport('builtins');
              let r;
              try { r = b.repr(res); }
              finally {
                b.destroy();
                if (res && typeof res.destroy === 'function') { try { res.destroy(); } catch (_) {} }
              }
              if (r !== 'None') self.postMessage({ type: 'stdout', text: r });
            }
            self.postMessage({ id, type: 'run_done' });
          } catch (err) {
            self.postMessage({ id, type: 'stderr', text: err.message });
            self.postMessage({ id, type: 'run_done' });
          }
        } else if (type === 'complete') {
          let ok = true;
          try {
            const isCompleteFn = pyodide.globals.get('is_complete');
            try { ok = isCompleteFn(code); } finally { isCompleteFn.destroy(); }
          } catch (e) {}
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
    const cap = session.cap;
    cap.disabled = true;

    await new Promise(res => {
      const id = 'r' + Math.random().toString(36).slice(2);
      const h = e => {
        const d = e.data;
        if (d.type === 'stdout') session.printSystem(Terminal.Utils.truncate(d.text));
        else if (d.type === 'stderr') session.printError(d.text);
        else if (d.type === 'input_request') {
          session.promptPrefix = d.prompt;
          session.updatePrompt();
          session._inputResolver = v => worker.postMessage({ type: 'input', input: v });
          cap.disabled = false; cap.focus();
        } else if (d.id === id && d.type === 'run_done') {
          worker.removeEventListener('message', h);
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
    cap.disabled = false;
    cap.focus();
  }

  Terminal.registerExtension({
    name: 'python',
    info: 'Python Package installed successfully! Use RUN{python} or RUNX{python} to begin.',
    commands: {
      PYTHON: async function () {
        try { await init(); }
        catch (e) { throw new Error('Python failed to start: ' + e.message); }
        this.mode = 'python'; this.replBuffer = []; this.promptPrefix = '>>> '; this.updatePrompt();
      },
      PIP: async function (arg) {
        const pkg = arg.trim();
        if (!pkg) throw new Error('Usage: PIP <package>');
        await Terminal.commands['__PYTHON_PIP__'].call(this, pkg);
      },
      __PYTHON_PIP__: async function (pkg) {
        await init();
        await new Promise((res, rej) => {
          const id = 'p' + Math.random().toString(36).slice(2);
          const h = e => {
            if (e.data.id === id && e.data.type === 'pip_done') { worker.removeEventListener('message', h); res(); }
            else if (e.data.id === id && e.data.type === 'pip_error') { worker.removeEventListener('message', h); rej(new Error(e.data.error)); }
          };
          worker.addEventListener('message', h);
          worker.postMessage({ id, type: 'pip', pkg });
        });
        this.printSuccess('Installed pip:' + pkg);
      }
    },
    runners: {
      '.py': async function (filename, content) { await init(); await runBuffer(this, [content]); },
      '.pyw': async function (filename, content) { await init(); await runBuffer(this, [content]); }
    },
    modes: {
      python: {
        async onInput(session, input) {
          if (session._inputResolver) {
            const resolver = session._inputResolver;
            session._inputResolver = null;
            session.print(session.promptEl.innerHTML + Terminal.Utils.escapeHTML(input), true);
            session.promptPrefix = '>>> ';
            session.updatePrompt();
            session.cap.disabled = true;
            session.cap.value = '';
            session.updateLine();
            resolver(input);
            return;
          }
          session.print(session.promptEl.innerHTML + Terminal.Utils.escapeHTML(input), true);
          const trimmed = input.trim();
          const up = trimmed.toUpperCase();
          if (['EXIT','EXIT()','QUIT','QUIT()','EXIT(0)'].includes(up)) {
            if (session.opts && session.opts.scope === 'pkg') {
              session.closeWindow();
              return;
            }
            session.mode = 'shell';
            session.replBuffer = [];
            session.promptPrefix = '';
            session.updatePrompt();
            return;
          }
          session.replBuffer.push(input);
          try { await runBuffer(session, session.replBuffer); }
          catch (e) { session.printError(String(e.message || e).toUpperCase()); }
        },
        onAbort(session) {
          if (abortFn) abortFn();
          terminate();
          session._inputResolver = null;
          session.mode = 'shell';
          session.replBuffer = [];
          session.promptPrefix = '';
          session.executing = false;
          session.updatePrompt();
          session.cap.disabled = false;
          session.cap.focus();
          session.printSystem('Interrupted. Python engine restarted.');
          init().catch(() => {});
        }
      }
    }
  });
})();