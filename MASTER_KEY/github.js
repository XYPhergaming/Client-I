(function () {
  'use strict';
  const T = Terminal;

  // টোকেন ও ডিফল্ট ইউজার/রিপো মনে রাখার জন্য লোকাল স্টোরেজ
  function getToken() { return localStorage.getItem('wt_gh_token'); }
  function setToken(token) { localStorage.setItem('wt_gh_token', token); }
  function getDefaultRepo() { return localStorage.getItem('wt_gh_repo'); }
  function setDefaultRepo(repo) { localStorage.setItem('wt_gh_repo', repo); }

  // গিটহাব এপিআই কল করার জন্য হেল্পার ফাংশন
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
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      return data;
    } catch (e) {
      session.printError(`GitHub API Error: ${e.message}`);
      return null;
    }
  }

  // ============================================================
  // মূল কমান্ড হ্যান্ডলার
  // ============================================================
  async function handleGithubCmd(session, cmd, arg) {
    const token = getToken();
    const defaultRepo = getDefaultRepo();

    // ১. অথেন্টিকেশন (Authentication)
    if (cmd === 'AUTH') {
      if (!arg) { session.printError('Usage: github.auth{<your_personal_access_token>}'); return; }
      setToken(arg.trim());
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

    // ২. রিপোজিটরি ম্যানেজমেন্ট (Repository Management)
    if (cmd === 'REPOS') {
      const repos = await ghFetch(session, '/user/repos?per_page=100&sort=updated');
      if (repos) {
        session.printSystem('Your Repositories:');
        repos.forEach(r => session.printSystem(`  ${r.full_name} (${r.private ? 'Private' : 'Public'})`));
      }
      return;
    }

    if (cmd === 'REPO') {
      if (!arg) { session.printError('Usage: github.repo{<owner>/<repo>}'); return; }
      setDefaultRepo(arg.trim());
      const repo = await ghFetch(session, `/repos/${arg.trim()}`);
      if (repo) {
        session.printSystem(`Repo: ${repo.full_name}`);
        session.printSystem(`Description: ${repo.description || 'N/A'}`);
        session.printSystem(`Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count}`);
        session.printSystem(`Language: ${repo.language}`);
        session.printSystem(`Default Branch: ${repo.default_branch}`);
      }
      return;
    }

    if (cmd === 'CREATE_REPO') {
      if (!arg) { session.printError('Usage: github.create_repo{<repo_name>}'); return; }
      const repo = await ghFetch(session, '/user/repos', 'POST', { name: arg.trim(), private: false });
      if (repo) session.printSuccess(`Repository created: ${repo.full_name}`);
      return;
    }

    if (cmd === 'DELETE_REPO') {
      if (!arg) { session.printError('Usage: github.delete_repo{<owner>/<repo>}'); return; }
      await ghFetch(session, `/repos/${arg.trim()}`, 'DELETE');
      session.printSuccess(`Repository deleted: ${arg.trim()}`);
      return;
    }

    // ৩. ফাইল অপারেশন (File Operations)
    // ফাইল দেখার জন্য প্রথমে রিপো সেট করা থাকতে হবে
    if (['FILES', 'FILE', 'CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'].includes(cmd)) {
      if (!defaultRepo) {
        session.printError('No repo selected. Use github.repo{<owner>/<repo>} first.');
        return;
      }
    }

    if (cmd === 'FILES') {
      const path = arg ? `/${arg.trim()}` : '';
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
      if (!arg) { session.printError('Usage: github.file{<path>}'); return; }
      const data = await ghFetch(session, `/repos/${defaultRepo}/contents/${arg.trim()}`);
      if (data && data.content) {
        // Base64 ডিকোড করে ফাইল দেখানো
        const content = atob(data.content);
        session.printSystem(`--- ${arg.trim()} ---`);
        session.print(content);
      }
      return;
    }

    if (cmd === 'CREATE_FILE' || cmd === 'UPDATE_FILE') {
      if (!arg) { session.printError(`Usage: github.${cmd.toLowerCase()}{<path>} <content>`); return; }
      const parts = arg.split(' ');
      const path = parts[0];
      const content = parts.slice(1).join(' ');
      if (!content) { session.printError('Content cannot be empty.'); return; }

      // আগে ফাইলটি আছে কিনা চেক করা (আপডেটের জন্য SHA দরকার)
      const existing = await ghFetch(session, `/repos/${defaultRepo}/contents/${path}`);
      const payload = {
        message: `Update ${path} via Browser Terminal`,
        content: btoa(content)
      };
      if (existing && existing.sha) payload.sha = existing.sha;

      const res = await ghFetch(session, `/repos/${defaultRepo}/contents/${path}`, 'PUT', payload);
      if (res) session.printSuccess(`File ${cmd === 'CREATE_FILE' ? 'created' : 'updated'}: ${path}`);
      return;
    }

    if (cmd === 'DELETE_FILE') {
      if (!arg) { session.printError('Usage: github.delete_file{<path>}'); return; }
      const existing = await ghFetch(session, `/repos/${defaultRepo}/contents/${arg.trim()}`);
      if (!existing || !existing.sha) { session.printError('File not found or no access.'); return; }
      
      const res = await ghFetch(session, `/repos/${defaultRepo}/contents/${arg.trim()}`, 'DELETE', {
        message: `Delete ${arg.trim()} via Browser Terminal`,
        sha: existing.sha
      });
      if (res) session.printSuccess(`File deleted: ${arg.trim()}`);
      return;
    }

    session.printError('Unknown GitHub command.');
  }

  // ============================================================
  // এক্সটেনশন রেজিস্ট্রেশন
  // ============================================================
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