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
    RECONNECTED: 'reconnected',
    CONTROLLER_JOINED: 'controllerJoined',
    CONTROLLER_LEFT: 'controllerLeft',
    ROLE_PROMOTED: 'rolePromoted',
    ROOM_EXPIRED: 'roomExpired',

    // --- Lobby ---
    LOBBY_UPDATE: 'lobbyUpdate',
    START_GAME: 'startGame',
    LOADING_START: 'loadingStart',
    LOADING_COUNTDOWN: 'loadingCountdown',
    GAME_STARTED: 'gameStarted',

    // --- Game flow (server → clients) ---
    QUESTION: 'question',
    TIMER_SYNC: 'timerSync',
    SCORE_UPDATE: 'scoreUpdate',
    GAME_OVER: 'gameOver',
    GAME_RESTARTED: 'gameRestarted',

    // --- Input (controller → server) ---
    CROSSHAIR: 'crosshair',
    START_AIMING: 'startAiming',
    CANCEL_AIMING: 'cancelAiming',
    TARGETING: 'targeting',
    SHOOT: 'shoot',
    RESTART_GAME: 'restartGame',
    LEAVE_GAME: 'leaveGame',

    // --- Feedback (server → controller/screen) ---
    HIT_RESULT: 'hitResult',
    PROJECTILE: 'projectile',

    // --- Phase-based multiplayer ---
    PHASE_CHANGE: 'phaseChange',
    PLAYER_SELECTION: 'playerSelection',
    REVEAL_RESULT: 'revealResult',

    // --- Topic Selection ---
    TOPIC_VOTE: 'topicVote',
    TOPIC_VOTE_UPDATE: 'topicVoteUpdate',
    TOPIC_SELECTED: 'topicSelected',
    SET_DIFFICULTY: 'setDifficulty',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
