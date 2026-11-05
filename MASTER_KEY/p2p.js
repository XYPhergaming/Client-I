(function () {
  'use strict';
  const T = Terminal;

  let peer = null;
  let isHost = false;
  let myRoom = null;
  let connections = [];
  let hostConn = null;
  let peerLibLoaded = false;

  async function loadPeerLib() {
    if (peerLibLoaded) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
      script.onload = () => { peerLibLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load PeerJS library'));
      document.head.appendChild(script);
    });
  }

  function leaveRoom(session) {
    if (isHost) {
      connections.forEach(c => { try { c.close(); } catch(e){} });
      connections = [];
      if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
      isHost = false;
    } else if (hostConn) {
      try { hostConn.close(); } catch(e){}
      hostConn = null;
      if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    }
    myRoom = null;
    if (session) session.printSystem('You have left the room.');
  }

  function setupHost(session, roomId) {
    peer = new Peer('ROOM-' + roomId);

    peer.on('open', (id) => {
      session.printSuccess(`[HOST] Room ${roomId} created and active.`);
    });

    peer.on('connection', (c) => {
      connections.push(c);

      c.on('data', (data) => {
        if (data.type === 'message') {
          session.printSystem(`\n[${data.sender}]: ${data.text}\n`);
        } else if (data.type === 'file') {
          session.printSystem(`\n[${data.sender}] sent file: ${data.filename}\n`);
          T.Storage.set(data.filename, { type: 'file', content: data.content }, 'vfs');
        }
        connections.forEach(other => {
          if (other !== c && other.open) other.send(data);
        });
      });

      c.on('close', () => {
        connections = connections.filter(x => x !== c);
      });
    });

    peer.on('error', (err) => {
      session.printError('Host Error: ' + err.message);
      leaveRoom(session);
    });
  }

  function setupClient(session, hostPeerId) {
    hostConn = peer.connect(hostPeerId);

    hostConn.on('open', () => {
      session.printSuccess(`[CLIENT] Joined room ${myRoom}.`);
    });

    hostConn.on('data', (data) => {
      if (data.type === 'message') {
        session.printSystem(`\n[${data.sender}]: ${data.text}\n`);
      } else if (data.type === 'file') {
        session.printSystem(`\n[${data.sender}] sent file: ${data.filename}\n`);
        T.Storage.set(data.filename, { type: 'file', content: data.content }, 'vfs');
      }
    });

    hostConn.on('close', () => {
      session.printError('Host disconnected. You are now alone in this room.');
      hostConn = null;
    });
  }

  async function handleP2P(session, cmd, arg) {
    if (cmd === 'P2P_INIT') {
      if (peerLibLoaded) { session.printSystem('P2P engine is already ready.'); return; }
      session.printSystem('Loading P2P engine...');
      try {
        await loadPeerLib();
        session.printSuccess('P2P engine ready. Use p2p.join{roomNumber} to enter a room.');
      } catch (e) {
        session.printError(e.message);
      }
      return;
    }

    if (cmd === 'P2P_JOIN') {
      if (!arg) { session.printError('Usage: p2p.join{roomNumber}'); return; }
      const roomNum = arg.trim();
      if (!/^\d+$/.test(roomNum)) {
        session.printError('Room ID must be a number.');
        return;
      }

      if (myRoom) {
        leaveRoom(session);
      }

      await loadPeerLib();
      session.printSystem(`Checking room ${roomNum}...`);

      const testPeer = new Peer();
      testPeer.on('open', () => {
        const tempConn = testPeer.connect('ROOM-' + roomNum);
        let joined = false;

        tempConn.on('open', () => {
          joined = true;
          tempConn.close();
          testPeer.destroy();

          myRoom = roomNum;
          isHost = false;
          peer = new Peer();
          peer.on('open', () => setupClient(session, 'ROOM-' + roomNum));
        });

        tempConn.on('error', () => {
          if (!joined) {
            testPeer.destroy();
            myRoom = roomNum;
            isHost = true;
            setupHost(session, roomNum);
          }
        });
      });

      return;
    }

    if (!myRoom) { session.printError('You are not in any room. Use p2p.join{roomNumber}.'); return; }

    if (cmd === 'P2P_MSG') {
      if (!arg) { session.printError('Usage: p2p.msg{message}'); return; }
      const sender = T.getUsername() || peer.id;
      const data = { type: 'message', text: arg, sender };

      if (isHost) {
        session.printSystem(`\n[You]: ${arg}\n`);
        connections.forEach(c => { if (c.open) c.send(data); });
      } else if (hostConn && hostConn.open) {
        session.printSystem(`\n[You]: ${arg}\n`);
        hostConn.send(data);
      } else {
        session.printError('Not connected to host.');
      }
      return;
    }

    if (cmd === 'P2P_FILE') {
      if (!arg) { session.printError('Usage: p2p.file{filename}'); return; }
      const file = await T.Storage.get(arg, 'vfs');
      if (!file || file.type !== 'file') { session.printError('File not found: ' + arg); return; }

      const sender = T.getUsername() || peer.id;
      const data = { type: 'file', filename: arg, content: file.content, sender };

      if (isHost) {
        session.printSystem(`\n[You] sent file: ${arg}\n`);
        connections.forEach(c => { if (c.open) c.send(data); });
      } else if (hostConn && hostConn.open) {
        session.printSystem(`\n[You] sent file: ${arg}\n`);
        hostConn.send(data);
      } else {
        session.printError('Not connected to host.');
      }
      return;
    }

    if (cmd === 'P2P_LEAVE') {
      leaveRoom(session);
      return;
    }

    if (cmd === 'P2P_STATUS') {
      session.printSystem(`Room: ${myRoom || 'None'}`);
      session.printSystem(`Role: ${isHost ? 'Host' : (hostConn ? 'Client' : 'None')}`);
      if (isHost) session.printSystem(`Connections: ${connections.length}`);
      return;
    }
  }

  T.registerExtension({
    name: 'p2p',
    info: 'Peer-to-Peer Room Chat imported successfully!',
    commands: {
      P2P_INIT: function() { return handleP2P(this, 'P2P_INIT'); },
      P2P_JOIN: function(arg) { return handleP2P(this, 'P2P_JOIN', arg); },
      P2P_MSG: function(arg) { return handleP2P(this, 'P2P_MSG', arg); },
      P2P_FILE: function(arg) { return handleP2P(this, 'P2P_FILE', arg); },
      P2P_LEAVE: function() { return handleP2P(this, 'P2P_LEAVE'); },
      P2P_STATUS: function() { return handleP2P(this, 'P2P_STATUS'); }
    }
  });
})();