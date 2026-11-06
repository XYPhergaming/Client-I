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

  function S(session) {
    if (!session.state) session.state = {};
    if (!session.state.room) session.state.room = {
      peer: null, conns: {}, hostConn: null, isHost: false,
      roomId: null, myId: null, myName: null,
      users: {}, pendingFiles: {},
      roomStartTime: null, userStartTime: null, migrationInProgress: false
    };
    return session.state.room;
  }

  function reset(session, silent) {
    const s = S(session);
    if (!silent) { try { session.printSystem('Room disconnected.'); } catch(e) {} }
    if (s.peer) { try { s.peer.destroy(); } catch(e){} s.peer = null; }
    s.conns = {}; s.hostConn = null; s.isHost = false;
    s.roomId = null; s.myId = null; s.myName = null;
    s.users = {}; s.pendingFiles = {};
    s.roomStartTime = null; s.userStartTime = null; s.migrationInProgress = false;
  }

  async function handleRoom(session, roomId) {
    const s = S(session);
    if (s.peer && s.roomId === roomId) { session.printSystem(`Already in room ${roomId}. Use room.leave first to rejoin.`); return; }
    if (s.peer) {
      if (s.isHost) for (const c of Object.values(s.conns)) { try { if (c.open) c.send({ type: 'host_leaving' }); } catch(e){} }
      reset(session, true);
    }
    await loadPeerLib();
    s.roomId = roomId;
    s.myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);

    const p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    let handled = false;
    p.on('open', () => {
      if (handled) return; handled = true;
      s.peer = p;
      startHost(session, roomId, p);
    });
    p.on('error', (err) => {
      if (handled) return;
      if (err.type === 'unavailable-id') {
        handled = true;
        try { p.destroy(); } catch(e){}
        s.peer = null;
        connectAsClient(session, roomId, 3).then(ok => { if (!ok) session.printError('Could not join room. Try again.'); });
      } else if (err.type === 'peer-unavailable' || err.type === 'network') {
      } else {
        handled = true;
        session.printError('Connection Error: ' + err.message);
        reset(session);
      }
    });
  }

  // NEW: join-only command (fails if room doesn't exist)
  async function cmdJoin(session, roomId) {
    roomId = String(roomId || '').trim();
    if (!roomId) throw new Error('Usage: join{roomId}');
    const s = S(session);
    if (s.peer) { reset(session, true); }
    await loadPeerLib();
    s.roomId = roomId;
    s.myName = T.getUsername();
    session.printSystem(`Joining room ${roomId}...`);
    const ok = await connectAsClient(session, roomId, 3);
    if (!ok) session.printError('Could not join. Room may not exist or network blocked. Try host{' + roomId + '} or room{' + roomId + '}.');
  }

  // NEW: host-only command (fails if room exists)
  async function cmdHost(session, roomId) {
    roomId = String(roomId || '').trim();
    if (!roomId) throw new Error('Usage: host{roomId}');
    const s = S(session);
    if (s.peer) { reset(session, true); }
    await loadPeerLib();
    s.roomId = roomId;
    s.myName = T.getUsername();
    session.printSystem(`Creating room ${roomId}...`);
    const p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    let handled = false;
    p.on('open', () => {
      if (handled) return; handled = true;
      s.peer = p;
      startHost(session, roomId, p);
    });
    p.on('error', (err) => {
      if (handled) return;
      handled = true;
      try { p.destroy(); } catch(e){}
      if (err.type === 'unavailable-id') {
        session.printError('Room name already taken. Use join{' + roomId + '} to join it.');
      } else {
        session.printError('Connection Error: ' + err.message);
      }
    });
  }

  function startHost(session, roomId, hostPeer) {
    const s = S(session);
    s.peer = hostPeer; s.isHost = true;
    s.roomStartTime = s.roomStartTime || Date.now();
    s.userStartTime = Date.now();
    s.myId = '01';
    s.users = { [s.myId]: s.myName };
    s.conns = {}; s.hostConn = null;
    session.printSuccess(`Room ${roomId} active. You are host (01/${s.myName}).`);
    updateTitle(session);

    hostPeer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'join') {
          let newId = null;
          for (let i = 2; i <= 99; i++) {
            const id = i.toString().padStart(2, '0');
            if (!s.users[id]) { newId = id; break; }
          }
          if (!newId) { conn.send({ type: 'error', message: 'Room is full' }); conn.close(); return; }
          s.users[newId] = data.name;
          s.conns[newId] = conn;
          conn.send({ type: 'joined', id: newId, users: s.users, roomStartTime: s.roomStartTime });
          broadcast(session, { type: 'system', text: `${newId}/${data.name} joined the room.` });
          broadcast(session, { type: 'userlist', users: s.users });
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
        for (const [id, c] of Object.entries(s.conns)) {
          if (c === conn) {
            const name = s.users[id];
            delete s.users[id]; delete s.conns[id];
            broadcast(session, { type: 'system', text: `${id}/${name} left.` });
            broadcast(session, { type: 'userlist', users: s.users });
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

  async function connectAsClient(session, roomId, retries = 3) {
    const s = S(session);
    for (let i = 0; i < retries; i++) {
      if (i > 0) session.printSystem(`Retry ${i+1}/${retries}...`);
      let cp = null;
      try {
        cp = new Peer(PEER_CONFIG);
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('open timeout')), 10000);
          cp.on('open', () => { clearTimeout(t); res(); });
          cp.on('error', (e) => { clearTimeout(t); rej(e); });
        });
        const hc = cp.connect('KALMA-ROOM-' + roomId);
        const joined = await new Promise((res) => {
          const t = setTimeout(() => res(null), 10000);
          hc.on('open', () => hc.send({ type: 'join', name: s.myName }));
          hc.on('data', (d) => { if (d.type === 'joined') { clearTimeout(t); res(d); } });
          hc.on('error', () => { clearTimeout(t); res(null); });
        });
        if (!joined) {
          try { hc.close(); } catch(e){}
          try { cp.destroy(); } catch(e){}
          await new Promise(r => setTimeout(r, 800 * (i + 1)));
          continue;
        }
        s.peer = cp; s.hostConn = hc; s.isHost = false;
        s.myId = joined.id;
        s.users = joined.users;
        s.roomStartTime = joined.roomStartTime || Date.now();
        s.userStartTime = Date.now();
        session.printSuccess(`Joined room ${roomId} as ${s.myId}/${s.myName}.`);
        updateTitle(session);
        session.printSystem(`Users: ${Object.keys(s.users).length}:[${Object.entries(s.users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);

        hc.on('data', (d) => { if (d.type === 'userlist') s.users = d.users; handleIncoming(session, d); });
        hc.on('close', () => {
          if (s.migrationInProgress) return;
          session.printSystem('Host left. Trying to keep room alive...');
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

  async function beginMigration(session, roomId) {
    const s = S(session);
    if (s.migrationInProgress) return;
    s.migrationInProgress = true;
    const savedName = s.myName, savedRS = s.roomStartTime || Date.now(), savedUS = s.userStartTime || Date.now();
    if (s.peer) { try { s.peer.destroy(); } catch(e){} s.peer = null; }
    if (s.hostConn) { try { s.hostConn.close(); } catch(e){} s.hostConn = null; }
    s.conns = {}; s.isHost = false;
    const delay = 1500 + Math.floor(Math.random() * 2000);
    await new Promise(r => setTimeout(r, delay));
    const p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    const result = await new Promise((res) => {
      const t = setTimeout(() => res('timeout'), 10000);
      p.on('open', () => { clearTimeout(t); res('open'); });
      p.on('error', (e) => { clearTimeout(t); res(e.type === 'unavailable-id' ? 'taken' : 'error'); });
    });
    if (result === 'open') {
      s.peer = p; s.isHost = true; s.myId = '01'; s.myName = savedName;
      s.users = { [s.myId]: s.myName };
      s.roomStartTime = savedRS; s.userStartTime = savedUS;
      session.printSuccess('You are now the new host of the room.');
      updateTitle(session);
      startHost(session, roomId, p);
      s.migrationInProgress = false;
      return;
    }
    try { p.destroy(); } catch(e){}
    if (result === 'taken') {
      session.printSystem('Another user took over. Reconnecting as client...');
      const ok = await connectAsClient(session, roomId, 3);
      if (ok) { s.migrationInProgress = false; return; }
    }
    session.printError('Room could not be restored. Disconnecting.');
    reset(session, true);
  }

  function broadcast(session, data) {
    const s = S(session);
    if (s.isHost) {
      handleIncoming(session, data);
      for (const c of Object.values(s.conns)) if (c.open) c.send(data);
    } else if (s.hostConn && s.hostConn.open) {
      s.hostConn.send(data);
    }
  }
  function relay(session, data) {
    const s = S(session);
    if (s.isHost) { for (const c of Object.values(s.conns)) if (c.open) c.send(data); }
    else if (s.hostConn && s.hostConn.open) s.hostConn.send(data);
  }
  function updateTitle(session) {
    const s = S(session);
    if (session.wrapper) {
      const el = session.wrapper.querySelector('.mini-header span');
      if (el) el.textContent = `room | ${s.roomId || 'None'} | ${s.myId || ''}/${s.myName || ''}`;
    }
  }
  function handleIncoming(session, data) {
    const s = S(session);
    if (data.type === 'chat') {
      if (data.senderId === s.myId) return;
      session.printChat(`[${data.senderId}/${data.senderName}]: ${data.text}`, 'right');
    } else if (data.type === 'system') {
      session.printSystem(data.text);
    } else if (data.type === 'userlist') {
      const list = Object.entries(data.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
      session.printSystem(`Users: ${Object.keys(data.users).length}:[${list}]`);
    } else if (data.type === 'file_offer') {
      if (data.senderId === s.myId) return;
      const scan = T.SecurityScanner.scan(data.filename, data.content);
      if (!scan.safe) { session.printError(`Blocked ${data.filename}: ${scan.reason}`); return; }
      const base = T.Utils.basename(data.filename);
      s.pendingFiles[base] = data.content;
      session.printChat(`[${data.senderId}/${data.senderName}]: Export ${base}`, 'right');
    }
  }

  async function cmdRoom(session, roomId) {
    roomId = String(roomId || '').trim();
    if (!roomId) throw new Error('Usage: room{roomId}');
    await handleRoom(session, roomId);
  }
  function cmdMsg(session, text) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    session.printChat(`[${s.myId}/${s.myName}]: ${text}`, 'left');
    relay(session, { type: 'chat', senderId: s.myId, senderName: s.myName, text });
  }
  function cmdUsers(session) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    const list = Object.entries(s.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
    session.printSystem(`Users: ${Object.keys(s.users).length}:[${list}]`);
  }
  async function cmdExport(session, filename) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    filename = String(filename || '').replace(/^\/+/, '').trim();
    if (!filename) throw new Error('Usage: ex <filename>');
    const base = T.Utils.basename(filename);
    if (!base) throw new Error('INVALID FILENAME');
    const target = T.Utils.resolvePath(session.cwd, filename);
    const file = await T.Storage.get(target, 'vfs');
    if (!file || file.type !== 'file') throw new Error('File not found: ' + filename);
    const scan = T.SecurityScanner.scan(base, file.content);
    if (!scan.safe) { session.printError('BLOCKED AT SEND: ' + scan.reason); return; }
    session.printChat(`[${s.myId}/${s.myName}]: Export ${base}`, 'left');
    relay(session, { type: 'file_offer', filename: base, content: file.content, senderId: s.myId, senderName: s.myName });
  }
  async function cmdImport(session, filename) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    const clean = String(filename || '').replace(/^\/+/, '').trim();
    if (!clean) throw new Error('Usage: im <filename>');
    const base = T.Utils.basename(clean);
    if (!base) throw new Error('INVALID FILENAME');
    let matched = null;
    for (const k of Object.keys(s.pendingFiles)) if (k.toLowerCase() === base.toLowerCase()) { matched = k; break; }
    if (!matched) throw new Error('No pending file named ' + base);
    const content = s.pendingFiles[matched];
    const scan = T.SecurityScanner.scan(base, content);
    if (!scan.safe) { session.printError('BLOCKED AT IMPORT: ' + scan.reason); return; }
    const roomDir = T.Utils.resolvePath(session.cwd, 'room');
    const roomEntry = await T.Storage.get(roomDir, 'vfs');
    if (!roomEntry || roomEntry.type !== 'dir') await T.Storage.set(roomDir, { type: 'dir' }, 'vfs');
    const target = T.Utils.resolvePath(roomDir, base);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    session.printSuccess(`Saved: room/${base}`);
  }
  function cmdUptime(session) {
    const s = S(session);
    if (!s.roomId) {
      const sec = Math.floor(performance.now() / 1000);
      session.printSystem('Uptime: ' + Math.floor(sec/60) + 'm ' + (sec%60) + 's');
      return;
    }
    const fmt = (ms) => { const x = Math.floor(ms/1000); return `${Math.floor(x/3600)}H ${Math.floor((x%3600)/60)}M ${x%60}S`; };
    session.printSystem(`Room Uptime: ${fmt(Date.now()-s.roomStartTime)} | You: ${fmt(Date.now()-s.userStartTime)}`);
  }
  function cmdLeave(session) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    if (s.isHost) for (const c of Object.values(s.conns)) { try { if (c.open) c.send({ type: 'host_leaving' }); } catch(e){} }
    reset(session);
  }
  function cmdStatus(session) {
    const s = S(session);
    if (!s.roomId) { session.printSystem('Room: None'); return; }
    session.printSystem(`Room: ${s.roomId} | You: ${s.myId}/${s.myName} | ${s.isHost ? 'HOST' : 'CLIENT'}`);
    session.printSystem(`Users: ${Object.keys(s.users).length}`);
    if (Object.keys(s.pendingFiles).length) session.printSystem(`Pending: ${Object.keys(s.pendingFiles).join(', ')}`);
  }

  if (!T._sessionCleanupHooks) T._sessionCleanupHooks = [];
  T._sessionCleanupHooks.push((session) => {
    const s = session.state && session.state.room;
    if (!s || !s.peer) return;
    if (s.isHost) for (const c of Object.values(s.conns)) { try { if (c.open) c.send({ type: 'host_leaving' }); } catch(e){} }
    try { s.peer.destroy(); } catch(e){}
    s.peer = null;
  });

  T.registerExtension({
    name: 'room',
    info: 'Room master key loaded.',
    descriptions: {
      ROOM: 'Create OR join (room{id}) — tries host first, falls back to join',
      HOST: 'Create only — fails if room exists (host{id})',
      JOIN: 'Join only — fails if room does not exist (join{id})',
      USERS: 'List users',
      MSG: 'Send chat (msg <text> or /text)',
      EX: 'Export file (ex <file> or ex/<file>)',
      IM: 'Import file (im <file> or im/<file>)',
      LEAVE: 'Leave room',
      STATUS: 'Status'
    },
    routes: [
      { pattern: /^\/(.+)$/, handler: 'MSG' },
      { pattern: /^ex\/(.+)$/i, handler: 'EX' },
      { pattern: /^im\/(.+)$/i, handler: 'IM' }
    ],
    scopedOnly: {
      ROOM: function(arg) { return cmdRoom(this, arg); },
      HOST: function(arg) { return cmdHost(this, arg); },
      JOIN: function(arg) { return cmdJoin(this, arg); },
      USERS: function() { return cmdUsers(this); },
      USER: function() { return cmdUsers(this); },
      MSG: function(arg) { return cmdMsg(this, String(arg || '')); },
      EX: function(arg) { return cmdExport(this, arg); },
      IM: function(arg) { return cmdImport(this, arg); },
      LEAVE: function() { return cmdLeave(this); },
      STATUS: function() { return cmdStatus(this); },
      P2P: function() { return cmdStatus(this); }
    }
  });
})();