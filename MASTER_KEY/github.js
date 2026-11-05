(function () {
  'use strict';
  const T = Terminal;

  // UTF-8 safe Base64 helpers (fixes non-ASCII file corruption)
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Strip a single-level {…} wrapper (e.g. "{owner/repo}" → "owner/repo")
  function stripBraces(s) {
    if (!s) return '';
    s = String(s).trim();
    const m = s.match(/^\{([^{}]*)\}$/);
    return m ? m[1] : s;
  }

  // Parse "{path} content" or "path content" → { path, content }
  function parsePathContent(s) {
    s = String(s || '').trim();
    const bm = s.match(/^\{([^{}]+)\}\s*([\s\S]*)$/);
    if (bm) return { path: bm[1].trim(), content: bm[2] };
    const idx = s.indexOf(' ');
    return {
      path: idx < 0 ? s : s.slice(0, idx).trim(),
      content: idx < 0 ? '' : s.slice(idx + 1)
    };
  }

  function getToken() { return localStorage.getItem('wt_gh_token'); }
  function setToken(token) { localStorage.setItem('wt_gh_token', token); }
  function getDefaultRepo() { return localStorage.getItem('wt_gh_repo'); }
  function setDefaultRepo(repo) { localStorage.setItem('wt_gh_repo', repo); }

  async function ghFetch(session, endpoint, method = 'GET', body = null) {
    const token = getToken();
    if (!token) {
      session.printError('GitHub Token not set. Use github.auth{<token>} first.');
      return null;
    }
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(`https://api.github.com${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
      });
      if (res.status === 204) return { success: true };
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      session.printError(`GitHub API Error: ${e.message}`);
      return null;
    }
  }

  async function handleGithubCmd(session, cmd, rawArg) {
    const token = getToken();
    const defaultRepo = getDefaultRepo();
    rawArg = rawArg || '';

    if (cmd === 'AUTH') {
      const tok = stripBraces(rawArg);
      if (!tok) { session.printError('Usage: github.auth{<your_personal_access_token>}'); return; }
      setToken(tok);
      session.printSuccess('GitHub Token saved successfully!');
      return;
    }

    if (cmd === 'WHOAMI') {
      const user = await ghFetch(session, '/user');
      if (user) {
        session.printSystem(`Username: ${user.login}`);
        session.printSystem(`Name: ${user.name || 'N/A'}`);
        session.printSystem(`Public Repos: ${user.public_repos}`);
        session.printSystem(`Followers: ${user.followers}`);
        session.printSystem(`Bio: ${user.bio || 'N/A'}`);
      }
      return;
    }

    if (cmd === 'REPOS') {
      const repos = await ghFetch(session, '/user/repos?per_page=100&sort=updated');
      if (repos) {
        session.printSystem('Your Repositories:');
        repos.forEach(r => session.printSystem(`  ${r.full_name} (${r.private ? 'Private' : 'Public'})`));
      }
      return;
    }

    if (cmd === 'REPO') {
      const repo = stripBraces(rawArg);
      if (!repo) { session.printError('Usage: github.repo{<owner>/<repo>}'); return; }
      setDefaultRepo(repo);
      const info = await ghFetch(session, `/repos/${repo}`);
      if (info) {
        session.printSystem(`Repo: ${info.full_name}`);
        session.printSystem(`Description: ${info.description || 'N/A'}`);
        session.printSystem(`Stars: ${info.stargazers_count} | Forks: ${info.forks_count}`);
        session.printSystem(`Language: ${info.language}`);
        session.printSystem(`Default Branch: ${info.default_branch}`);
      }
      return;
    }

    if (cmd === 'CREATE_REPO') {
      const name = stripBraces(rawArg);
      if (!name) { session.printError('Usage: github.create_repo{<repo_name>}'); return; }
      const repo = await ghFetch(session, '/user/repos', 'POST', { name, private: false });
      if (repo) session.printSuccess(`Repository created: ${repo.full_name}`);
      return;
    }

    if (cmd === 'DELETE_REPO') {
      const repo = stripBraces(rawArg);
      if (!repo) { session.printError('Usage: github.delete_repo{<owner>/<repo>}'); return; }
      await ghFetch(session, `/repos/${repo}`, 'DELETE');
      session.printSuccess(`Repository deleted: ${repo}`);
      return;
    }

    if (['FILES', 'FILE', 'CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'].includes(cmd)) {
      if (!defaultRepo) {
        session.printError('No repo selected. Use github.repo{<owner>/<repo>} first.');
        return;
      }
    }

    if (cmd === 'FILES') {
      const p = stripBraces(rawArg);
      const path = p ? `/${p}` : '';
      const contents = await ghFetch(session, `/repos/${defaultRepo}/contents${path}`);
      if (Array.isArray(contents)) {
        session.printSystem(`Contents of ${defaultRepo}${path || '/'}:`);
        contents.forEach(c => session.printSystem(`  [${c.type}] ${c.name}`));
      } else if (contents) {
        session.printError(`${path} is a file, not a directory.`);
      }
      return;
    }

    if (cmd === 'FILE') {
      const p = stripBraces(rawArg);
      if (!p) { session.printError('Usage: github.file{<path>}'); return; }
      const data = await ghFetch(session, `/repos/${defaultRepo}/contents/${p}`);
      if (data && data.content) {
        const content = base64ToUtf8(data.content.replace(/\s/g, ''));
        session.printSystem(`--- ${p} ---`);
        session.print(content);
      }
      return;
    }

    if (cmd === 'CREATE_FILE' || cmd === 'UPDATE_FILE') {
      const { path, content } = parsePathContent(rawArg);
      if (!path) { session.printError(`Usage: github.${cmd.toLowerCase()}{<path>} <content>`); return; }
      if (!content) { session.printError('Content cannot be empty.'); return; }

      const existing = await ghFetch(session, `/repos/${defaultRepo}/contents/${path}`);
      const payload = {
        message: `Update ${path} via Browser Terminal`,
        content: utf8ToBase64(content)
      };
      if (existing && existing.sha) payload.sha = existing.sha;

      const res = await ghFetch(session, `/repos/${defaultRepo}/contents/${path}`, 'PUT', payload);
      if (res) session.printSuccess(`File ${cmd === 'CREATE_FILE' ? 'created' : 'updated'}: ${path}`);
      return;
    }

    if (cmd === 'DELETE_FILE') {
      const p = stripBraces(rawArg);
      if (!p) { session.printError('Usage: github.delete_file{<path>}'); return; }
      const existing = await ghFetch(session, `/repos/${defaultRepo}/contents/${p}`);
      if (!existing || !existing.sha) { session.printError('File not found or no access.'); return; }
      const res = await ghFetch(session, `/repos/${defaultRepo}/contents/${p}`, 'DELETE', {
        message: `Delete ${p} via Browser Terminal`,
        sha: existing.sha
      });
      if (res) session.printSuccess(`File deleted: ${p}`);
      return;
    }

    session.printError('Unknown GitHub command.');
  }

  T.registerExtension({
    name: 'github',
    info: 'GitHub Master Key imported successfully! Manage your repos, files, and profile directly from the terminal.',
    commands: {
      GITHUB_AUTH: function(arg) { return handleGithubCmd(this, 'AUTH', arg); },
      GITHUB_WHOAMI: function() { return handleGithubCmd(this, 'WHOAMI'); },
      GITHUB_REPOS: function() { return handleGithubCmd(this, 'REPOS'); },
      GITHUB_REPO: function(arg) { return handleGithubCmd(this, 'REPO', arg); },
      GITHUB_CREATE_REPO: function(arg) { return handleGithubCmd(this, 'CREATE_REPO', arg); },
      GITHUB_DELETE_REPO: function(arg) { return handleGithubCmd(this, 'DELETE_REPO', arg); },
      GITHUB_FILES: function(arg) { return handleGithubCmd(this, 'FILES', arg); },
      GITHUB_FILE: function(arg) { return handleGithubCmd(this, 'FILE', arg); },
      GITHUB_CREATE_FILE: function(arg) { return handleGithubCmd(this, 'CREATE_FILE', arg); },
      GITHUB_UPDATE_FILE: function(arg) { return handleGithubCmd(this, 'UPDATE_FILE', arg); },
      GITHUB_DELETE_FILE: function(arg) { return handleGithubCmd(this, 'DELETE_FILE', arg); }
    }
  });
})();