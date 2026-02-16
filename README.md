
# 🎯 Slingshot Quiz Game

A real-time multiplayer slingshot quiz game built with **Vite + React**, **TypeScript**, and **WebRTC**. Players use their mobile devices as controllers with a slingshot mechanic and gyroscope aiming to answer quiz questions on a main screen.

## 🚀 Quick Start

### Local Development

1. **Server**: 
   ```bash
   cd server
   npm install
   npm run dev
   ```
   Runs on `http://localhost:3000`

2. **Client**: 
   ```bash
   cd client
   npm install
   npm run dev
   ```
   Runs on `http://localhost:5173`

### Production Build

```bash
# Build server
cd server
npm run build
npm start

# Build client
cd client
npm run preview
```

## 🏗️ Architecture

- **Client (Vite + React)**: Hosts the game screen and controller UI
- **Game Server (Node.js + TypeScript)**: Handles game logic, room management, and quiz engine
- **Database**: SQLite for persistent team scores and leaderboard
- **Networking**: WebSocket-based real-time communication with WebRTC support

### Project Structure

```
QuizWall-game/
├── client/          # React + TypeScript frontend
│   ├── src/
│   │   ├── pages/   # Screen, Controller, Lobby
│   │   ├── shared/  # Types and protocol
│   │   └── transport/ # GameClient
├── server/          # Node.js + TypeScript backend
│   ├── src/
│   │   ├── domain/  # Game logic (QuizEngine, RoomManager)
│   │   ├── data/    # Database and repositories
│   │   └── transport/ # Event handlers
```

## ⚙️ Configuration

### Client Environment (`client/.env`)

```env
VITE_SERVER_URL=http://localhost:3000
VITE_USE_PROXY=false
```

- `VITE_SERVER_URL`: Your server IP or URL
- `VITE_USE_PROXY`: Set to `false` for direct connection (lowest latency)

### Server Configuration

Server runs on port `3000` by default. Configure via environment variables or `server/src/infrastructure/config.ts`.

## 🎮 How to Play

1. **Start the game** on a computer/laptop (The Screen)
2. **Open the controller URL** on mobile phones (The Controllers)
   - Scan QR code or enter room code manually
3. **Join the room** with your team
4. **Ready up** and start the game
5. **Aim and shoot**:
   - **Touch**: Pull back the slingshot to aim, release to shoot
   - **Gyroscope**: Tilt your phone to aim (HTTPS required)
6. **Answer questions** by hitting the correct answer orb
7. **Compete** for the highest score before time runs out!

## 🎯 Game Features

- 🎮 **Slingshot Mechanic**: Pull-to-aim, release-to-shoot gameplay
- 📱 **Gyroscope Support**: Tilt-to-aim on supported devices (iOS/Android)
- 🏆 **Leaderboard System**: Persistent team scores across sessions
- ⏱️ **Real-time Timer**: Synchronized countdown across all clients
- 🎨 **Modern UI**: Glassmorphism design with smooth animations
- 🔊 **Sound Effects**: Audio feedback for hits and game events

## 🐳 Docker Deployment

### Build and Run Locally

```bash
cd server
docker build -t slingshot-server .
docker run -p 3000:3000 slingshot-server
```

### AWS EC2 Deployment

1. **Push to Docker Hub** or use AWS ECR
2. **Launch EC2 instance** (Amazon Linux 2/Ubuntu)
3. **Install Docker** on EC2
4. **Pull and run** the container
5. **Configure security groups** for ports 3000 (TCP) and 9000-9100 (UDP)

```bash
# On EC2
docker pull <your-image>
docker run -d -p 3000:3000 -p 9000-9100:9000-9100/udp slingshot-server
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **Backend** | Node.js, TypeScript, tsx |
| **Database** | SQLite (Better-SQLite3) |
| **Styling** | CSS3, Glassmorphism |
| **Deployment** | Docker, AWS EC2 |

## 📝 Development Notes

- **Hot Reload**: Server uses `tsx watch` for auto-restart on changes
- **Type Safety**: Shared types between client/server in `src/shared/types.ts`
- **State Management**: React hooks with refs for game state
- **Mobile First**: Controller optimized for touch and gyroscope input

## 🔧 Troubleshooting

### Connection Issues
- Ensure `VITE_SERVER_URL` points to correct server IP
- Check firewall/security group settings for port 3000
- Use HTTPS for gyroscope permissions on mobile

### Gyroscope Not Working
- Requires HTTPS (except localhost)
- iOS 13+ requires permission request (handled automatically)
- Check device orientation permissions in browser settings

### Database Reset
- Delete the SQLite file to reset all data
- Database auto-creates on server startup

---

**Built with ❤️ for interactive quiz experiences**



