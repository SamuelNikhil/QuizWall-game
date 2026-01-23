import geckos from '@geckos.io/server';

const io = geckos({
  cors: { origin: '*' }
});

// Rooms: roomId -> { screenChannel, controllers: [] }
const rooms = new Map();

// Track connection timeouts
const connectionTimeouts = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.onConnection((channel) => {
  console.log(`[Geckos] Client connected: ${channel.id}`);

  // Set timeout to detect hanging handshakes
  const timeoutId = setTimeout(() => {
    const timeout = connectionTimeouts.get(channel.id);
    if (timeout) {
      console.log(`[WARNING] Client ${channel.id} handshake timeout - possible issues:`);
      console.log(`  - WebRTC data channel never opened`);
      console.log(`  - ICE negotiation failed (check STUN/TURN servers)`);
      console.log(`  - Network blocking WebRTC (corporate firewall/VPN)`);
      console.log(`  - Client-side JavaScript errors`);
      console.log(`  - Server not receiving 'createRoom' or 'joinRoom' events`);
      connectionTimeouts.delete(channel.id);
    }
  }, 15000); // 15 second timeout

  connectionTimeouts.set(channel.id, timeoutId);

  channel.on('createRoom', () => {
    // Clear timeout on successful room creation
    const timeoutId = connectionTimeouts.get(channel.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      connectionTimeouts.delete(channel.id);
    }

    const roomId = generateRoomId();
    rooms.set(roomId, { screenChannel: channel, controllers: [] });
    channel.userData = { role: 'screen', roomId };
    channel.emit('roomCreated', { roomId });
    console.log(`[Room] Created: ${roomId}`);
  });

  channel.on('joinRoom', (data) => {
    // Clear timeout on successful room join
    const timeoutId = connectionTimeouts.get(channel.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      connectionTimeouts.delete(channel.id);
    }

    const { roomId } = data;
    const room = rooms.get(roomId);
    if (room) {
      room.controllers.push(channel);
      channel.userData = { role: 'controller', roomId };
      channel.emit('joinedRoom', { roomId, success: true });
      room.screenChannel.emit('controllerJoined', { controllerId: channel.id });
      console.log(`[Room] Controller ${channel.id} joined ${roomId}`);
    } else {
      channel.emit('joinedRoom', { roomId, success: false, error: 'Room not found' });
    }
  });

  // Controller sends aim updates (high frequency, UDP-like)
  channel.on('aim', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('aim', { controllerId: channel.id, ...data }, { reliable: false });
    }
  });

  // Controller sends shoot event
  channel.on('shoot', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('shoot', { controllerId: channel.id, ...data });
    }
  });

  // Screen sends hit result back to controller
  channel.on('hitResult', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room) {
      const target = room.controllers.find(c => c.id === data.controllerId);
      if (target) {
        target.emit('hitResult', data);
      }
    }
  });

  // Crosshair events for gyro aiming
  channel.on('crosshair', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('crosshair', { controllerId: channel.id, ...data }, { reliable: false });
    }
  });

  channel.on('startAiming', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('startAiming', { controllerId: channel.id, ...data });
    }
  });

  channel.on('cancelAiming', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('cancelAiming', { controllerId: channel.id });
    }
  });

  channel.on('targeting', (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit('targeting', { controllerId: channel.id, ...data });
    }
  });

  channel.onDisconnect(() => {
    // Clear timeout on disconnect
    const timeoutId = connectionTimeouts.get(channel.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      connectionTimeouts.delete(channel.id);
    }

    const { role, roomId } = channel.userData || {};
    if (role === 'screen' && roomId) {
      rooms.delete(roomId);
      console.log(`[Room] Deleted: ${roomId}`);
    } else if (role === 'controller' && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.controllers = room.controllers.filter(c => c.id !== channel.id);
        room.screenChannel.emit('controllerLeft', { controllerId: channel.id });
      }
    }
    console.log(`[Geckos] Client disconnected: ${channel.id}`);
  });
});

const PORT = process.env.PORT || 3000;
io.listen(PORT);
console.log(`Slingshot Geckos.io server running on port ${PORT}`);
