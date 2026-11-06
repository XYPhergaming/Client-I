(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
  
  // আরও শক্তিশালী STUN/TURN সার্ভার
  const PEER_CONFIG = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80', username: 'e4bc885bc39f88228952b854', credential: 'f+2B8f4x5jK/3uM7' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'e4bc885bc39f88228952b854', credential: 'f+2B8f4x5jK/3uM7' },
        { urls: 'turn:global.relay.metered.ca:443', username: 'e4bc885bc39f88228952b854', credential: 'f+2B8f4x5jK/3uM7' }
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
      roomStartTime: null, userStartTime: null, migrationInProgress: false,
      heartbeatInterval: null
    };
    return session.state.room;
  }

  // কানেকশন আসলেই মৃত কিনা তা চেক করার ফাংশন
  function isConnectionDead(conn) {
    if (!conn || !conn.open) return true;
    const pc = conn.peerConnection;
    if (pc) {
      const ice = pc.iceConnectionState;
      if (ice === 'disconnected' || ice === 'failed' || ice === 'closed') return true;
    }
    return false;
  }

  function reset(session, silent) {
    const s = S(session);
    if (!silent) { try { session.printSystem('Room disconnected.'); } catch(e) {} }
    if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
    if (s.peer) { try { s.peer.destroy(); } catch(e){} s.peer = null; }
    s.conns = {}; s.hostConn = null; s.isHost = false;
    s.roomId = null; s.myId = null; s.myName = null;
    s.users = {}; s.pendingFiles = {};
    s.roomStartTime = null; s.userStartTime = null; s.migrationInProgress = false;
    s.heartbeatInterval = null;
  }

  async function handleRoom(session, roomId) {
    const s = S(session);
    if (s.peer && s.roomId === roomId) { session.printSystem(`Already in room ${roomId}.`); return; }
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
        connectAsClient(session, roomId, 3).then(ok => {
          if (!ok) session.printError('Could not join room. Network blocked or room destroyed.');
        });
      } else if (err.type === 'peer-unavailable' || err.type === 'network') {
      } else {
        handled = true;
        session.printError('Connection Error: ' + err.message);
        reset(session);
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

    hostPeer.on('disconnected', () => {
      if (hostPeer.destroyed) return;
      session.printSystem('Host server disconnected. Reconnecting...');
      try { hostPeer.reconnect(); } catch(e) {}
    });

    // Heartbeat: ৩ সেকেন্ড পর পর চেক, ৯ সেকেন্ড রেসপন্স না পেলে কেটে দিবে
    if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
    s.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, conn] of Object.entries(s.conns)) {
        if (isConnectionDead(conn) || (now - conn.lastPong > 9000)) {
          try { conn.close(); } catch(e) {}
          const name = s.users[id];
          delete s.conns[id]; delete s.users[id];
          broadcast(session, { type: 'userlist', users: s.users });
          broadcast(session, { type: 'system', text: `${id}/${name} disconnected.` });
          continue;
        }
        try { conn.send({ type: 'ping' }); } catch (e) {}
      }
    }, 3000);

    hostPeer.on('connection', (conn) => {
      conn.lastPong = Date.now();
      conn.on('data', (data) => {
        conn.lastPong = Date.now();
        if (data.type === 'ping') { try { conn.send({ type: 'pong' }); } catch(e) {} return; }
        if (data.type === 'pong') return;

        if (data.type === 'join') {
          let newId = null;
          for (let i = 2; i <= 99; i++) {
            const id = i.toString().padStart(2, '0');
            if (!s.users[id]) { newId = id; break; }
          }
          if (!newId) { try { conn.send({ type: 'error', message: 'Room is full' }); } catch(e){} conn.close(); return; }
          s.users[newId] = data.name;
          s.conns[newId] = conn;
          try { conn.send({ type: 'joined', id: newId, users: s.users, roomStartTime: s.roomStartTime }); } catch(e){}
          broadcast(session, { type: 'system', text: `${newId}/${data.name} joined.` });
          broadcast(session, { type: 'userlist', users: s.users });
        } else if (data.type === 'chat') {
          broadcast(session, data);
        } else if (data.type === 'file_offer') {
          const scan = T.SecurityScanner.scan(data.filename, data.isBinary ? null : data.content);
          if (!scan.safe) {
            session.printError(`Relay blocked ${data.filename}: ${scan.reason}`);
            try { conn.send({ type: 'error', message: `BLOCKED ${data.filename}: ${scan.reason}` }); } catch(e){}
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
      conn.on('error', () => {});
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
        hc.lastPong = Date.now();
        const joined = await new Promise((res) => {
          const t = setTimeout(() => res(null), 10000);
          hc.on('open', () => hc.send({ type: 'join', name: s.myName }));
          hc.on('data', (d) => { if (d.type === 'joined') { clearTimeout(t); res(d); } });
          hc.on('error', () => { clearTimeout(t); res(null); });
        });
        if (!joined) {
          try { hc.close(); } catch(e){}
          try { cp.destroy(); } catch(e){}
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
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

        cp.on('disconnected', () => {
          if (cp.destroyed) return;
          try { cp.reconnect(); } catch(e) {}
        });

        if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
        s.heartbeatInterval = setInterval(() => {
          if (isConnectionDead(hc) || (Date.now() - hc.lastPong > 9000)) {
            if (!s.migrationInProgress) { 
              clearInterval(s.heartbeatInterval); 
              session.printSystem('Host connection lost.');
              beginMigration(session, roomId); 
            }
            return;
          }
          try { hc.send({ type: 'ping' }); } catch(e) {}
        }, 3000);

        hc.on('data', (d) => {
          hc.lastPong = Date.now();
          if (d.type === 'ping') { try { hc.send({ type: 'pong' }); } catch(e) {} return; }
          if (d.type === 'pong') return;
          if (d.type === 'userlist') s.users = d.users;
          handleIncoming(session, d);
        });
        hc.on('close', () => {
          if (s.migrationInProgress) return;
          if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
          session.printSystem('Host left.');
          beginMigration(session, roomId);
        });
        hc.on('error', () => {
          if (s.migrationInProgress) return;
          if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
          beginMigration(session, roomId);
        });
        return true;
      } catch (e) {
        if (cp) { try { cp.destroy(); } catch(x){} }
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    return false;
  }

  async function beginMigration(session, roomId) {
    const s = S(session);
    if (s.migrationInProgress) return;
    s.migrationInProgress = true;
    if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);

    const savedName = s.myName, savedRS = s.roomStartTime || Date.now(), savedUS = s.userStartTime || Date.now();
    if (s.peer) { try { s.peer.destroy(); } catch(e){} s.peer = null; }
    if (s.hostConn) { try { s.hostConn.close(); } catch(e){} s.hostConn = null; }
    s.conns = {}; s.isHost = false;

    session.printSystem('Trying to reconnect...');
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise(r => setTimeout(r, 2000 + attempt * 2000));
      const ok = await connectAsClient(session, roomId, 1);
      if (ok) { s.migrationInProgress = false; return; }
    }

    session.printSystem('Attempting takeover as new host...');
    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));
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
      for (const c of Object.values(s.conns)) {
        if (c.open && !isConnectionDead(c)) {
          try { c.send(data); } catch(e){}
        }
      }
    } else if (s.hostConn && s.hostConn.open && !isConnectionDead(s.hostConn)) {
      try { s.hostConn.send(data); } catch(e){}
    }
  }

  function relay(session, data) {
    const s = S(session);
    if (s.isHost) { 
      for (const c of Object.values(s.conns)) {
        if (c.open && !isConnectionDead(c)) {
          try { c.send(data); } catch(e){}
        }
      }
    }
    else if (s.hostConn && s.hostConn.open && !isConnectionDead(s.hostConn)) {
      try { s.hostConn.send(data); } catch(e){}
    }
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
      const scan = T.SecurityScanner.scan(data.filename, data.isBinary ? null : data.content);
      if (!scan.safe) { session.printError(`Blocked ${data.filename}: ${scan.reason}`); return; }
      const base = T.Utils.basename(data.filename);
      
      if (data.isBinary && typeof data.content === 'string') {
        const byteCharacters = atob(data.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        s.pendingFiles[base] = new Blob([byteArray], { type: 'application/octet-stream' });
      } else {
        s.pendingFiles[base] = data.content;
      }
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
    if (!filename) throw new Error('Usage: ex/filename');
    const base = T.Utils.basename(filename);
    if (!base) throw new Error('INVALID FILENAME');
    const target = T.Utils.resolvePath(session.cwd, filename);
    const file = await T.Storage.get(target, 'vfs');
    if (!file || file.type !== 'file') throw new Error('File not found: ' + filename);
    
    let contentToSend = file.content;
    let isBinary = file.isBinary || false;
    
    if (isBinary && file.content instanceof Blob) {
        contentToSend = await T.Utils.blobToBase64(file.content);
    }

    const scan = T.SecurityScanner.scan(base, isBinary ? null : contentToSend);
    if (!scan.safe) { session.printError('BLOCKED AT SEND: ' + scan.reason); return; }
    session.printChat(`[${s.myId}/${s.myName}]: Export ${base}`, 'left');
    relay(session, { type: 'file_offer', filename: base, content: contentToSend, isBinary, senderId: s.myId, senderName: s.myName });
  }
  async function cmdImport(session, filename) {
    const s = S(session);
    if (!s.roomId) throw new Error('NOT IN ROOM');
    const clean = String(filename || '').replace(/^\/+/, '').trim();
    if (!clean) throw new Error('Usage: im/filename');
    const base = T.Utils.basename(clean);
    if (!base) throw new Error('INVALID FILENAME');
    let matched = null;
    for (const k of Object.keys(s.pendingFiles)) if (k.toLowerCase() === base.toLowerCase()) { matched = k; break; }
    if (!matched) throw new Error('No pending file named ' + base);
    const content = s.pendingFiles[matched];
    
    const scan = T.SecurityScanner.scan(base, content instanceof Blob ? null : content);
    if (!scan.safe) { session.printError('BLOCKED AT IMPORT: ' + scan.reason); return; }
    
    const roomDir = T.Utils.resolvePath(session.cwd, 'room');
    const roomEntry = await T.Storage.get(roomDir, 'vfs');
    if (!roomEntry || roomEntry.type !== 'dir') await T.Storage.set(roomDir, { type: 'dir' }, 'vfs');
    const target = T.Utils.resolvePath(roomDir, base);
    
    if (content instanceof Blob) {
        await T.Storage.set(target, { type: 'file', content: content, isBinary: true }, 'vfs');
    } else {
        await T.Storage.set(target, { type: 'file', content: content }, 'vfs');
    }
    session.printSuccess(`Saved: room/${base}`);
  }

  if (!T._sessionCleanupHooks) T._sessionCleanupHooks = [];
  T._sessionCleanupHooks.push((session) => {
    const s = session.state && session.state.room;
    if (!s || !s.peer) return;
    if (s.isHost) for (const c of Object.values(s.conns)) { try { if (c.open) c.send({ type: 'host_leaving' }); } catch(e){} }
    if (s.heartbeatInterval) clearInterval(s.heartbeatInterval);
    try { s.peer.destroy(); } catch(e){}
    s.peer = null;
  });

  T.registerExtension({
    name: 'room',
    info: 'Room master key loaded.',
    descriptions: {
      ROOM: 'Create OR join (room{id})',
      USERS: 'List users'
    },
    routes: [
      { pattern: /^ex\/(.+)$/i, handler: 'EX' },
      { pattern: /^im\/(.+)$/i, handler: 'IM' },
      { pattern: /^\/(.+)$/, handler: 'MSG' }
    ],
    scopedOnly: {
      ROOM: function(arg) { return cmdRoom(this, arg); },
      USERS: function() { return cmdUsers(this); },
      MSG: function(arg) { return cmdMsg(this, String(arg || '')); },
      EX: function(arg) { return cmdExport(this, arg); },
      IM: function(arg) { return cmdImport(this, arg); }
    }
  });
})();