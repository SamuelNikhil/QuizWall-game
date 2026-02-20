// ==========================================
// Server Configuration
// ==========================================

import { resolve } from 'path';

const PROJECT_ROOT = resolve(import.meta.dirname || '.', '..', '..');

export const CONFIG = {
    PORT: parseInt(process.env.PORT || '3000', 10),

    /** Path to SQLite database file - absolute path */
    DB_PATH: process.env.DB_PATH || resolve(PROJECT_ROOT, 'QuizzWall.sqlite'),

    /** Path to Questions JSON file (fallback) */
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

    // ==========================================
    // AI Configuration (Groq)
    // ==========================================
    
    /** Groq API Key (server-side only) */
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',

    /** Groq Model to use */
    GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',

    /** Quiz topic for question generation */
    QUIZ_TOPIC: process.env.QUIZ_TOPIC || 'General Knowledge',

    /** Number of questions to generate per session (capped at 10) */
    QUESTIONS_PER_SESSION: Math.min(parseInt(process.env.QUESTIONS_PER_SESSION || '10', 10), 10),

    /** Enable AI question generation */
    AI_ENABLED: Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 0),
} as const;
