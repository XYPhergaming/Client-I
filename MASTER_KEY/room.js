(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

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

  function cleanup(session) {
    if (session) {
      try { session.printSystem('Room disconnected.'); } catch(e) {}
    }
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    conns = {}; hostConn = null; isHost = false;
    myRoomId = null; myId = null; myName = null;
    users = {}; pendingFiles = {};
    roomStartTime = null; userStartTime = null;
  }

  // ---------- ROOM ENTRY ----------
  async function handleRoom(session, roomId) {
    if (peer) cleanup(session);
    await loadPeerLib();
    myRoomId = roomId;
    myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);

    const p = new Peer('KALMA-ROOM-' + roomId);
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
        connectAsClient(session, roomId, 3);
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
          // SECURITY CHECK AT RELAY (host)
          const scan = T.SecurityScanner.scan(data.filename, data.content);
          if (!scan.safe) {
            session.printError(`Relay blocked ${data.filename}: ${scan.reason}`);
            conn.send({ type: 'error', message: `BLOCKED ${data.filename}: ${scan.reason}` });
            return;
          }
          broadcast(session, data);
        } else if (data.type === 'host_leaving') {
          // graceful leave — start migration
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
      try {
        const cp = new Peer();
        const opened = await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('peer open timeout')), 8000);
          cp.on('open', () => { clearTimeout(t); res(); });
          cp.on('error', (e) => { clearTimeout(t); rej(e); });
        });
        const hc = cp.connect('KALMA-ROOM-' + roomId);
        const joined = await new Promise((res) => {
          const t = setTimeout(() => res(null), 8000);
          hc.on('open', () => hc.send({ type: 'join', name: myName }));
          hc.on('data', (data) => { if (data.type === 'joined') { clearTimeout(t); res(data); } });
          hc.on('error', () => { clearTimeout(t); res(null); });
        });
        if (!joined) { try { cp.destroy(); } catch(e){} continue; }
        peer = cp; hostConn = hc; isHost = false;
        myId = joined.id;
        users = joined.users;
        roomStartTime = joined.roomStartTime || Date.now();
        userStartTime = Date.now();
        session.printSuccess(`Joined room ${roomId} as ${myId}/${myName}.`);
        updateTitle(session);
        session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);

        hostConn.on('data', (data) => {
          if (data.type === 'chat' || data.type === 'system' || data.type === 'file_offer' || data.type === 'userlist') {
            if (data.type === 'userlist') users = data.users;
            handleIncoming(session, data);
          } else if (data.type === 'error') {
            session.printError(data.message);
          }
        });
        hostConn.on('close', () => {
          if (migrationInProgress) return;
          session.printSystem('Host disconnected. Attempting to continue room...');
          beginMigration(session, roomId);
        });
        return true;
      } catch (e) {
        await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    session.printError('Could not reconnect to room.');
    cleanup(session);
    return false;
  }

  // ---------- HOST MIGRATION ----------
  function beginMigration(session, roomId) {
    if (migrationInProgress) return;
    migrationInProgress = true;

    // Preserve name/users
    const savedUsers = { ...users };
    const savedMyId = myId;
    const savedMyName = myName;
    const savedRoomStart = roomStartTime;
    const savedUserStart = userStartTime;

    // Clean peer/conns but keep identifiers
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    if (hostConn) { try { hostConn.close(); } catch(e){} hostConn = null; }
    conns = {};
    isHost = false;

    // Random 1-3s jitter so clients don't race identically
    const delay = 1000 + Math.floor(Math.random() * 2000);

    setTimeout(async () => {
      await loadPeerLib();
      const p = new Peer('KALMA-ROOM-' + roomId);
      let handled = false;

      p.on('open', () => {
        if (handled) return;
        handled = true;
        // We became the new host
        peer = p;
        isHost = true;
        myId = '01';
        myName = savedMyName;
        // Rebuild user list with self as 01, keep others' old names in "hint"
        users = { [myId]: myName };
        // Attempt to preserve room start time
        roomStartTime = savedRoomStart || Date.now();
        userStartTime = savedUserStart || Date.now();
        session.printSuccess('You are now the new host of the room.');
        updateTitle(session);
        startHost(session, roomId, p);
        migrationInProgress = false;
      });

      p.on('error', (err) => {
        if (handled) return;
        if (err.type === 'unavailable-id') {
          handled = true;
          try { p.destroy(); } catch(e){}
          peer = null;
          // Someone else became host — try to reconnect as client
          migrationInProgress = false;
          connectAsClient(session, roomId, 4);
        } else {
          handled = true;
          session.printError('Migration failed: ' + err.message);
          cleanup(session);
          migrationInProgress = false;
        }
      });
    }, delay);
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
      // SECURITY CHECK AT RECEIVE
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

    // SECURITY CHECK AT SEND
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
    // Case-insensitive match on received files
    let matchedKey = null;
    for (const k of Object.keys(pendingFiles)) if (k.toLowerCase() === base.toLowerCase()) { matchedKey = k; break; }
    if (!matchedKey) throw new Error('No pending file named ' + base);
    const content = pendingFiles[matchedKey];

    // SECURITY CHECK AT IMPORT
    const scan = T.SecurityScanner.scan(base, content);
    if (!scan.safe) { session.printError('BLOCKED AT IMPORT: ' + scan.reason); delete pendingFiles[matchedKey]; return; }

    const target = T.Utils.resolvePath(session.cwd, base);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    delete pendingFiles[matchedKey];
    session.printSuccess(`Saved ${base}.`);
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
    // Graceful: tell host we're leaving
    if (isHost) {
      // As host, notify clients so they can migrate
      for (const conn of Object.values(conns)) if (conn.open) conn.send({ type: 'host_leaving' });
    }
    cleanup(session);
    session.printSuccess('Left the room.');
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

  T.registerExtension({
    name: 'room',
    info: 'Room master key loaded. Use room{id} to create/join a room.',
    descriptions: {
      ROOM: 'Create/join room (room{id})',
      USERS: 'List users in room',
      UPTIME: 'Room uptime',
      EX: 'Export file to room (ex file.txt)',
      IM: 'Import received file (im file.txt)',
      LEAVE: 'Leave current room',
      P2P: 'Show room status'
    },
    commands: {
      ROOM: function(arg) { return cmdRoom(this, arg); },
      USERS: function() { return cmdUsers(this); },
      USER: function() { return cmdUsers(this); },
      ROOM_UPTIME: function() { return cmdUptime(this); },
      EX: function(arg) { return cmdExport(this, arg); },
      IM: function(arg) { return cmdImport(this, arg); },
      LEAVE: function() { return cmdLeave(this); },
      P2P: function() {
        if (!myRoomId) this.printSystem('Room: None');
        else this.printSystem(`Room: ${myRoomId} | You: ${myId}/${myName} | ${isHost ? 'HOST' : 'CLIENT'}`);
      }
    }
  });
})();