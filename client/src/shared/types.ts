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
    id: string;        // persistent client id
    role: PlayerRole;
    isReady: boolean;
    colorIndex?: number; // 0, 1, 2 for crosshair color
    name?: string;       // Individual player name
    isSpectating?: boolean; // Whether the player is in the lobby while a game is active
}

// Profile accent colors for each fixed character slot: Wulf, Talon, Ryker, Zark
export const CROSSHAIR_COLORS = ['#2EA8FF', '#F5A623', '#FF7A45', '#FF5FA2'] as const;

// Pre-configured character names and avatar slugs (index-aligned with CROSSHAIR_COLORS)
export const PRE_CONFIG_NAMES = ['Wulf', 'Talon', 'Ryker', 'Zark'] as const;
export const PRE_CONFIG_AVATARS = ['wulf', 'talon', 'ryker', 'zark'] as const;

// ---------- Lobby ----------

export interface LobbyState {
    roomId: string;
    players: PlayerInfo[];
    canStart: boolean;
    isSpectating?: boolean; // Whether THIS player is spectating
}

// ---------- Room Join ----------

export interface JoinedRoomPayload {
    roomId: string;
    success: boolean;
    error?: string;
    role?: PlayerRole;
    colorIndex?: number;
    playerName?: string;
    gameInProgress?: boolean;
}

// ---------- Game Events ----------

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

// ---------- Loading Screen ----------

export interface LoadingStartPayload {
    playerCount: number;
}

export interface LoadingCountdownPayload {
    duration: number;
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

// ---------- Topic Selection ----------

export const QUIZ_TOPICS = [
    { id: 'animal-kingdom', label: 'Animal Kingdom', emoji: '🦁' },
    { id: 'science-space', label: 'Science & Space', emoji: '🔬' },
    { id: 'world-history', label: 'World History', emoji: '🏛️' },
    { id: 'literature-arts', label: 'Literature & Arts', emoji: '🎨' },
    { id: 'geography-culture', label: 'Geography & Culture', emoji: '🌍' },
] as const;

export type QuizTopicId = (typeof QUIZ_TOPICS)[number]['id'];

export const DEFAULT_TOPIC: QuizTopicId = 'animal-kingdom';

export const TOPIC_SELECTION_TIMEOUT_MS = 30_000;

// ---------- Difficulty ----------

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export const DEFAULT_DIFFICULTY: QuizDifficulty = 'easy';

export const QUIZ_DIFFICULTIES: { id: QuizDifficulty; label: string; emoji: string }[] = [
    { id: 'easy',   label: 'Easy',   emoji: '🟢' },
    { id: 'medium', label: 'Medium', emoji: '🟡' },
    { id: 'hard',   label: 'Hard',   emoji: '🔴' },
];

export interface TopicVotePayload {
    topicId: QuizTopicId;
}

export interface SetDifficultyPayload {
    difficulty: QuizDifficulty;
}

export interface TopicVoteUpdatePayload {
    votes: Record<string, number>;
    votedControllerIds: string[];
    playerVotes: Record<string, string>; // controllerId -> topicId
    totalVoters: number;
    timeLeft: number;
    difficulty: QuizDifficulty;          // current leader-selected difficulty
}

export interface TopicSelectedPayload {
    topicId: QuizTopicId;
    topicLabel: string;
    difficulty: QuizDifficulty;
}

// ---------- Orb positions (shared constant) ----------

export const ORB_POSITIONS = [
    { id: 'A', left: '15%', top: '45%', x: 20, y: 55 },
    { id: 'B', left: '40%', top: '60%', x: 45, y: 70 },
    { id: 'C', left: '60%', top: '45%', x: 65, y: 55 },
    { id: 'D', left: '80%', top: '60%', x: 85, y: 70 },
] as const;
