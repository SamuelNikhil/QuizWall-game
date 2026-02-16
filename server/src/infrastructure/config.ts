// ==========================================
// Server Configuration
// ==========================================

import { resolve } from 'path';

const PROJECT_ROOT = resolve(import.meta.dirname || '.', '..', '..');

export const CONFIG = {
    PORT: parseInt(process.env.PORT || '3000', 10),

    /** Path to SQLite database file - absolute path */
    DB_PATH: process.env.DB_PATH || resolve(PROJECT_ROOT, 'QuizzWall.sqlite'),

    /** Path to Questions JSON file */
    QUESTIONS_PATH: process.env.QUESTIONS_PATH || './src/data/questions.json',

    /** Game timer duration in seconds */
    TIMER_DURATION: 30,

    /** Maximum controllers (players) per room */
    MAX_PLAYERS_PER_ROOM: 3,

    /** Timer sync interval — how often server sends timerSync to clients (ms) */
    TIMER_SYNC_INTERVAL: 1000,

    /** UDP port range for WebRTC data channels (must match Docker EXPOSE) */
    UDP_PORT_MIN: parseInt(process.env.UDP_PORT_MIN || '9000', 10),
    UDP_PORT_MAX: parseInt(process.env.UDP_PORT_MAX || '9100', 10),

    /** ICE servers for WebRTC */
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.metered.ca:80' },
    ],
} as const;
