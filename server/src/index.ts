// ==========================================
// Server Entry Point
// Geckos.io standalone mode
// ==========================================

import 'dotenv/config';
import geckos from '@geckos.io/server';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { CONFIG } from './infrastructure/config.ts';
import { initDatabase } from './data/database.ts';
import { RoomManager } from './domain/RoomManager.ts';
import { registerEventHandlers } from './transport/eventHandlers.ts';
import { PlayerManager } from './domain/PlayerManager.ts';
import { initializeGroqService, isGroqEnabled } from './modes/ShootQuiz/GroqService.ts';
import { clearAllSessionQuestions } from './modes/ShootQuiz/questionRepository.ts';
import { ShootQuizPlugin } from './modes/ShootQuiz/ShootQuizPlugin.ts';

async function main() {
    // 0. Clean up any leftover Quizwall_*.json files from a previous server run
    clearAllSessionQuestions();
    console.log('[Boot] Cleaned up leftover room question cache files');

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

    // 2. Initialize database (async for sql.js WASM loading)
    console.log('[Boot] Initializing database...');
    await initDatabase();

    // Debug: Log top players in DB at boot
    const topPlayers = PlayerManager.getPlayerLeaderboard(10);
    console.log('[Boot] Top players in DB:', topPlayers.length);

    // 3. Create Express app for HTTP + admin API
    const app = express();
    app.use(cors());
    app.use(express.json());

    // 4. Create domain manager
    const roomManager = new RoomManager();
    const shootQuizPlugin = new ShootQuizPlugin(roomManager);

    // ── Admin monitoring API ──────────────────────────────────────────
    const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

    const getRoomTopics = (roomId: string): { topicVotes: Record<string, string>; totalVoters: number } => {
        const state = shootQuizPlugin.getState(roomId);
        if (!state) return { topicVotes: {}, totalVoters: 0 };
        // Use persisted vote count after topic selection ends, or current votes during selection
        const totalVoters = state.topicSelectionStarted ? state.topicVotes.size : state.finalVoteCount;
        const playerVotes: Record<string, string> = {};
        for (const [clientId, topicId] of state.topicVotes) {
            playerVotes[clientId] = topicId;
        }
        return { topicVotes: playerVotes, totalVoters };
    };

    app.get('/api/admin/status', (req, res) => {
        if (ADMIN_SECRET && req.headers['authorization'] !== `Bearer ${ADMIN_SECRET}`) {
            res.status(401).json({ code: 'unauthorized', message: 'Invalid or missing admin secret' });
            return;
        }
        const status = roomManager.getAdminStatus(getRoomTopics);
        res.json(status);
    });

    app.get('/api/admin/analytics', (req, res) => {
        if (ADMIN_SECRET && req.headers['authorization'] !== `Bearer ${ADMIN_SECRET}`) {
            res.status(401).json({ code: 'unauthorized', message: 'Invalid or missing admin secret' });
            return;
        }
        const analytics = roomManager.getAdminAnalytics(getRoomTopics);
        res.json(analytics);
    });

    // 5. Create HTTP server (DO NOT listen yet - routes must be registered first)
    const server = http.createServer(app);

    // 6. Create Geckos.io server with CORS for cross-origin
    const io = geckos({
        iceServers: [...CONFIG.ICE_SERVERS],
        portRange: { min: CONFIG.UDP_PORT_MIN, max: CONFIG.UDP_PORT_MAX },
        cors: { allowAuthorization: false, origin: '*' },
    });
    console.log(`[Boot] Geckos.io UDP port range: ${CONFIG.UDP_PORT_MIN}-${CONFIG.UDP_PORT_MAX}`);

    // 7. Wire up transport
    registerEventHandlers(io, roomManager);

    // 8. Attach Geckos.io to the HTTP server (registers signaling routes)
    io.addServer(server);

    // 9. NOW start listening on 0.0.0.0 for Docker/EC2 access
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`[Boot] HTTP server listening on 0.0.0.0:${CONFIG.PORT}`);
        console.log(`[Boot] Admin status endpoint: GET /api/admin/status`);
    });
    console.log(`[Boot] Slingshot server running on port ${CONFIG.PORT} (bound to 0.0.0.0)`);
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});