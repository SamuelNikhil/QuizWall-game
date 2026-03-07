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
    ROLE_PROMOTED: 'rolePromoted',

    // --- Team & Lobby ---
    SET_TEAM_NAME: 'setTeamName',
    TEAM_INFO: 'teamInfo',
    LOBBY_UPDATE: 'lobbyUpdate',
    PLAYER_READY: 'playerReady',
    SET_PLAYER_NAME: 'setPlayerName',
    START_GAME: 'startGame',
    TUTORIAL_START: 'tutorialStart',
    TUTORIAL_END: 'tutorialEnd',
    TUTORIAL_PROGRESS: 'tutorialProgress',
    TUTORIAL_STATUS_UPDATE: 'tutorialStatusUpdate',
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
    WRONG_CHOICES_UPDATE: 'wrongChoicesUpdate',
    PROJECTILE: 'projectile',

    // --- Phase-based multiplayer ---
    PHASE_CHANGE: 'phaseChange',
    PLAYER_SELECTION: 'playerSelection',
    REVEAL_RESULT: 'revealResult',

    // --- Leaderboard ---
    LEADERBOARD: 'leaderboard',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
