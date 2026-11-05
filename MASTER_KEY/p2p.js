(function () {
  'use strict';
  const T = Terminal;
  const PEER_CDN = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';

  let peer = null, conns = {}, hostConn = null, isHost = false;
  let myRoomId = null, myId = null, myName = null;
  let users = {}, pendingFiles = {};
  let roomStartTime = null, userStartTime = null;
  let peerLibLoaded = false;
  let reconnecting = false;

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

  function cleanup() {
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    conns = {}; hostConn = null; isHost = false;
    myRoomId = null; myId = null; myName = null;
    users = {}; pendingFiles = {};
    roomStartTime = null; userStartTime = null;
  }

  async function handleRoom(session, roomId) {
    if (peer) cleanup();
    await loadPeerLib();
    myRoomId = roomId;
    myName = T.getUsername();
    session.printSystem(`Connecting to room ${roomId}...`);
    peer = new Peer('KALMA-ROOM-' + roomId);
    peer.on('open', () => { isHost = true; startHost(session, roomId, peer); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        try { peer.destroy(); } catch(e){}
        peer = null; isHost = false;
        startClient(session, roomId);
      } else {
        session.printError('Connection Error: ' + err.message);
        cleanup();
      }
    });
  }

  function startHost(session, roomId, hostPeer) {
    peer = hostPeer;
    roomStartTime = Date.now();
    userStartTime = Date.now();
    myId = '01';
    users[myId] = myName;
    session.printSuccess(`Room ${roomId} created. You are the host (01/${myName}).`);
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
          // Security check on RECEIVE
          const scan = T.SecurityScanner.scan(data.filename, data.content);
          if (!scan.safe) {
            session.printError(`Blocked ${data.filename} from ${data.senderId}: ${scan.reason}`);
            conn.send({ type: 'error', message: `BLOCKED ${data.filename}: ${scan.reason}` });
            return;
          }
          broadcast(session, data);
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
    peer.on('error', (err) => session.printError('Host Error: ' + err.message));
  }

  function startClient(session, roomId) {
    peer = new Peer();
    roomStartTime = Date.now();
    userStartTime = Date.now();
    peer.on('open', () => {
      hostConn = peer.connect('KALMA-ROOM-' + roomId);
      hostConn.on('open', () => { hostConn.send({ type: 'join', name: myName }); });
      hostConn.on('data', (data) => {
        if (data.type === 'joined') {
          myId = data.id; users = data.users; roomStartTime = data.roomStartTime || Date.now();
          session.printSuccess(`Joined room ${roomId} as ${myId}/${myName}.`);
          updateTitle(session);
          session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);
        } else if (data.type === 'chat') {
          handleIncoming(session, data);
        } else if (data.type === 'system') {
          session.printSystem(data.text);
        } else if (data.type === 'userlist') {
          users = data.users;
          session.printSystem(`Users: ${Object.keys(users).length}:[${Object.entries(users).map(([i,n])=>`${i}:${n}`).join(' ||| ')}]`);
        } else if (data.type === 'file_offer') {
          handleIncoming(session, data);
        } else if (data.type === 'error') {
          session.printError(data.message);
        }
      });
      hostConn.on('close', () => {
        if (reconnecting) return;
        reconnecting = true;
        session.printError('Host disconnected. Reconnecting...');
        const savedRoomId = roomId;
        cleanup();
        setTimeout(() => {
          try { handleRoom(session, savedRoomId); }
          catch (e) { session.printError('RECONNECT FAILED: ' + e.message); }
          finally { reconnecting = false; }
        }, 2500 + Math.random() * 1500);
      });
    });
    peer.on('error', (err) => {
      if (reconnecting) return;
      session.printError('Client Error: ' + err.message);
      cleanup();
    });
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
      if (s) s.textContent = `p2p | Room: ${myRoomId || 'None'}`;
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
    // Security check on SEND
    const scan = T.SecurityScanner.scan(base, file.content);
    if (!scan.safe) { session.printError('BLOCKED: ' + scan.reason); return; }
    session.printChat(`[${myId}/${myName}]: Export ${base}`, 'left');
    relay({ type: 'file_offer', filename: base, content: file.content, senderId: myId, senderName: myName });
  }
  async function cmdImport(session, filename) {
    if (!myRoomId) throw new Error('NOT IN ROOM');
    const clean = String(filename || '').replace(/[{}]/g, '').replace(/^\/+/, '').trim();
    if (!clean) throw new Error('Usage: im <filename>');
    const base = T.Utils.basename(clean);
    if (!base) throw new Error('INVALID FILENAME');
    if (!pendingFiles[base]) throw new Error('No pending file named ' + base);
    const content = pendingFiles[base];
    // Security check on IMPORT to VFS
    const scan = T.SecurityScanner.scan(base, content);
    if (!scan.safe) { session.printError('BLOCKED: ' + scan.reason); delete pendingFiles[base]; return; }
    const target = T.Utils.resolvePath(session.cwd, base);
    await T.Storage.set(target, { type: 'file', content }, 'vfs');
    delete pendingFiles[base];
    session.printSuccess(`Saved ${base}.`);
  }
  function cmdUptime(session) {
    if (!myRoomId) {
      const sec = Math.floor(performance.now() / 1000);
      session.printSystem('Uptime: ' + Math.floor(sec/60) + 'm ' + (sec%60) + 's');
      return;
    }
    const fmt = (ms) => { const s=Math.floor(ms/1000); return `${Math.floor(s/3600)}H ${Math.floor((s%3600)/60)}M ${s%60}S`; };
    session.printSystem(`Uptime: ${fmt(Date.now()-roomStartTime)} / ${fmt(Date.now()-userStartTime)}`);
  }

  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!T.extensions['p2p']) return Reflect.get(target, prop, receiver);
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
    name: 'p2p',
    info: 'P2P Room Chat loaded.',
    descriptions: {
      P2P: 'Show P2P status',
      ROOM: 'Join or create room (room{id})',
      USER: 'List users in room',
      UPTIME: 'Show room uptime',
      EX: 'Export file to room (ex file.txt)',
      IM: 'Import received file (im file.txt)'
    },
    commands: {
      P2P: function() { this.printSystem('P2P active. Use p2p.room{id} in main or room{id} in mini window.'); },
      ROOM: function(arg) { return cmdRoom(this, arg); },
      USER: function() { return cmdUsers(this); },
      UPTIME: function() { return cmdUptime(this); },
      EX: function(arg) { return cmdExport(this, arg); },
      IM: function(arg) { return cmdImport(this, arg); },
      P2P_MSG: function(arg) { return cmdMsg(this, arg); }
    }
  });
})();
