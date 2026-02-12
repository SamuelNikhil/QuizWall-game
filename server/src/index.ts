// ==========================================
// Server Entry Point
// Geckos.io standalone mode (same as original)
// ==========================================

import geckos from '@geckos.io/server';
import { CONFIG } from './infrastructure/config.ts';
import { initDatabase } from './data/database.ts';
import { RoomManager } from './domain/RoomManager.ts';
import { registerEventHandlers } from './transport/eventHandlers.ts';

async function main() {
    // 1. Initialize database (async for sql.js WASM loading)
    console.log('[Boot] Initializing database...');
    await initDatabase();

    // 2. Create Geckos.io server with CORS for cross-origin
    const io = geckos({
        iceServers: [...CONFIG.ICE_SERVERS],
        cors: { allowAuthorization: false, origin: '*' },
    });

    // 3. Create domain manager and wire transport
    const roomManager = new RoomManager();
    registerEventHandlers(io, roomManager);

    // 4. Start listening — geckos creates its own HTTP server
    //    with signaling routes at /.wrtc/v2/*
    io.listen(CONFIG.PORT);
    console.log(`[Boot] Slingshot server running on port ${CONFIG.PORT}`);
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});
