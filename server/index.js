import geckos from "@geckos.io/server";

import { randomBytes } from "crypto";

const io = geckos({
  iceServers: [
    { urls: "stun:stun.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "admin",
      credential: "admin",
    },
  ],
});

// Rooms: roomId -> { screenChannel, controllers: [], joinToken }
const rooms = new Map();

function generateToken() {
  return randomBytes(16).toString("hex");
}

// Track connection timeouts
const connectionTimeouts = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.onConnection((channel) => {
  console.log(`[Geckos] New client connected: ${channel.id}`);

  // Set timeout to detect hanging handshakes
  const timeoutId = setTimeout(() => {
    const timeout = connectionTimeouts.get(channel.id);
    if (timeout) {
      console.log(
        `[WARNING] Client ${channel.id} handshake timeout - possible issues:`,
      );
      console.log(`  - WebRTC data channel never opened`);
      console.log(`  - ICE negotiation failed (check STUN/TURN servers)`);
      console.log(`  - Network blocking WebRTC (corporate firewall/VPN)`);
      console.log(`  - Client-side JavaScript errors`);
      console.log(`  - Server not receiving 'createRoom' or 'joinRoom' events`);
      connectionTimeouts.delete(channel.id);
    }
  }, 15000); // 15 second timeout

  connectionTimeouts.set(channel.id, timeoutId);

  channel.on("createRoom", () => {
    console.log(`[Room] Received createRoom from: ${channel.id}`);
    // Clear timeout on successful room creation
    const timeoutId = connectionTimeouts.get(channel.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      connectionTimeouts.delete(channel.id);
    }

    const roomId = generateRoomId();
    const joinToken = generateToken();
    rooms.set(roomId, { screenChannel: channel, controllers: [], joinToken });
    channel.userData = { role: "screen", roomId };
    channel.emit("roomCreated", { roomId, joinToken });
    console.log(`[Room] Created: ${roomId} with token: ${joinToken}`);
  });

  channel.on("joinRoom", (data) => {
    console.log(
      `[Room] Received joinRoom from: ${channel.id} for roomId: ${data?.roomId}`,
    );
    // Clear timeout on successful room join
    const timeoutId = connectionTimeouts.get(channel.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      connectionTimeouts.delete(channel.id);
    }

    const { roomId, token } = data;
    const room = rooms.get(roomId);

    if (!room) {
      console.log(
        `[Room] Join failed: Room ${roomId} not found. Active rooms:`,
        Array.from(rooms.keys()),
      );
      channel.emit("joinedRoom", {
        roomId,
        success: false,
        error: "Room not found",
      });
      return;
    }

    if (room.joinToken !== token) {
      channel.emit("joinedRoom", {
        roomId,
        success: false,
        error: "Invalid token",
      });
      console.log(
        `[Room] Controller ${channel.id} rejected from ${roomId}: Invalid token`,
      );
      return;
    }

    if (room.controllers.length >= 1) {
      channel.emit("joinedRoom", {
        roomId,
        success: false,
        error: "Room is full",
      });
      console.log(
        `[Room] Controller ${channel.id} rejected from ${roomId}: Room full`,
      );
      return;
    }

    room.controllers.push(channel);
    channel.userData = { role: "controller", roomId };
    channel.emit("joinedRoom", { roomId, success: true });
    room.screenChannel.emit("controllerJoined", { controllerId: channel.id });
    console.log(`[Room] Controller ${channel.id} joined ${roomId}`);
  });

  // Controller sends aim updates (high frequency, UDP-like)
  channel.on("aim", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit(
        "aim",
        { controllerId: channel.id, ...data },
        { reliable: false },
      );
    }
  });

  // Controller sends shoot event
  channel.on("shoot", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit("shoot", { controllerId: channel.id, ...data });
    }
  });

  // Screen sends hit result back to controller
  channel.on("hitResult", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room) {
      const target = room.controllers.find((c) => c.id === data.controllerId);
      if (target) {
        target.emit("hitResult", data);
      }
    }
  });

  // Crosshair events for gyro aiming
  channel.on("crosshair", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit(
        "crosshair",
        { controllerId: channel.id, ...data },
        { reliable: false },
      );
    }
  });

  channel.on("startAiming", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit("startAiming", {
        controllerId: channel.id,
        ...data,
      });
    }
  });

  channel.on("cancelAiming", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit("cancelAiming", { controllerId: channel.id });
    }
  });

  channel.on("targeting", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit("targeting", {
        controllerId: channel.id,
        ...data,
      });
    }
  });

  // Game over event from screen to all controllers in room
  channel.on("gameOver", (data) => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room) {
      room.controllers.forEach((ctrl) => {
        ctrl.emit("gameOver", data);
      });
    }
  });

  // Game restarted event from screen to all controllers in room
  channel.on("gameRestarted", () => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room) {
      room.controllers.forEach((ctrl) => {
        ctrl.emit("gameRestarted");
      });
    }
  });

  // Restart game event from controller to screen
  channel.on("restartGame", () => {
    const { roomId } = channel.userData || {};
    const room = rooms.get(roomId);
    if (room && room.screenChannel) {
      room.screenChannel.emit("restartGame");
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
    if (role === "screen" && roomId) {
      rooms.delete(roomId);
      console.log(`[Room] Deleted: ${roomId}`);
    } else if (role === "controller" && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.controllers = room.controllers.filter((c) => c.id !== channel.id);
        room.screenChannel.emit("controllerLeft", { controllerId: channel.id });
      }
    }
    console.log(`[Geckos] Client disconnected: ${channel.id}`);
  });
});

const PORT = process.env.PORT || 3000;
io.listen(PORT);
console.log(`Slingshot Geckos.io server running on port ${PORT}`);
