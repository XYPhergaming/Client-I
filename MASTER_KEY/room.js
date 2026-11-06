(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

  // Better STUN config for NAT traversal
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

  let peer = null, conns = {}, hostConn = null, isHost = false;
  let myRoomId = null, myId = null, myName = null;
  let users = {}, pendingFiles = {};
  let roomStartTime = null, userStartTime = null;
  let peerLibLoaded = false;
  let migrationInProgress = false;

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

  function cleanup(session, silent) {
    if (session && !silent) {
      try { session.printSystem('Room disconnected.'); } catch(e) {}
    }
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    conns = {}; hostConn = null; isHost = false;
    myRoomId = null; myId = null; myName = null;
    users = {}; pendingFiles = {};
    roomStartTime = null; userStartTime = null;
    migrationInProgress = false;
  }

  // ---------- ROOM ENTRY ----------
  async function handleRoom(session, roomId) {
    if (peer) cleanup(session, true);
    await loadPeerLib();
    myRoomId = roomId;
    myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);

    let p = new Peer('KALMA-ROOM-' + roomId, PEER_CONFIG);
    let handled = false;

    p.on('open', () => {
      if (handled) return;
      handled = true;
      peer = p;
      startHost(session, roomId, p);
    });

    p.on('error', (err) => {
      if (handled) return;
      if (err.type === 'unavailable-id') {
        handled = true;
        try { p.destroy(); } catch(e){}
        peer = null;
        // No delay - immediately try client connect (matches working version)
        connectAsClient(session, roomId, 3).then(ok => {
          if (!ok) session.printError('Could not join room. Try again.');
        });
      } else if (err.type === 'peer-unavailable' || err.type === 'network') {
        // transient — ignore
      } else {
        handled = true;
        session.printError('Connection Error: ' + err.message);
        cleanup(session);
      }
    });
  }

  // ---------- HOST ----------
  function startHost(session, roomId, hostPeer) {
    peer = hostPeer;
    isHost = true;
    roomStartTime = roomStartTime || Date.now();
    userStartTime = Date.now();
    myId = '01';
    users = { [myId]: myName };
    conns = {};
    hostConn = null;
    session.printSuccess(`Room ${roomId} active. You are host (01/${myName}).`);
    updateTitle(session);

    peer.on('connection', (conn) => {
      conn.on('data', (data) => {
        if (data.type === 'join') {
          let newId = null;
          for (let i = 2; i <= 99; i++) {
            const idStr = i.toString().padStart(2, '0');
            if (!users[idStr]) { newId = idStr; break; }
          }
          if (!newId) { conn.send({ type: 'error', message: 'Room is full' }); conn.close(); return; }
          users[newId] = data.name;
          conns[newId] = conn;
          conn.send({ type: 'joined', id: newId, users, roomStartTime });
          broadcast(session, { type: 'system', text: `${newId}/${data.name} joined the room.` });
          broadcast(session, { type: 'userlist', users });
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
        for (const [id, c] of Object.entries(conns)) {
          if (c === conn) {
            const name = users[id];
            delete users[id]; delete conns[id];
            broadcast(session, { type: 'system', text: `${id}/${name} left.` });
            broadcast(session, { type: 'userlist', users });
            break;
          }
        }
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable' || err.type === 'network') return;
      session.printError('Host Error: ' + err.message);
    });
  }

  // ---------- CLIENT ----------
  async function connectAsClient(session, roomId, retries = 3) {
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
          hc.on('open', () => hc.send({ type: 'join', name: myName }));
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
        peer = cp; hostConn = hc; isHost = false;
        myId = joined.id;
        users = joined.users;
        roomStartTime = joined.roomStartTime || Date.now();
        userStartTime = Date.now();
        session.printSuccess(`Joined room ${roomId} as ${myId}/${myName}.`);
        updateTitle(session);
        session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);

        hostConn.on('data', (data) => {
          if (data.type === 'userlist') users = data.users;
          handleIncoming(session, data);
        });
        hostConn.on('close', () => {
          if (migrationInProgress) return;
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

  // ---------- HOST MIGRATION ----------
  async function beginMigration(session, roomId) {
    if (migrationInProgress) return;
    migrationInProgress = true;
    const savedMyName = myName;
    const savedRoomStart = roomStartTime || Date.now();
    const savedUserStart = userStartTime || Date.now();

    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    if (hostConn) { try { hostConn.close(); } catch(e){} hostConn = null; }
    conns = {}; isHost = false;

    // Jittered delay prevents race where everyone tries to claim simultaneously
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
      peer = p; isHost = true;
      myId = '01'; myName = savedMyName;
      users = { [myId]: myName };
      roomStartTime = savedRoomStart;
      userStartTime = savedUserStart;
      session.printSuccess('You are now the new host of the room.');
      updateTitle(session);
      startHost(session, roomId, p);
      migrationInProgress = false;
      return;
    }

    try { p.destroy(); } catch(e){}
    if (result === 'taken') {
      session.printSystem('Another user took over. Reconnecting as client...');
      const ok = await connectAsClient(session, roomId, 3);
      if (ok) { migrationInProgress = false; return; }
    }

    session.printError('Room could not be restored. Disconnecting.');
    cleanup(session, true);
    migrationInProgress = false;
  }

  function broadcast(session, data) {
    if (isHost) {
      handleIncoming(session, data);
      for (const conn of Object.values(conns)) if (conn.open) conn.send(data);
    } else if (hostConn && hostConn.open) {
      hostConn.send(data);
    }
  }
  function relay(data) {
    if (isHost) { for (const conn of Object.values(conns)) if (conn.open) conn.send(data); }
    else if (hostConn && hostConn.open) hostConn.send(data);
  }

  function updateTitle(session) {
    if (session.wrapper) {
      const s = session.wrapper.querySelector('.mini-header span');
      if (s) s.textContent = `room | ${myRoomId || 'None'} | ${myId || ''}/${myName || ''}`;
    }
  }

  function handleIncoming(session, data) {
    if (data.type === 'chat') {
      if (data.senderId === myId) return;
      session.printChat(`[${data.senderId}/${data.senderName}]: ${data.text}`, 'right');
    } else if (data.type === 'system') {
      session.printSystem(data.text);
    } else if (data.type === 'userlist') {
      const list = Object.entries(data.users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
      session.printSystem(`Users: ${Object.keys(data.users).length}:[${list}]`);
    } else if (data.type === 'file_offer') {
      if (data.senderId === myId) return;
      const scan = T.SecurityScanner.scan(data.filename, data.content);
      if (!scan.safe) { session.printError(`Blocked ${data.filename}: ${scan.reason}`); return; }
      const base = T.Utils.basename(data.filename);
      pendingFiles[base] = data.content;
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
    if (!myRoomId) throw new Error('NOT IN ROOM');
    session.printChat(`[${myId}/${myName}]: ${text}`, 'left');
    relay({ type: 'chat', senderId: myId, senderName: myName, text });
  }

  function cmdUsers(session) {
    if (!myRoomId) throw new Error('NOT IN ROOM');
    const list = Object.entries(users).map(([id, name]) => `${id}:${name}`).join(' ||| ');
    session.printSystem(`Users: ${Object.keys(users).length}:[${list}]`);
  }

  async function cmdExport(session, filename) {
    if (!myRoomId) throw new Error('NOT IN ROOM');
    filename = String(filename || '').replace(/^\{|\}$/g, '').replace(/^\/+/, '').trim();
    if (!filename) throw new Error('Usage: ex <filename>');
    const base = T.Utils.basename(filename);
    if (!base) throw new Error('INVALID FILENAME');
    const target = T.Utils.resolvePath(session.cwd, filename);
    const file = await T.Storage.get(target, 'vfs');
    if (!file || file.type !== 'file') throw new Error('File not found: ' + filename);
    const scan = T.SecurityScanner.scan(base, file.content);
    if (!scan.safe) { session.printError('BLOCKED AT SEND: ' + scan.reason); return; }
    session.printChat(`[${myId}/${myName}]: Export ${base}`, 'left');
    relay({ type: 'file_offer', filename: base, content: file.content, senderId: myId, senderName: myName });
  }

  async function cmdImport(session, filename) {
    if (!myRoomId) throw new Error('NOT IN ROOM');
    const clean = String(filename || '').replace(/[{}]/g, '').replace(/^\/+/, '').trim();
    if (!clean) throw new Error('Usage: im <filename>');
    const base = T.Utils.basename(clean);
    if (!base) throw new Error('INVALID FILENAME');
    let matchedKey = null;
    for (const k of Object.keys(pendingFiles)) {
      if (k.toLowerCase() === base.toLowerCase()) { matchedKey = k; break; }
    }
    if (!matchedKey) throw new Error('No pending file named ' + base);
    const content = pendingFiles[matchedKey];
    const scan = T.SecurityScanner.scan(base, content);
    if (!scan.safe) { session.printError('BLOCKED AT IMPORT: ' + scan.reason); return; }
    // Save inside {cwd}/room/
    const roomDir = T.Utils.resolvePath(session.cwd, 'room');
    const roomEntry = await T.Storage.get(roomDir, 'vfs');
    if (!roomEntry || roomEntry.type !== 'dir') {
      await T.Storage.set(roomDir, { type: 'dir' }, 'vfs');
    }
    const target = T.Utils.resolvePath(roomDir, base);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    // Keep pendingFiles — allows unlimited re-save
    session.printSuccess(`Saved: room/${base}`);
  }

  function cmdUptime(session) {
    if (!myRoomId) {
      const sec = Math.floor(performance.now() / 1000);
      session.printSystem('Uptime: ' + Math.floor(sec/60) + 'm ' + (sec%60) + 's');
      return;
    }
    const fmt = (ms) => { const s=Math.floor(ms/1000); return `${Math.floor(s/3600)}H ${Math.floor((s%3600)/60)}M ${s%60}S`; };
    session.printSystem(`Room Uptime: ${fmt(Date.now()-roomStartTime)} | You: ${fmt(Date.now()-userStartTime)}`);
  }

  function cmdLeave(session) {
    if (!myRoomId) throw new Error('NOT IN ROOM');
    if (isHost) {
      for (const conn of Object.values(conns)) if (conn.open) conn.send({ type: 'host_leaving' });
    }
    cleanup(session);
  }

  function cmdStatus(session) {
    if (!myRoomId) { session.printSystem('Room: None'); return; }
    session.printSystem(`Room: ${myRoomId} | You: ${myId}/${myName} | ${isHost ? 'HOST' : 'CLIENT'}`);
    session.printSystem(`Users: ${Object.keys(users).length}`);
    if (Object.keys(pendingFiles).length) {
      session.printSystem(`Pending: ${Object.keys(pendingFiles).join(', ')}`);
    }
  }

  // ---------- PROXY: /msg, ex/file, im/file (mini screen only) ----------
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
