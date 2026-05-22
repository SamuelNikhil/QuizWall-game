// ==========================================
// GameClient — Client Transport Layer
// Typed wrapper around Geckos.io connection
// Auto-reconnect with exponential backoff
// ==========================================

import geckos from '@geckos.io/client';
import { EVENTS } from '../shared/protocol';
import type {
    ClientQuestion,
    HitResultPayload,
    ScoreUpdate,
    TimerSync,
    GameOverPayload,
    LobbyState,
    CrosshairPayload,
    TargetingPayload,
    StartAimingPayload,
    PlayerRole,
    LeaderboardEntry,
    PhaseChangePayload,
    PlayerSelectionPayload,
    RevealResultPayload,
    JoinedRoomPayload,
    TopicVoteUpdatePayload,
    TopicSelectedPayload,
    QuizTopicId,
    QuizDifficulty,
} from '../shared/types';

// --------------- Config ---------------

const DEFAULT_SERVER_PORT = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1500;

function getConnectionMode(): 'proxy' | 'direct' {
    const value = import.meta.env.VITE_USE_PROXY?.toLowerCase() ?? '';
    if (value === 'true' || value === '1' || value === 'proxy') return 'proxy';
    return 'direct';
}

function getServerConfig() {
    const useProxy = getConnectionMode() === 'proxy';
    const signalingPath = (import.meta.env.VITE_SIGNALING_PATH as string) || '/.wrtc/v2';

    if (useProxy) {
        return {
            geckosUrl: window.location.origin,
            geckosPort: parseInt(window.location.port, 10) || (window.location.protocol === 'https:' ? 443 : 80),
            geckosPath: signalingPath,
        };
    }

    const apiUrl = import.meta.env.VITE_API_URL as string;
    if (apiUrl) {
        try {
            const url = new URL(apiUrl);
            return {
                geckosUrl: `${url.protocol}//${url.hostname}`,
                geckosPort: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
                geckosPath: signalingPath,
            };
        } catch (e) {
            console.error('[GameClient] Invalid VITE_API_URL:', apiUrl, e);
        }
    }

    const port = parseInt(import.meta.env.VITE_SERVER_PORT || String(DEFAULT_SERVER_PORT), 10);
    let raw = (import.meta.env.VITE_SERVER_URL as string) || window.location.hostname;
    if (!raw.startsWith('http')) {
        raw = `${window.location.protocol === 'https:' ? 'https' : 'http'}://${raw}`;
    }
    const { protocol, hostname } = new URL(raw);
    return { geckosUrl: `${protocol}//${hostname}`, geckosPort: port, geckosPath: signalingPath };
}

// --------------- GameClient Class ---------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Channel = any;

export class GameClient {
    private channel: Channel = null;
    private connected = false;
    /** Set to true when close() is called intentionally — prevents auto-reconnect */
    private aborted = false;

    // Auto-reconnect state
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** Credentials stored so auto-reconnect can re-join the room */
    private pendingJoin: { roomId: string; token: string; clientId: string } | null = null;
    /** Whether this client is a screen (CREATE_ROOM) or controller (JOIN_ROOM) */
    private clientRole: 'screen' | 'controller' | null = null;
    /** roomId stored for screen reconnect */
    private screenRoomId: string | null = null;

    // Callbacks
    private onDisconnectCallback: (() => void) | null = null;
    private onReconnectingCallback: ((attempt: number, maxAttempts: number) => void) | null = null;
    private onReconnectFailedCallback: (() => void) | null = null;

    // ---- Connection ----

    async connect(): Promise<Channel> {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options: any = {
            url: geckosUrl,
            port: geckosPort,
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun.metered.ca:80' },
            ],
        };
        if (geckosPath) options.path = geckosPath;

