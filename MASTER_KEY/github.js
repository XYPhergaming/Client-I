(function () {
  'use strict';
  const T = Terminal;
  const KEY_UN = 'wt_gh_username';
  const KEY_AT = 'wt_gh_token';
  const KEY_REPO = 'wt_gh_active_repo';

  function getUN() { return localStorage.getItem(KEY_UN) || ''; }
  function getAT() { return localStorage.getItem(KEY_AT) || ''; }
  function getRepo() { return localStorage.getItem(KEY_REPO) || ''; }
  function setRepo(r) { localStorage.setItem(KEY_REPO, r); }

  function strip(s) { return String(s || '').trim().replace(/^\{([^{}]*)\}$/, '$1').trim(); }
  function parseKv(str) {
    str = String(str || '').replace(/^\{|\}$/g, '').trim();
    const out = {};
    for (const pair of str.split(':')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      out[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim();
    }
    return out;
  }
  function b64enc(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64dec(s) {
    const bin = atob(String(s).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function gh(session, endpoint, options = {}) {
    const at = getAT();
    if (!at) { session.printError('NOT AUTHENTICATED'); return null; }
    const headers = {
      'Authorization': `Bearer ${at}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(`https://api.github.com${endpoint}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      if (res.status === 204) return { ok: true };
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (options.method === 'GET' && e.message === 'Not Found') return null;
      session.printError('API: ' + e.message);
      return null;
    }
  }

  async function cmdAuth(session, arg) {
    const kv = parseKv(arg);
    const un = kv.un || kv.username;
    const at = kv.at || kv.token;
    if (!un || !at) { session.printError('COLLECTION FAIL'); return; }
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${at}`, 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) { session.printError('COLLECTION FAIL'); return; }
      const data = await res.json();
      if (String(data.login || '').toLowerCase() !== un.toLowerCase()) { session.printError('COLLECTION FAIL'); return; }
      localStorage.setItem(KEY_UN, un);
      localStorage.setItem(KEY_AT, at);
      session.printSuccess('COLLECTION SUCCESSFUL');
    } catch (e) { session.printError('COLLECTION FAIL'); }
  }

  async function cmdUser(session) {
    const u = await gh(session, '/user');
    if (!u) return;
    session.printSystem(`Name: ${u.name || u.login}`);
    session.printSystem(`Username: ${u.login}`);
    session.printSystem(`Public Repos: ${u.public_repos}`);
    session.printSystem(`Followers: ${u.followers}`);
    session.printSystem(`Following: ${u.following}`);
    session.printSystem(`Bio: ${u.bio || 'N/A'}`);
    session.printSystem(`Company: ${u.company || 'N/A'}`);
    session.printSystem(`Location: ${u.location || 'N/A'}`);
    session.printSystem(`Created: ${u.created_at || 'N/A'}`);
  }

  async function cmdRepos(session, arg) {
    const name = strip(arg);
    const un = getUN();
    if (!un) throw new Error('NOT AUTHENTICATED');
    if (!name) {
      const repos = await gh(session, '/user/repos?per_page=100&sort=updated');
      if (!repos) return;
      session.printSystem(`[REPOS for ${un}]`);
      for (const r of repos) session.printSystem(`  ${r.name} (${r.private ? 'PRIVATE' : 'PUBLIC'})`);
      return;
    }
    const r = await gh(session, `/repos/${un}/${name}`);
    if (!r) return;
    setRepo(name);
    session.printSuccess(`SELECTED: ${un}/${name}`);
  }

  async function cloneRepo(session, owner, repo) {
    session.printSystem(`Cloning ${owner}/${repo}...`);
    const info = await gh(session, `/repos/${owner}/${repo}`);
    if (!info) return;
    const branch = info.default_branch || 'main';
    const tree = await gh(session, `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    if (!tree || !tree.tree) return;
    let count = 0, skipped = 0;
    for (const item of tree.tree) {
      if (item.type !== 'blob') continue;
      const filePath = '/' + item.path;
      const parts = item.path.split('/'); parts.pop();
      let cur = '';
      for (const p of parts) {
        cur += '/' + p;
        if (!(await T.Storage.get(cur, 'vfs'))) await T.Storage.set(cur, { type: 'dir' }, 'vfs');
      }
      const content = await gh(session, `/repos/${owner}/${repo}/contents/${item.path}`);
      if (content && content.content) {
        const text = b64dec(content.content);
        const scan = T.SecurityScanner.scan(item.path, text);
        if (!scan.safe) { session.printError('SKIPPED ' + item.path + ': ' + scan.reason); skipped++; continue; }
        await T.Storage.set(filePath, { type: 'file', content: text }, 'vfs');
        count++;
      }
    }
    session.printSuccess(`CLONED: ${count} files${skipped ? ` (${skipped} blocked)` : ''}`);
  }

  async function cmdRepo(session, arg) {
    const v = strip(arg);
    if (!v) { setRepo(''); session.printSuccess('DESELECTED'); return; }
    if (/^https?:\/\//i.test(v)) {
      const m = v.match(/github\.com\/([^\/]+)\/([^\/\.]+)/i);
      if (!m) throw new Error('INVALID GITHUB URL');
      await cloneRepo(session, m[1], m[2]);
    } else {
      const un = getUN();
      if (!un) throw new Error('NOT AUTHENTICATED');
      const r = await gh(session, `/repos/${un}/${v}`);
      if (!r) return;
      setRepo(v);
      session.printSuccess(`SELECTED: ${un}/${v}`);
    }
  }

  async function cmdCreRepo(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: cre_repo{name}');
    const r = await gh(session, '/user/repos', { method: 'POST', body: { name, private: false, auto_init: true } });
    if (r) session.printSuccess(`CREATED: ${r.full_name}`);
  }
  async function cmdDelRepo(session, arg) {
    const raw = strip(arg);
    if (!raw) throw new Error('Usage: del_repo{repo_name}');
    const un = getUN();
    const target = raw.includes('/') ? raw : `${un}/${raw}`;
    const res = await gh(session, `/repos/${target}`, { method: 'DELETE' });
    if (res) {
      if (getRepo() === raw || getRepo() === target.split('/')[1]) localStorage.removeItem(KEY_REPO);
      session.printSuccess(`DELETED: ${target}`);
    }
  }

  async function printTree(session, owner, repo, path, prefix) {
    const contents = await gh(session, `/repos/${owner}/${repo}/contents${path ? '/' + path : ''}`);
    if (!Array.isArray(contents)) return;
    contents.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    for (let i = 0; i < contents.length; i++) {
      const c = contents[i];
      const isLast = i === contents.length - 1;
      session.printSystem(prefix + (isLast ? '└── ' : '├── ') + c.name + (c.type === 'dir' ? '/' : ''));
      if (c.type === 'dir') await printTree(session, owner, repo, c.path, prefix + (isLast ? '    ' : '│   '));
    }
  }
  async function cmdFiles(session) {
    const repo = getRepo();
    if (!repo) throw new Error('NO ACTIVE REPO');
    const un = getUN();
    session.printSystem(`${un}/${repo}/`);
    await printTree(session, un, repo, '', '');
  }

  async function cmdEdit(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: edit{file}');
    const repo = getRepo(); if (!repo) throw new Error('NO ACTIVE REPO');
    const un = getUN();
    const data = await gh(session, `/repos/${un}/${repo}/contents/${name}`);
    if (!data || !data.content) return;
    const text = b64dec(data.content);
    const sha = data.sha;
    await new Promise(resolve => {
      const ov = document.getElementById('editor');
      const ta = document.getElementById('editor-text');
      const nameInput = document.getElementById('editor-name');
      nameInput.value = name;
      ov.style.zIndex = '9999';
      ov.classList.remove('hidden');
      ta.value = text;
      ta.focus();
      const cl = document.getElementById('editor-close');
      const sv = document.getElementById('editor-save');
      const cleanup = () => { ov.classList.add('hidden'); ov.style.zIndex = ''; cl.onclick = null; sv.onclick = null; document.getElementById('capture').focus(); resolve(); };
      cl.onclick = () => cleanup();
      sv.onclick = async () => {
        try {
          await gh(session, `/repos/${un}/${repo}/contents/${name}`, {
            method: 'PUT',
            body: { message: `Update ${name}`, content: b64enc(ta.value), sha }
          });
          session.printSuccess(`UPDATED: ${name}`);
        } catch (e) { session.printError(e.message); }
        cleanup();
      };
    });
  }

  async function cmdCreFile(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: cre filename');
    const repo = getRepo(); if (!repo) throw new Error('NO ACTIVE REPO');
    const un = getUN();
    await new Promise(resolve => {
      const ov = document.getElementById('editor');
      const ta = document.getElementById('editor-text');
      const nameInput = document.getElementById('editor-name');
      nameInput.value = name;
      ov.style.zIndex = '9999';
      ov.classList.remove('hidden');
      ta.value = '';
      ta.focus();
      const cl = document.getElementById('editor-close');
      const sv = document.getElementById('editor-save');
      const cleanup = () => { ov.classList.add('hidden'); ov.style.zIndex = ''; cl.onclick = null; sv.onclick = null; document.getElementById('capture').focus(); resolve(); };
      cl.onclick = () => cleanup();
      sv.onclick = async () => {
        try {
          await gh(session, `/repos/${un}/${repo}/contents/${name}`, {
            method: 'PUT',
            body: { message: `Create ${name}`, content: b64enc(ta.value) }
          });
          session.printSuccess(`CREATED: ${name}`);
        } catch (e) { session.printError(e.message); }
        cleanup();
      };
    });
  }

  async function cmdCreateDir(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: create folder');
    const repo = getRepo(); if (!repo) throw new Error('NO ACTIVE REPO');
    const un = getUN();
    const path = `${name}/.gitkeep`;
    const res = await gh(session, `/repos/${un}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: { message: `Create folder ${name}`, content: b64enc('') }
    });
    if (res) session.printSuccess(`CREATED FOLDER: ${name}`);
  }

  async function deletePath(session, owner, repo, path, sha) {
    return gh(session, `/repos/${owner}/${repo}/contents/${path}`, { method: 'DELETE', body: { message: `Delete ${path}`, sha } });
  }

  async function cmdDel(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: del(filename) / del(folder) / del(*)');
    const repo = getRepo(); if (!repo) throw new Error('NO ACTIVE REPO');
    const un = getUN();
    if (name === '*') {
      const contents = await gh(session, `/repos/${un}/${repo}/contents/`);
      if (!Array.isArray(contents)) return;
      let count = 0;
      for (const item of contents) {
        if (item.type === 'dir') {
          const sub = await gh(session, `/repos/${un}/${repo}/contents/${item.path}`);
          if (Array.isArray(sub)) for (const s of sub) { await deletePath(session, un, repo, s.path, s.sha); count++; }
        } else { await deletePath(session, un, repo, item.path, item.sha); count++; }
      }
      session.printSuccess(`DELETED: ${count} items`);
      return;
    }
    const content = await gh(session, `/repos/${un}/${repo}/contents/${name}`);
    if (!content) return;
    if (Array.isArray(content)) {
      let count = 0;
      for (const item of content) { await deletePath(session, un, repo, item.path, item.sha); count++; }
      session.printSuccess(`DELETED FOLDER: ${name} (${count} files)`);
    } else {
      await deletePath(session, un, repo, name, content.sha);
      session.printSuccess(`DELETED: ${name}`);
    }
  }

  async function cmdZip(session, arg) {
    const name = strip(arg);
    if (!name) throw new Error('Usage: zip{file.zip}');
    const repo = getRepo(); if (!repo) throw new Error('NO ACTIVE REPO');
    const entry = await T.Storage.get(T.Utils.resolvePath(session.cwd, name), 'vfs');
    if (!entry || entry.type !== 'file') throw new Error('NOT EXIST: ' + name);
    if (!window.JSZip) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = res; s.onerror = () => rej(new Error('JSZip load failed'));
        document.head.appendChild(s);
      });
    }
    const zip = await window.JSZip.loadAsync(entry.content);
    const un = getUN();
    let count = 0, skipped = 0;
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const content = await file.async('string');
      const scan = T.SecurityScanner.scan(path, content);
      if (!scan.safe) { session.printError('SKIPPED ' + path + ': ' + scan.reason); skipped++; continue; }

      // Check if file already exists to get its SHA
      let sha = undefined;
      const existing = await gh(session, `/repos/${un}/${repo}/contents/${path}`);
      if (existing && existing.sha) sha = existing.sha;

      const body = { message: `Extract ${path}`, content: b64enc(content) };
      if (sha) body.sha = sha;

      const res = await gh(session, `/repos/${un}/${repo}/contents/${path}`, {
        method: 'PUT',
        body
      });
      if (res) count++;
    }
    session.printSuccess(`EXTRACTED: ${count} files${skipped ? ` (${skipped} blocked)` : ''}`);
  }

  T.registerExtension({
    name: 'github',
    info: 'GitHub master key loaded.',
    descriptions: {
      AUTH: 'Authenticate (auth{un=user:at=token})',
      USER: 'Profile',
      REPOS: 'List/select repos',
      REPO: 'Select or clone',
      CRE_REPO: 'Create repo',
      DEL_REPO: 'Delete repo',
      FILES: 'Show repo tree',
      EDIT: 'Edit file',
      CRE: 'Create file',
      CREATE: 'Create folder',
      DEL: 'Delete file/folder',
      ZIP: 'Extract zip'
    },
    commands: {
      AUTH: function(arg) { return cmdAuth(this, arg); },
      USER: function() { return cmdUser(this); },
      REPOS: function(arg) { return cmdRepos(this, arg); },
      REPO: function(arg) { return cmdRepo(this, arg); },
      CRE_REPO: function(arg) { return cmdCreRepo(this, arg); },
      DEL_REPO: function(arg) { return cmdDelRepo(this, arg); },
      FILES: function() { return cmdFiles(this); },
      TREE: function() { return cmdFiles(this); },
      EDIT: function(arg) { return cmdEdit(this, arg); },
      CRE: function(arg) { return cmdCreFile(this, arg); },
      CREATE: function(arg) { return cmdCreateDir(this, arg); },
      DEL: function(arg) { return cmdDel(this, arg); },
      ZIP: function(arg) { return cmdZip(this, arg); }
    }
  });
})();