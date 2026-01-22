# 🚀 Slingshot Network Server Startup Guide

## 📋 Step-by-Step Setup

### 1. Start the Network Server (Geckos.io WebSocket Server)
```bash
cd "d:\My Projects\Latch\slingshot demo\server"
npm start
```

**Expected Output:**
```
Slingshot Geckos.io server running on port 3000
```

**Alternative (Development Mode with Auto-Restart):**
```bash
cd "d:\My Projects\Latch\slingshot demo\server"
npm run dev
```

**Expected Output:**
```
Slingshot Geckos.io server running on port 3000
[Watching for file changes...]
```

### 2. Start the Client Application (React Web App)
```bash
cd "d:\My Projects\Latch\slingshot demo\client"
npm run dev -- --host
```

**Expected Output:**
```
VITE v7.2.4  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.X.X:5173/
➜  press h + enter to show help
```

---

## 📱 How It Works

1. **Server (Port 3000)**: Handles real-time communication between game screens and mobile controllers using Geckos.io
2. **Client (Port 5173)**: React web application that serves both the game screen and mobile controller interfaces

## 🌐 Network Access

- **Server**: `http://localhost:3000` (or `http://YOUR_IP:3000` for network access)
- **Client**: `http://localhost:5173` (or `http://YOUR_IP:5173` for network access)

## 📋 Prerequisites

Make sure you have Node.js installed, then run:

```bash
# Install server dependencies
cd "d:\My Projects\Latch\slingshot demo\server"
npm install

# Install client dependencies  
cd "d:\My Projects\Latch\slingshot demo\client"
npm install
```

## 🎮 Usage

1. Start both servers as shown above
2. Open the client URL in a web browser on your desktop/game screen
3. Create a room to get a room code
4. Open the same client URL on mobile phones
5. Join the room using the room code
6. Use mobile phones as controllers to aim and shoot in the game

---

*Note: The ai-service folder is skipped as requested.*
