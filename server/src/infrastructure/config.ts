// ==========================================
// Server Configuration
// ==========================================

export const CONFIG = {
    PORT: parseInt(process.env.PORT || '3000', 10),

    /** Path to SQLite database file */
    DB_PATH: process.env.DB_PATH || './QuizzWall.sqlite',

    /** Game timer duration in seconds */
    TIMER_DURATION: 30,

    /** Maximum controllers (players) per room */
    MAX_PLAYERS_PER_ROOM: 3,

    /** Timer sync interval — how often server sends timerSync to clients (ms) */
    TIMER_SYNC_INTERVAL: 1000,

    /** ICE servers for WebRTC */
    ICE_SERVERS: [
        { urls: 'stun:stun.metered.ca:80' },
        {
            urls: 'turn:global.relay.metered.ca:443',
            username: 'admin',
            credential: 'admin',
        },
    ],
} as const;