        const io = geckos(options);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this.connected) reject(new Error('Connection timeout'));
            }, 15000);

            io.onConnect((error) => {
                clearTimeout(timeout);
                if (error) { reject(error); return; }
                if (this.aborted) {
                    try { io.close(); } catch { /* ignore */ }
                    return;
                }
                this.channel = io;
                this.connected = true;
                this.reconnectAttempts = 0;
                resolve(io);
            });

            io.onDisconnect(() => {
                this.connected = false;
                if (!this.aborted) {
                    this.onDisconnectCallback?.();
                    this._scheduleReconnect();
                }
            });
        });
    }

    // ---- Auto-reconnect ----

    private _scheduleReconnect(): void {
        if (this.aborted) return;
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.warn('[GameClient] Max reconnect attempts reached');
            this.onReconnectFailedCallback?.();
            return;
        }

        // Exponential backoff: 1.5s, 3s, 6s, 12s, 24s
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        console.log(`[GameClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        this.onReconnectingCallback?.(this.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (this.aborted) return;
            try {
                await this.connect();
                // Re-register all listeners on the new channel by re-emitting the join event
                this._reJoin();
            } catch (e) {
                console.warn('[GameClient] Reconnect attempt failed:', e);
                this._scheduleReconnect();
            }
        }, delay);
    }

    private _reJoin(): void {
        if (this.clientRole === 'controller' && this.pendingJoin) {
            const { roomId, token, clientId } = this.pendingJoin;
            console.log(`[GameClient] Re-joining room ${roomId} as controller`);
            this.channel?.emit(EVENTS.JOIN_ROOM, { roomId, token, clientId });
        } else if (this.clientRole === 'screen' && this.screenRoomId) {
            console.log(`[GameClient] Re-joining room ${this.screenRoomId} as screen`);
            this.channel?.emit(EVENTS.CREATE_ROOM, { roomId: this.screenRoomId });
        }
    }

    // ---- Lifecycle callbacks ----

    onDisconnect(cb: () => void): void {
        this.onDisconnectCallback = cb;
    }

    /** Called each time a reconnect attempt starts */
    onReconnecting(cb: (attempt: number, maxAttempts: number) => void): void {
        this.onReconnectingCallback = cb;
    }

    /** Called when all reconnect attempts are exhausted */
    onReconnectFailed(cb: () => void): void {
        this.onReconnectFailedCallback = cb;
    }

    getChannel(): Channel { return this.channel; }
    isConnected(): boolean { return this.connected; }

    /** Get geckos channel ID (used as controllerId on the server) */
    getClientId(): string | null { return this.channel?.id ?? null; }

    close(): void {
        this.aborted = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.connected && this.channel) {
            this.removeAllListeners();
            try { this.channel.close(); } catch { /* ignore */ }
            this.connected = false;
        }
    }

    removeAllListeners(): void {
        if (!this.channel) return;
        try {
            if (typeof this.channel.removeAllListeners === 'function') {
                this.channel.removeAllListeners();
            }
        } catch { /* ignore */ }
    }

    // ---- Emit methods ----

    createRoom(roomId?: string): void {
        this.clientRole = 'screen';
        if (roomId) this.screenRoomId = roomId;
        this.channel?.emit(EVENTS.CREATE_ROOM, roomId ? { roomId } : undefined);
    }

    joinRoom(roomId: string, token: string, clientId?: string): void {
        this.clientRole = 'controller';
        if (clientId) this.pendingJoin = { roomId, token, clientId };
        this.channel?.emit(EVENTS.JOIN_ROOM, { roomId, token, clientId });
    }

    /** Store the roomId once the screen receives ROOM_CREATED (for reconnect) */
    setScreenRoomId(roomId: string): void {
        this.screenRoomId = roomId;
    }

    sendLeaveGame(): void { this.channel?.emit(EVENTS.LEAVE_GAME); }
    startGame(): void { this.channel?.emit(EVENTS.START_GAME); }

    shoot(targetXPercent: number, targetYPercent: number, power: number): void {
        this.channel?.emit(EVENTS.SHOOT, { targetXPercent, targetYPercent, power });
    }

    sendCrosshair(x: number, y: number): void {
        this.channel?.emit(EVENTS.CROSSHAIR, { x, y }, { reliable: false });
    }

    sendStartAiming(): void { this.channel?.emit(EVENTS.START_AIMING, { gyroEnabled: false }); }
    sendCancelAiming(): void { this.channel?.emit(EVENTS.CANCEL_AIMING); }
    sendTargeting(orbId: string | null): void { this.channel?.emit(EVENTS.TARGETING, { orbId }); }
    restartGame(): void { this.channel?.emit(EVENTS.RESTART_GAME); }

    // ---- Event subscriptions ----

    onRoomCreated(cb: (data: { roomId: string; joinToken: string; leaderboard?: LeaderboardEntry[]; reconnected?: boolean }) => void): void {
        this.channel?.on(EVENTS.ROOM_CREATED, cb);
    }

    onJoinedRoom(cb: (data: JoinedRoomPayload & { gameInProgress?: boolean }) => void): void {
        this.channel?.on(EVENTS.JOINED_ROOM, cb);
    }

    onReconnected(cb: (data: {
        success: boolean;
        phase: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playerScores?: any[];
        colorIndex?: number;
        role?: PlayerRole;
        currentQuestion?: ClientQuestion;
        phaseTimeLeft?: number;
        questionNumber?: number;
        isMultiplayer?: boolean;
        currentPhase?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playerSelections?: any[];
    }) => void): void {
        this.channel?.on(EVENTS.RECONNECTED, cb);
    }

    onControllerJoined(cb: (data: { controllerId: string; role: PlayerRole; colorIndex?: number }) => void): void {
        this.channel?.on(EVENTS.CONTROLLER_JOINED, cb);
    }

    onControllerLeft(cb: (data: { controllerId?: string; wasLeader?: boolean; screenDisconnected?: boolean }) => void): void {
        this.channel?.on(EVENTS.CONTROLLER_LEFT, cb);
    }

    onRolePromoted(cb: (data: { role: PlayerRole }) => void): void {
        this.channel?.on(EVENTS.ROLE_PROMOTED, cb);
    }

    onLobbyUpdate(cb: (data: LobbyState) => void): void {
        this.channel?.on(EVENTS.LOBBY_UPDATE, cb);
    }

    onLoadingStart(cb: (data: { playerCount: number }) => void): void {
        this.channel?.on(EVENTS.LOADING_START, (data: { playerCount: number }) => cb(data));
    }

    onLoadingCountdown(cb: (data: { duration: number }) => void): void {
        this.channel?.on(EVENTS.LOADING_COUNTDOWN, (data: { duration: number }) => cb(data));
    }

    onGameStarted(cb: (data: { question: ClientQuestion; timeLeft: number }) => void): void {
        this.channel?.on(EVENTS.GAME_STARTED, cb);
    }

    onQuestion(cb: (data: ClientQuestion) => void): void {
        this.channel?.on(EVENTS.QUESTION, cb);
    }

    onTimerSync(cb: (data: TimerSync) => void): void {
        this.channel?.on(EVENTS.TIMER_SYNC, cb);
    }

    onScoreUpdate(cb: (data: ScoreUpdate) => void): void {
        this.channel?.on(EVENTS.SCORE_UPDATE, cb);
    }

    onHitResult(cb: (data: HitResultPayload) => void): void {
        this.channel?.on(EVENTS.HIT_RESULT, cb);
    }

    onProjectile(cb: (data: { controllerId: string; targetXPercent: number; targetYPercent: number }) => void): void {
        this.channel?.on(EVENTS.PROJECTILE, cb);
    }

    onGameOver(cb: (data: GameOverPayload) => void): void {
        this.channel?.on(EVENTS.GAME_OVER, cb);
    }

    onGameRestarted(cb: () => void): void {
        this.channel?.on(EVENTS.GAME_RESTARTED, cb);
    }

    onCrosshair(cb: (data: CrosshairPayload) => void): void {
        this.channel?.on(EVENTS.CROSSHAIR, cb);
    }

    onStartAiming(cb: (data: StartAimingPayload) => void): void {
        this.channel?.on(EVENTS.START_AIMING, cb);
    }

    onCancelAiming(cb: (data: { controllerId: string }) => void): void {
        this.channel?.on(EVENTS.CANCEL_AIMING, cb);
    }

    onTargeting(cb: (data: TargetingPayload) => void): void {
        this.channel?.on(EVENTS.TARGETING, cb);
    }

    // ---- Phase-based multiplayer ----

    onPhaseChange(cb: (data: PhaseChangePayload) => void): void {
        this.channel?.on(EVENTS.PHASE_CHANGE, cb);
    }

    onPlayerSelection(cb: (data: PlayerSelectionPayload) => void): void {
        this.channel?.on(EVENTS.PLAYER_SELECTION, cb);
    }

    onRevealResult(cb: (data: RevealResultPayload) => void): void {
        this.channel?.on(EVENTS.REVEAL_RESULT, cb);
    }

    onRoomExpired(cb: (data: { reason: string }) => void): void {
        this.channel?.on(EVENTS.ROOM_EXPIRED, cb);
    }

    // ---- Topic Selection ----

    sendTopicVote(topicId: QuizTopicId): void {
        this.channel?.emit(EVENTS.TOPIC_VOTE, { topicId });
    }

    sendSetDifficulty(difficulty: QuizDifficulty): void {
        this.channel?.emit(EVENTS.SET_DIFFICULTY, { difficulty });
    }

    onTopicVoteUpdate(cb: (data: TopicVoteUpdatePayload & { topics?: Array<{ id: string; label: string; emoji: string; x: number; y: number }> }) => void): void {
        this.channel?.on(EVENTS.TOPIC_VOTE_UPDATE, cb);
    }

    onTopicSelected(cb: (data: TopicSelectedPayload) => void): void {
        this.channel?.on(EVENTS.TOPIC_SELECTED, cb);
    }
}
