// ==========================================
// Combined Server Entry Point
// Serves both API + Static files (for single Render deployment)
// ==========================================

import 'dotenv/config';
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
import { initializeGroqService } from './modes/ShootQuiz/GroqService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    // 1. Initialize Groq AI service (if API key is configured)
    if (CONFIG.AI_ENABLED) {
        console.log('[Boot] Initializing Groq AI service...');
        initializeGroqService({
            apiKey: CONFIG.GROQ_API_KEY,
            model: CONFIG.GROQ_MODEL,
            questionCount: CONFIG.QUESTIONS_PER_SESSION,
        });
        console.log(`[Boot] Groq AI enabled (topics selected per room)`);
    } else {
        console.log('[Boot] Groq AI not enabled - using static JSON questions');
    }

    // 2. Initialize database
    console.log('[Boot] Initializing database...');
    await initDatabase();

    // 2. Create Express app for HTTP + static files
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Serve static files from client/dist
    const clientDistPath = path.join(__dirname, '../client/dist');
    app.use(express.static(clientDistPath));

    // 3. Create domain manager (needs to be accessible by both Geckos and Express)
    const roomManager = new RoomManager();

    // ── Admin monitoring API ──────────────────────────────────────────
    const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

    app.get('/api/admin/status', (req, res) => {
        if (ADMIN_SECRET && req.headers['authorization'] !== `Bearer ${ADMIN_SECRET}`) {
            res.status(401).json({ code: 'unauthorized', message: 'Invalid or missing admin secret' });
            return;
        }
        const status = roomManager.getAdminStatus();
        res.json(status);
    });

    app.get('/api/admin/analytics', (req, res) => {
        if (ADMIN_SECRET && req.headers['authorization'] !== `Bearer ${ADMIN_SECRET}`) {
            res.status(401).json({ code: 'unauthorized', message: 'Invalid or missing admin secret' });
            return;
        }
        const analytics = roomManager.getAdminAnalytics();
        res.json(analytics);
    });

    // 4. Create HTTP server with Express
    const server = http.createServer(app);

    // 5. Create Geckos.io server
    const io = geckos({
        iceServers: [...CONFIG.ICE_SERVERS],
        portRange: { min: CONFIG.UDP_PORT_MIN, max: CONFIG.UDP_PORT_MAX },
        cors: { allowAuthorization: false, origin: '*' },
    });
    console.log(`[Boot] Geckos.io UDP port range: ${CONFIG.UDP_PORT_MIN}-${CONFIG.UDP_PORT_MAX}`);

    // 6. Wire up domain layer
    registerEventHandlers(io, roomManager);

    // 7. Attach Geckos.io to HTTP server
    io.addServer(server);

    // 8. SPA fallback - serve index.html for all non-API routes
    app.get('*', (_req, res) => {
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });

    // 9. Start server
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`[Boot] Server listening on 0.0.0.0:${CONFIG.PORT}`);
        console.log(`[Boot] Static files: ${clientDistPath}`);
        console.log(`[Boot] Admin status endpoint: GET /api/admin/status`);
    });
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});