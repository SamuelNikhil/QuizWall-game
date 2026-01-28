# 🎯 Slingshot Multiplayer

A real-time slingshot Quiz game built with **VITE-React** and **Geckos.io** (WebRTC).

## 🚀 Quick Start (Local)

1. **Server**: `cd server && npm install && npm run dev` (Runs on :3000)
2. **Client**: `cd client && npm install && npm run dev` (Runs on :5173)

## �️ Architecture
- **Client**: Hosting server.
- **Game Server**: Node.js server with UDP support.
- **Networking**: Direct connection between client and server IP for 0-latency signaling.

## ⚙️ Configuration
Update `client/.env`:
- `VITE_SERVER_URL`: Your server IP or url 
- `VITE_USE_PROXY`: `false` for direct connection (fastest).

## 🎮 How to Play
1. Open the game on a computer (The Screen).
2. Scan/Open the URL on mobile phones (The Controllers).
3. Join the room code and tilt your phone to aim!

---
*Note: Deployment config files (`_redirects`, `.htaccess`) are auto-included in `client/public`.*
