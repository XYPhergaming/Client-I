(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

  const PEER_CONFIG = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    },
    debug: 0
  };

  let peerLibLoaded = false;

  async function loadPeerLib() {
    if (peerLibLoaded || window.Peer) { peerLibLoaded = true; return; }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PEER_CDN;
      script.onload = () => { peerLibLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load PeerJS library'));
      document.head.appendChild(script);
    });
  }

  // ============================================================
  // PER-SESSION STATE — each mini window owns its own room
  // ============================================================
  function getState(session) {
    if (!session._roomState) {
      session._roomState = {
        peer: null,
        conns: {},
        hostConn: null,
        isHost: false,
        roomId: null,
        myId: null,
        myName: null,
        users: {},
        pendingFiles: {},
        roomStartTime: null,
        userStartTime: null,
        migrationInProgress: false
      };
    }
    return session._roomState;
  }

  function resetState(state, session, silent) {
    if (session && !silent) {
      try { session.printSystem('Room disconnected.'); } catch(e) {}
    }
    if (state.peer) { try { state.peer.destroy(); } catch(e){} state.peer = null; }
    state.conns = {};
    state.hostConn = null;
    state.isHost = false;
    state.roomId = null;
    state.myId = null;
    state.myName = null;
    state.users = {};
    state.pendingFiles = {};
    state.roomStartTime = null;
    state.userStartTime = null;
    state.migrationInProgress = false;
  }

  // ---------- ROOM ENTRY ----------
  async function handleRoom(session, roomId) {
    const state = getState(session);

    // Already in this room? Don't recreate.
    if (state.peer && state.roomId === roomId) {
      session.printSystem(`Already in room ${roomId}. Use room.exit first to rejoin.`);
      return;
    }

    // In a different room? Gracefully leave first.
    if (state.peer) {
      if (state.isHost) {
        for (const conn of Object.values(state.conns)) {
          try { if (conn.open) conn.send({ type: 'host_leaving' }); } catch(e){}
        }
      }
      resetState(state, session, true);
    }

    await loadPeerLib();
    state.roomId = roomId;
    state.myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);

    let p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    let handled = false;

    p.on('open', () => {
      if (handled) return;
      handled = true;
      state.peer = p;
      startHost(session, roomId, p);
    });

    p.on('error', (err) => {
      if (handled) return;
      if (err.type === 'unavailable-id') {
        handled = true;
        try { p.destroy(); } catch(e){}
        state.peer = null;
        connectAsClient(session, roomId, 3).then(ok => {
          if (!ok) session.printError('Could not join room. Try again.');
        });
      } else if (err.type === 'peer-unavailable' || err.type === 'network') {
        // transient — ignore
      } else {
        handled = true;
        session.printError('Connection Error: ' + err.message);
        resetState(state, session);
      }
    });
  }

  // ---------- HOST ----------
  function startHost(session, roomId, hostPeer) {
    const state = getState(session);
    state.peer = hostPeer;
    state.isHost = true;
    state.roomStartTime = state.roomStartTime || Date.now();
    state.userStartTime = Date.now();
    state.myId = '01';
    state.users = { [state.myId]: state.myName };
    state.conns = {};
    state.hostConn = null;
    session.printSuccess(`Room ${roomId} active. You are host (01/${state.myName}).`);
    updateTitle(session);

    hostPeer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'join') {
          let newId = null;
          for (let i = 2; i <= 99; i++) {
            const idStr = i.toString().padStart(2, '0');
            if (!state.users[idStr]) { newId = idStr; break; }
          }
          if (!newId) { conn.send({ type: 'error', message: 'Room is full' }); conn.close(); return; }
          state.users[newId] = data.name;
          state.conns[newId] = conn;
          conn.send({ type: 'joined', id: newId, users: state.users, roomStartTime: state.roomStartTime });
          broadcast(session, { type: 'system', text: `${newId}/${data.name} joined the room.` });
          broadcast(session, { type: 'userlist', users: state.users });
        } else if (data.type === 'chat') {
          broadcast(session, data);
        } else if (data.type === 'file_offer') {
          const scan = T.SecurityScanner.scan(data.filename, data.content);
          if (!scan.safe) {
            session.printError(`Relay blocked ${data.filename}: ${scan.reason}`);
            conn.send({ type: 'error', message: `BLOCKED ${data.filename}: ${scan.reason}` });
            return;
          }
          broadcast(session, data);
        } else if (data.type === 'host_leaving') {
          beginMigration(session, roomId);
        }
      });
      conn.on('close', () => {
        for (const [id, c] of Object.entries(state.conns)) {
          if (c === conn) {
            const name = state.users[id];
            delete state.users[id];
            delete state.conns[id];
            broadcast(session, { type: 'system', text: `${id}/${name} left.` });
            broadcast(session, { type: 'userlist', users: state.users });
            break;
          }
        }
      });
    });

    hostPeer.on('error', (err) => {
      if (err.type === 'peer-unavailable' || err.type === 'network') return;
      session.printError('Host Error: ' + err.message);
    });
  }

  // ---------- CLIENT ----------
  async function connectAsClient(session, roomId, retries = 3) {
    const state = getState(session);
    for (let i = 0; i < retries; i++) {
      if (i > 0) session.printSystem(`Retry ${i+1}/${retries}...`);
      let cp = null;
      try {
        cp = new Peer(PEER_CONFIG);
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('peer open timeout')), 10000);
          cp.on('open', () => { clearTimeout(t); res(); });
          cp.on('error', (e) => { clearTimeout(t); rej(e); });
        });
        const hc = cp.connect('KALMA-ROOM-' + roomId);
        const joined = await new Promise((res) => {
          const t = setTimeout(() => res(null), 10000);
          hc.on('open', () => hc.send({ type: 'join', name: state.myName }));
          hc.on('data', (data) => { if (data.type === 'joined') { clearTimeout(t); res(data); } });
          hc.on('error', () => { clearTimeout(t); res(null); });
        });
        if (!joined) {
          try { hc.close(); } catch(e){}
          try { cp.destroy(); } catch(e){}
          cp = null;
          await new Promise(r => setTimeout(r, 800 * (i + 1)));
          continue;
        }
        state.peer = cp;
        state.hostConn = hc;
        state.isHost = false;
        state.myId = joined.id;
        state.users = joined.users;
        state.roomStartTime = joined.roomStartTime || Date.now();
        state.userStartTime = Date.now();
        session.printSuccess(`Joined room ${roomId} as ${state.myId}/${state.myName}.`);
        updateTitle(session);
        session.printSystem(`Users: ${Object.keys(state.users).length}:[${Object.entries(state.users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);

        hc.on('data', (data) => {
          if (data.type === 'userlist') state.users = data.users;
          handleIncoming(session, data);
        });
        hc.on('close', () => {
          if (state.migrationInProgress) return;
          session.printSystem('Host left. Others are still in the room — trying to keep it alive...');
          beginMigration(session, roomId);
        });
        return true;
      } catch (e) {
        if (cp) { try { cp.destroy(); } catch(x){} }
        await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    return false;
  }

  // ---------- MIGRATION ----------
  async function beginMigration(session, roomId) {
    const state = getState(session);
    if (state.migrationInProgress) return;
    state.migrationInProgress = true;

    const savedMyName = state.myName;
    const savedRoomStart = state.roomStartTime || Date.now();
    const savedUserStart = state.userStartTime || Date.now();

    if (state.peer) { try { state.peer.destroy(); } catch(e){} state.peer = null; }
    if (state.hostConn) { try { state.hostConn.close(); } catch(e){} state.hostConn = null; }
    state.conns = {};
    state.isHost = false;

    const delay = 1500 + Math.floor(Math.random() * 2000);
    await new Promise(r => setTimeout(r, delay));

    let p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    const result = await new Promise((res) => {
      const t = setTimeout(() => res('timeout'), 10000);
      p.on('open', () => { clearTimeout(t); res('open'); });
      p.on('error', (e) => {
        clearTimeout(t);
        res(e.type === 'unavailable-id' ? 'taken' : 'error');
      });
    });

    if (result === 'open') {
      state.peer = p;
      state.isHost = true;
      state.myId = '01';
      state.myName = savedMyName;
      state.users = { [state.myId]: state.myName };
      state.roomStartTime = savedRoomStart;
      state.userStartTime = savedUserStart;
      session.printSuccess('You are now the new host of the room.');
      updateTitle(session);
      startHost(session, roomId, p);
      state.migrationInProgress = false;
      return;
    }

    try { p.destroy(); } catch(e){}
    if (result === 'taken') {
      session.printSystem('Another user took over. Reconnecting as client...');
      const ok = await connectAsClient(session, roomId, 3);
      if (ok) { state.migrationInProgress = false; return; }
    }

    session.printError('Room could not be restored. Disconnecting.');
    resetState(state, session, true);
  }

  function broadcast(session, data) {
    const state = getState(session);
    if (state.isHost) {
      handleIncoming(session, data);
      for (const conn of Object.values(state.conns)) if (conn.open) conn.send(data);
    } else if (state.hostConn && state.hostConn.open) {
      state.hostConn.send(data);
    }
  }
  function relay(session, data) {
    const state = getState(session);
    if (state.isHost) { for (const conn of Object.values(state.conns)) if (conn.open) conn.send(data); }
    else if (state.hostConn && state.hostConn.open) state.hostConn.send(data);
  }

  function updateTitle(session) {
    const state = getState(session);
    if (session.wrapper) {
      const s = session.wrapper.querySelector('.mini-header span');
      if (s) s.textContent = `room | ${state.roomId || 'None'} | ${state.myId || ''}/${state.myName || ''}`;
    }
  }

  function handleIncoming(session, data) {
    const state = getState(session);
    if (data.type === 'chat') {
      if (data.senderId === state.myId) return;
      session.printChat(`[${data.senderId}/${data.senderName}]: ${data.text}`, 'right');
    } else if (data.type === 'system') {
      session.printSystem(data.text);
    } else if (data.type === 'userlist') {
      const list = Object.entries(data.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
      session.printSystem(`Users: ${Object.keys(data.users).length}:[${list}]`);
    } else if (data.type === 'file_offer') {
      if (data.senderId === state.myId) return;
      const scan = T.SecurityScanner.scan(data.filename, data.content);
      if (!scan.safe) { session.printError(`Blocked ${data.filename}: ${scan.reason}`); return; }
      const base = T.Utils.basename(data.filename);
      state.pendingFiles[base] = data.content;
      session.printChat(`[${data.senderId}/${data.senderName}]: Export ${base}`, 'right');
    }
  }

  // ---------- COMMANDS ----------
  async function cmdRoom(session, roomId) {
    roomId = String(roomId || '').replace(/^\{|\}$/g, '').trim();
    if (!roomId) throw new Error('Usage: room{roomId}');
    await handleRoom(session, roomId);
  }

  function cmdMsg(session, text) {
    const state = getState(session);
    if (!state.roomId) throw new Error('NOT IN ROOM');
    session.printChat(`[${state.myId}/${state.myName}]: ${text}`, 'left');
    relay(session, { type: 'chat', senderId: state.myId, senderName: state.myName, text });
  }

  function cmdUsers(session) {
    const state = getState(session);
    if (!state.roomId) throw new Error('NOT IN ROOM');
    const list = Object.entries(state.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
    session.printSystem(`Users: ${Object.keys(state.users).length}:[${list}]`);
  }

  async function cmdExport(session, filename) {
    const state = getState(session);
    if (!state.roomId) throw new Error('NOT IN ROOM');
    filename = String(filename || '').replace(/^\{|\}$/g, '').replace(/^\/+/, '').trim();
    if (!filename) throw new Error('Usage: ex <filename>');
    const base = T.Utils.basename(filename);
    if (!base) throw new Error('INVALID FILENAME');
    const target = T.Utils.resolvePath(session.cwd, filename);
    const file = await T.Storage.get(target, 'vfs');
    if (!file || file.type !== 'file') throw new Error('File not found: ' + filename);
    const scan = T.SecurityScanner.scan(base, file.content);
    if (!scan.safe) { session.printError('BLOCKED AT SEND: ' + scan.reason); return; }
    session.printChat(`[${state.myId}/${state.myName}]: Export ${base}`, 'left');
    relay(session, { type: 'file_offer', filename: base, content: file.content, senderId: state.myId, senderName: state.myName });
  }

  async function cmdImport(session, filename) {
    const state = getState(session);
    if (!state.roomId) throw new Error('NOT IN ROOM');
    const clean = String(filename || '').replace(/[{}]/g, '').replace(/^\/+/, '').trim();
    if (!clean) throw new Error('Usage: im <filename>');
    const base = T.Utils.basename(clean);
    if (!base) throw new Error('INVALID FILENAME');
    let matchedKey = null;
    for (const k of Object.keys(state.pendingFiles)) {
      if (k.toLowerCase() === base.toLowerCase()) { matchedKey = k; break; }
    }
    if (!matchedKey) throw new Error('No pending file named ' + base);
    const content = state.pendingFiles[matchedKey];
    const scan = T.SecurityScanner.scan(base, content);
    if (!scan.safe) { session.printError('BLOCKED AT IMPORT: ' + scan.reason); return; }
    const roomDir = T.Utils.resolvePath(session.cwd, 'room');
    const roomEntry = await T.Storage.get(roomDir, 'vfs');
    if (!roomEntry || roomEntry.type !== 'dir') {
      await T.Storage.set(roomDir, { type: 'dir' }, 'vfs');
    }
    const target = T.Utils.resolvePath(roomDir, base);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    session.printSuccess(`Saved: room/${base}`);
  }

  function cmdUptime(session) {
    const state = getState(session);
    if (!state.roomId) {
      const sec = Math.floor(performance.now() / 1000);
      session.printSystem('Uptime: ' + Math.floor(sec/60) + 'm ' + (sec%60) + 's');
      return;
    }
    const fmt = (ms) => { const s=Math.floor(ms/1000); return `${Math.floor(s/3600)}H ${Math.floor((s%3600)/60)}M ${s%60}S`; };
    session.printSystem(`Room Uptime: ${fmt(Date.now()-state.roomStartTime)} | You: ${fmt(Date.now()-state.userStartTime)}`);
  }

  function cmdLeave(session) {
    const state = getState(session);
    if (!state.roomId) throw new Error('NOT IN ROOM');
    if (state.isHost) {
      for (const conn of Object.values(state.conns)) {
        try { if (conn.open) conn.send({ type: 'host_leaving' }); } catch(e){}
      }
    }
    resetState(state, session);
  }

  function cmdStatus(session) {
    const state = getState(session);
    if (!state.roomId) { session.printSystem('Room: None'); return; }
    session.printSystem(`Room: ${state.roomId} | You: ${state.myId}/${state.myName} | ${state.isHost ? 'HOST' : 'CLIENT'}`);
    session.printSystem(`Users: ${Object.keys(state.users).length}`);
    if (Object.keys(state.pendingFiles).length) {
      session.printSystem(`Pending: ${Object.keys(state.pendingFiles).join(', ')}`);
    }
  }

  // ---------- PROXY: /msg, ex/file, im/file ----------
  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!T.extensions['room']) return Reflect.get(target, prop, receiver);
      const upper = prop.toUpperCase();
      if (prop.startsWith('/')) {
        return function(fullInput) {
          const text = (typeof fullInput === 'string' && fullInput.startsWith('/')) ? fullInput.slice(1) : prop.slice(1);
          return cmdMsg(this, text);
        };
      }
      if (upper.startsWith('EX/')) {
        return function(fullInput) {
          const filename = (typeof fullInput === 'string' && /^ex\//i.test(fullInput)) ? fullInput.slice(3) : prop.slice(3);
          return cmdExport(this, filename);
        };
      }
      if (upper.startsWith('IM/')) {
        return function(fullInput) {
          const filename = (typeof fullInput === 'string' && /^im\//i.test(fullInput)) ? fullInput.slice(3) : prop.slice(3);
          return cmdImport(this, filename);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  // ---------- CLEANUP ON MINI-WINDOW CLOSE ----------
  if (!T._sessionCleanupHooks) T._sessionCleanupHooks = [];
  T._sessionCleanupHooks.push((session) => {
    const state = session._roomState;
    if (!state || !state.peer) return;
    if (state.isHost) {
      for (const conn of Object.values(state.conns)) {
        try { if (conn.open) conn.send({ type: 'host_leaving' }); } catch(e){}
      }
    }
    try { state.peer.destroy(); } catch(e){}
    state.peer = null;
  });

  // ---------- REGISTER ----------
  T.registerExtension({
    name: 'room',
    info: 'Room master key loaded. Use `room.room{id}` in main screen, or `room{id}` inside the mini window.',
    descriptions: {
      ROOM: 'Create/join room (room{id})',
      USERS: 'List users in room',
      UPTIME: 'Room uptime',
      EX: 'Export file to room (ex file.txt)',
      IM: 'Import received file (im file.txt)',
      LEAVE: 'Leave current room',
      P2P: 'Show room status',
      __MSG__: 'Send a chat message (via /text)'
    },
    scopedOnly: {
      ROOM: function(arg) { return cmdRoom(this, arg); },
      USERS: function() { return cmdUsers(this); },
      USER: function() { return cmdUsers(this); },
      ROOM_UPTIME: function() { return cmdUptime(this); },
      EX: function(arg) { return cmdExport(this, arg); },
      IM: function(arg) { return cmdImport(this, arg); },
      LEAVE: function() { return cmdLeave(this); },
      P2P: function() { return cmdStatus(this); },
      STATUS: function() { return cmdStatus(this); },
      __MSG__: function(text) { return cmdMsg(this, String(text || '')); }
    }
  });
})();
