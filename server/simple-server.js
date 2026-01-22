import express from 'express';
import { createServer } from 'http';
import { Server } from 'ws';

const app = express();
const server = createServer(app);
const wss = new Server({ server });

// Rooms: roomId -> { screenSocket, controllers: [] }
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
  console.log(`[WebSocket] Client connected`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'createRoom':
          const roomId = generateRoomId();
          rooms.set(roomId, { screenSocket: ws, controllers: [] });
          ws.roomId = roomId;
          ws.role = 'screen';
          ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
          console.log(`[Room] Created: ${roomId}`);
          break;

        case 'joinRoom':
          const { roomId: joinRoomId } = message;
          const room = rooms.get(joinRoomId);
          if (room) {
            room.controllers.push(ws);
            ws.roomId = joinRoomId;
            ws.role = 'controller';
            ws.send(JSON.stringify({ type: 'joinedRoom', roomId: joinRoomId, success: true }));
            room.screenSocket.send(JSON.stringify({ type: 'controllerJoined', controllerId: ws.id }));
            console.log(`[Room] Controller joined ${joinRoomId}`);
          } else {
            ws.send(JSON.stringify({ type: 'joinedRoom', roomId: joinRoomId, success: false, error: 'Room not found' }));
          }
          break;

        case 'aim':
        case 'shoot':
        case 'crosshair':
        case 'startAiming':
        case 'cancelAiming':
        case 'targeting':
        case 'hitResult':
          const targetRoom = rooms.get(ws.roomId);
          if (targetRoom && targetRoom.screenSocket) {
            targetRoom.screenSocket.send(JSON.stringify({ ...message, controllerId: ws.id }));
          }
          break;
      }
    } catch (error) {
      console.error('Message error:', error);
    }
  });

  ws.on('close', () => {
    const { role, roomId } = ws;
    if (role === 'screen' && roomId) {
      rooms.delete(roomId);
      console.log(`[Room] Deleted: ${roomId}`);
    } else if (role === 'controller' && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.controllers = room.controllers.filter(c => c !== ws);
        room.screenSocket.send(JSON.stringify({ type: 'controllerLeft', controllerId: ws.id }));
      }
    }
    console.log(`[WebSocket] Client disconnected`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Simple WebSocket server running on port ${PORT}`);
});
