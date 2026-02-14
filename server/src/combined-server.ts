// ==========================================
// Combined Server Entry Point
// Serves both API + Static files (for single Render deployment)
// ==========================================

import geckos from '@geckos.io/server';
import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { CONFIG } from './infrastructure/config.ts';
import { initDatabase } from './data/database.ts';
import { RoomManager } from './domain/RoomManager.ts';
import { registerEventHandlers } from './transport/eventHandlers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    // 1. Initialize database
    console.log('[Boot] Initializing database...');
    await initDatabase();

    // 2. Create Express app for HTTP + static files
    const app = express();
    app.use(cors());
    
    // Serve static files from client/dist
    const clientDistPath = path.join(__dirname, '../client/dist');
    app.use(express.static(clientDistPath));
    
    // 3. Create HTTP server with Express
    const server = http.createServer(app);

    // 4. Create Geckos.io server
    const io = geckos({
        iceServers: [...CONFIG.ICE_SERVERS],
        portRange: { min: CONFIG.UDP_PORT_MIN, max: CONFIG.UDP_PORT_MAX },
        cors: { allowAuthorization: false, origin: '*' },
    });
    console.log(`[Boot] Geckos.io UDP port range: ${CONFIG.UDP_PORT_MIN}-${CONFIG.UDP_PORT_MAX}`);

    // 5. Wire up domain layer
    const roomManager = new RoomManager();
    registerEventHandlers(io, roomManager);

    // 6. Attach Geckos.io to HTTP server
    io.addServer(server);

    // 7. SPA fallback - serve index.html for all non-API routes
    app.get('*', (req, res) => {
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });

    // 8. Start server
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`[Boot] Server listening on 0.0.0.0:${CONFIG.PORT}`);
        console.log(`[Boot] Static files: ${clientDistPath}`);
    });
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});
