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

// ---------- Team & Player ----------

export type PlayerRole = 'leader' | 'member';

export interface PlayerInfo {
    id: string;        // channel id
    role: PlayerRole;
    isReady: boolean;
}

export interface TeamInfo {
    name: string;
    members: PlayerInfo[];
}

// ---------- Lobby ----------

export interface LobbyState {
    roomId: string;
    team: TeamInfo;
    canStart: boolean;  // true when all members are ready (or solo leader)
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
    orbId: string | null;  // which orb was hit
}

export interface ScoreUpdate {
    teamScore: number;
    teamName: string;
}

export interface TimerSync {
    timeLeft: number;
}

export interface GameOverPayload {
    finalScore: number;
    teamName: string;
    leaderboard: LeaderboardEntry[];
}

export interface LeaderboardEntry {
    rank: number;
    teamName: string;
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

// ---------- Orb positions (shared constant) ----------

export const ORB_POSITIONS = [
    { id: 'A', left: '15%', top: '55%', x: 20, y: 65 },
    { id: 'B', left: '40%', top: '70%', x: 45, y: 80 },
    { id: 'C', left: '60%', top: '55%', x: 65, y: 65 },
    { id: 'D', left: '80%', top: '70%', x: 85, y: 80 },
] as const;
