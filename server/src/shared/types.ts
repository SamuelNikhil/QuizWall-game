// ==========================================
// Shared Types — used by both Client & Server
// ==========================================

/** Question sent to clients (never includes `correct` answer) */
export interface ClientQuestion {
    id: number;
    text: string;
    code?: string;
    options: QuestionOption[];
}

/** Full question with correct answer (server-only) */
export interface ServerQuestion extends ClientQuestion {
    correct: string; // e.g. "B"
    category?: string;
}

export interface QuestionOption {
    id: string; // "A", "B", "C", "D"
    text: string;
}

// ---------- Player ----------

export type PlayerRole = 'leader' | 'member';

export interface PlayerInfo {
    id: string;        // channel id
    role: PlayerRole;
    isReady: boolean;
    colorIndex?: number; // For crosshair color indicator
    name?: string;       // Individual player name
}

// ---------- Lobby ----------

export interface LobbyState {
    roomId: string;
    players: PlayerInfo[];
    canStart: boolean;  // true when all members are ready (or solo leader)
}

// ---------- Room Join ----------

export interface JoinedRoomPayload {
    roomId: string;
    success: boolean;
    error?: string;
    role?: PlayerRole;
    colorIndex?: number;
}

// ---------- Game Events ----------

export interface ShootPayload {
    targetXPercent: number;
    targetYPercent: number;
    power: number;
}

export interface HitResultPayload {
    controllerId: string;
    correct: boolean;
    points: number;
    baseScore: number;   // Base score (50 for correct)
    bonus: number;       // Time bonus (0, 10, or 20)
    orbId: string | null;  // which orb was hit
}

export interface ScoreUpdate {
    playerScores: PlayerScoreEntry[];
}

export interface TimerSync {
    timeLeft: number;
}

export interface GameOverPayload {
    leaderboard: LeaderboardEntry[];
    reason: 'time' | 'completed' | 'all_wrong'; // Why the game ended
    questionsAnswered: number; // Questions answered in this session (accumulated across restarts)
    playerScores?: PlayerScoreEntry[]; // Individual player scores for scoreboard
}

export interface PlayerScoreEntry {
    controllerId: string;
    name: string;
    colorIndex: number;
    score: number;
}

export interface LeaderboardEntry {
    rank: number;
    playerName: string;
    totalScore: number;
    gamesPlayed: number;
}

// ---------- Crosshair / Aiming ----------

export interface CrosshairPayload {
    controllerId: string;
    x: number;
    y: number;
}

export interface TargetingPayload {
    controllerId: string;
    orbId: string | null;
}

export interface StartAimingPayload {
    controllerId: string;
    gyroEnabled: boolean;
}

// ---------- Phase-based Multiplayer ----------

export type QuestionPhase = 'analysis' | 'selection' | 'reveal';

export interface PhaseChangePayload {
    phase: QuestionPhase;
    timeLeft: number;       // Remaining seconds in this phase
    questionNumber: number; // 1-indexed for UI display
}

export interface PlayerSelectionPayload {
    controllerId: string;
    orbId: string;          // Which orb the player selected
    colorIndex: number;     // Player's crosshair color for visual marking
    selectionTime?: number; // Seconds elapsed since selection phase started (for bonus scoring) - set by server
}

export interface RevealResultPayload {
    correctOrbId: string;                    // The correct answer
    selections: PlayerSelectionPayload[];    // All player selections
    anyCorrect: boolean;                     // Did at least one player get it right?
    points: number;                          // Points awarded (if any correct)
    noSelection: boolean;                    // True if NO player selected anything (Time's Up)
    playerScores: PlayerScoreResult[];       // Individual player scores for this round
}

export interface PlayerScoreResult {
    controllerId: string;
    colorIndex: number;
    score: number;           // Total score for this round (base + bonus)
    baseScore: number;       // Base score (50)
    bonus: number;           // Time bonus (0, 10, or 20)
    correct: boolean;        // Whether they answered correctly
}

// ---------- Interactive Tutorial ----------

export type TutorialStep = 'waiting' | 'sling' | 'tilt' | 'complete';

/** Progress events sent from controller → server */
export type TutorialProgressStep = 'sling' | 'tilt-left' | 'tilt-right' | 'tilt-up' | 'tilt-down';

/** Sent from controller → server when a player completes a tutorial step */
export interface TutorialProgressPayload {
    step: TutorialProgressStep;
    tiltX?: number;
    tiltY?: number;
}

/** Broadcast from server → all clients with each player's tutorial status */
export interface TutorialStatusUpdatePayload {
    players: TutorialPlayerStatus[];
    allComplete: boolean;
}

export interface TutorialPlayerStatus {
    controllerId: string;
    colorIndex: number;
    name?: string; // Player display name
    currentStep: TutorialStep;
    completedSling: boolean;
    completedTiltLeft: boolean;
    completedTiltRight: boolean;
    completedTiltUp: boolean;
    completedTiltDown: boolean;
    tiltX: number;
    tiltY: number;
}

// ---------- Orb positions (shared constant) ----------

export const ORB_POSITIONS = [
    { id: 'A', left: '15%', top: '55%', x: 25, y: 65 },
    { id: 'B', left: '40%', top: '70%', x: 50, y: 80 },
    { id: 'C', left: '60%', top: '55%', x: 70, y: 65 },
    { id: 'D', left: '80%', top: '70%', x: 90, y: 80 },
] as const;
