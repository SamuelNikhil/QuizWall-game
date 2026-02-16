// ==========================================
// Server Entry Point
// Geckos.io standalone mode (same as original)
// ==========================================

import geckos from '@geckos.io/server';
import http from 'http';
import { CONFIG } from './infrastructure/config.ts';
import { initDatabase } from './data/database.ts';
import { RoomManager } from './domain/RoomManager.ts';
import { registerEventHandlers } from './transport/eventHandlers.ts';
import { getAllTeamsDebug, debugDbPath } from './data/teamRepository.ts';

async function main() {
    // 1. Initialize database (async for sql.js WASM loading)
    console.log('[Boot] Initializing database...');
    await initDatabase();

    // Debug: Log DB path and current teams
    debugDbPath();
    const teams = getAllTeamsDebug();
    console.log('[Boot] Current teams in DB:', teams);

    // 2. Create HTTP server (DO NOT listen yet - routes must be registered first)
    const server = http.createServer();

    // 3. Create Geckos.io server with CORS for cross-origin
    //    Signaling path is /.wrtc/v2 by default in v3
    const io = geckos({
        iceServers: [...CONFIG.ICE_SERVERS],
        cors: { allowAuthorization: false, origin: '*' },
        // path: '/.wrtc/v2', // Uncomment if you need to customize the path
    });

    // 4. Create domain manager and wire transport
    const roomManager = new RoomManager();
    registerEventHandlers(io, roomManager);

    // 5. Attach Geckos.io to the HTTP server (registers signaling routes)
    //    MUST be called BEFORE server.listen()
    io.addServer(server);

    // 6. NOW start listening on 0.0.0.0 for Docker/EC2 access
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`[Boot] HTTP server listening on 0.0.0.0:${CONFIG.PORT}`);
    });
    console.log(`[Boot] Slingshot server running on port ${CONFIG.PORT} (bound to 0.0.0.0)`);
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});
