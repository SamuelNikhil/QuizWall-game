# AWS EC2 WebRTC Connection Troubleshooting Guide

## Problem Overview
WebRTC applications work perfectly in local development but fail when deployed to AWS EC2. The data channel never opens, causing handshake timeouts and connection failures.

## Root Cause Analysis

### Why Local Works but AWS Doesn't
- **Local Development**: Same network = direct P2P connections possible
- **AWS Deployment**: Different networks = NAT/firewall blocking direct WebRTC connections
- **ICE Negotiation Failure**: Clients cannot establish direct peer-to-peer connection

### Common Symptoms
- `[SCREEN] Handshake timeout` errors
- `WebRTC data channel never opened` messages
- HTTP signaling works (200 OK) but WebRTC fails
- QR code displays but no controller can connect

## Solution Implementation

### 1. Matching ICE Server Configuration

**Critical**: Client and server MUST use identical ICE servers.

```javascript
// Both client (Screen.jsx, Controller.jsx) and server (index.js)
iceServers: [
  { urls: 'stun:stun.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: 'admin',
    credential: 'admin'
  }
]
```

### 2. Network Configuration

#### Client Configuration
```javascript
// client/src/config/network.js
export function getServerConfig() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
  const connectionPort = import.meta.env.VITE_SERVER_PORT || 3000;
  
  // Force HTTPS for production
  if (import.meta.env.PROD && serverUrl.startsWith('http://')) {
    serverUrl = serverUrl.replace('http://', 'https://');
  }
  
  return { serverUrl, connectionPort };
}
```

#### Environment Variables
```bash
# client/.env
VITE_SERVER_URL=http://43.205.110.159
VITE_SERVER_PORT=3000
```

### 3. Debug Infrastructure

#### Handshake Timeout Detection
```javascript
// Client-side (Screen.jsx, Controller.jsx)
const handshakeTimeout = setTimeout(() => {
  if (!connectedRef.current) {
    console.error('[HANDSHAKE TIMEOUT] Possible issues:');
    console.error('  - WebRTC data channel never opened');
    console.error('  - ICE negotiation failed');
    console.error('  - Network blocking WebRTC');
    console.error('  - STUN/TURN servers unreachable');
  }
}, 15000);

// Clear timeout on success
io.on('open', () => {
  clearTimeout(handshakeTimeout);
  console.log('🎮 data channel open');
});
```

```javascript
// Server-side (server/index.js)
const connectionTimeouts = new Map();

io.onConnection((channel) => {
  const timeoutId = setTimeout(() => {
    console.log(`[WARNING] Client ${channel.id} handshake timeout`);
    console.log('  - WebRTC data channel never opened');
    console.log('  - ICE negotiation failed');
  }, 15000);
  
  connectionTimeouts.set(channel.id, timeoutId);
  
  // Clear timeout on room events
  channel.on('createRoom', () => {
    clearTimeout(connectionTimeouts.get(channel.id));
    connectionTimeouts.delete(channel.id);
  });
});
```

### 4. Production Docker Setup

#### Dockerfile
```dockerfile
# Multi-stage build for production
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SERVER_URL
ARG VITE_SERVER_PORT
ENV VITE_SERVER_URL=${VITE_SERVER_URL:-http://localhost:3000}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT:-3000}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
```

#### nginx.conf
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    
    # WebRTC signaling proxy
    location /.wrtc/ {
        proxy_pass http://$VITE_SERVER_URL:$VITE_SERVER_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
    
    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Step-by-Step Fix Process

### 1. Update ICE Servers
```bash
# Update all three files:
# - client/src/pages/Screen.jsx
# - client/src/pages/Controller.jsx  
# - server/index.js
```

### 2. Configure Environment
```bash
# Set EC2 IP in .env
echo "VITE_SERVER_URL=http://YOUR_EC2_PUBLIC_IP" > client/.env
```

### 3. Deploy Server
```bash
# On EC2 instance
npm install
npm start  # Should run on port 3000
```

### 4. Test Connection
```bash
# Check signaling endpoint
curl http://YOUR_EC2_IP:3000/.wrtc

# Should return 200 OK
```

### 5. Verify WebRTC
1. Open browser console
2. Look for `🎮 data channel open`
3. If timeout occurs, check ICE server configuration

## Alternative TURN Servers

If metered.ca doesn't work, try these alternatives:

```javascript
// Option 1: OpenRelay
{
  urls: 'turn:openrelay.metered.ca:80',
  username: 'openrelayproject',
  credential: 'openrelayproject'
}

// Option 2: Twilio (requires account)
{
  urls: 'turn:global.turn.twilio.com:443?transport=tcp',
  username: 'YOUR_TWILIO_ACCOUNT_SID',
  credential: 'YOUR_TWILIO_AUTH_TOKEN'
}
```

## Network Debugging Commands

### Test Connectivity
```bash
# Test STUN server
nc -zv stun.metered.ca 80

# Test TURN server
nc -zv global.relay.metered.ca 443

# Test your EC2 server
curl -I http://YOUR_EC2_IP:3000/.wrtc
```

### Browser Debugging
```javascript
// Check WebRTC state in browser console
console.log('RTCPeerConnection state:', pc.connectionState);
console.log('ICE connection state:', pc.iceConnectionState);
console.log('Data channel state:', pc.dataChannels[0]?.readyState);
```

## Common Issues & Solutions

### Issue: TURN Server Authentication Failed
**Solution**: Verify username/password match between client and server

### Issue: Mixed Content (HTTP/HTTPS)
**Solution**: Use HTTPS in production or serve everything over HTTP

### Issue: Corporate Firewall Blocking WebRTC
**Solution**: Use TURN server on port 443 (HTTPS port)

### Issue: EC2 Security Group Blocking Ports
**Solution**: Open inbound ports 80, 443, 3000 in security group

## Production Deployment Checklist

- [ ] Matching ICE servers on client and server
- [ ] Environment variables configured
- [ ] EC2 security groups allow required ports
- [ ] HTTPS certificates for production
- [ ] TURN server authentication working
- [ ] Handshake timeout logging implemented
- [ ] Docker configuration tested
- [ ] Nginx proxy configured for WebRTC

## Monitoring & Maintenance

### Health Checks
```bash
# Server health
curl http://YOUR_EC2_IP:3000/health

# Client health
curl http://YOUR_CLIENT_DOMAIN/health
```

### Log Monitoring
```bash
# Server logs
tail -f /var/log/app.log

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## Performance Optimization

1. **Use CDN** for static assets
2. **Enable gzip** compression
3. **Cache static files** long-term
4. **Monitor TURN server** usage and costs
5. **Implement connection pooling** for multiple game servers

---

## Quick Reference Commands

```bash
# Build Docker image
docker build --build-arg VITE_SERVER_URL=http://YOUR_EC2_IP -t slingshot-client .

# Run container
docker run -p 80:80 -p 443:443 slingshot-client

# Test WebRTC connection
# 1. Open browser to your app
# 2. Check console for "🎮 data channel open"
# 3. If timeout, check ICE server configuration
```

This guide should help resolve WebRTC connection issues on AWS EC2 and similar cloud deployments.
