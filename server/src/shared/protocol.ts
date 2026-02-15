// ==========================================
// Protocol — Event name constants
// Used by both client and server transport layers
// ==========================================

export const EVENTS = {
    // --- Room lifecycle ---
    CREATE_ROOM: 'createRoom',
    ROOM_CREATED: 'roomCreated',
    JOIN_ROOM: 'joinRoom',
    JOINED_ROOM: 'joinedRoom',
    CONTROLLER_JOINED: 'controllerJoined',
    CONTROLLER_LEFT: 'controllerLeft',

    // --- Team & Lobby ---
    SET_TEAM_NAME: 'setTeamName',
    TEAM_INFO: 'teamInfo',
    LOBBY_UPDATE: 'lobbyUpdate',
    PLAYER_READY: 'playerReady',
    START_GAME: 'startGame',
    GAME_STARTED: 'gameStarted',

    // --- Game flow (server → clients) ---
    QUESTION: 'question',
    TIMER_SYNC: 'timerSync',
    SCORE_UPDATE: 'scoreUpdate',
    GAME_OVER: 'gameOver',
    GAME_RESTARTED: 'gameRestarted',

    // --- Input (controller → server) ---
    AIM: 'aim',
    CROSSHAIR: 'crosshair',
    START_AIMING: 'startAiming',
    CANCEL_AIMING: 'cancelAiming',
    TARGETING: 'targeting',
    SHOOT: 'shoot',
    RESTART_GAME: 'restartGame',

    // --- Feedback (server → controller/screen) ---
    HIT_RESULT: 'hitResult',
    PROJECTILE: 'projectile',

    // --- Leaderboard ---
    LEADERBOARD: 'leaderboard',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
