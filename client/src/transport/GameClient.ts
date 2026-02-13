// ==========================================
// GameClient — Client Transport Layer
// Typed wrapper around Geckos.io connection
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
} from '../shared/types';

// --------------- Config ---------------

const DEFAULT_SERVER_PORT = 3000;

function getServerConfig() {
    const useProxy = import.meta.env.VITE_USE_PROXY === 'true';
    let serverUrl = import.meta.env.VITE_SERVER_URL as string;
    const serverPort = (import.meta.env.VITE_SERVER_PORT as string) || String(DEFAULT_SERVER_PORT);

    // Fallback: if no server URL configured, use current host
    if (!serverUrl) {
        serverUrl = `${window.location.protocol}//${window.location.hostname}`;
    }

    // Ensure protocol
    if (!serverUrl.startsWith('http')) {
        const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
        serverUrl = `${protocol}://${serverUrl}`;
    }

    // Ensure port is attached if not present
    if (!serverUrl.match(/:\d+/) && serverPort) {
        serverUrl = `${serverUrl}:${serverPort}`;
    }

    const urlObj = new URL(serverUrl);
    const connectionPort = parseInt(urlObj.port, 10) || DEFAULT_SERVER_PORT;

    let geckosUrl: string, geckosPort: number, geckosPath: string;

    if (useProxy) {
        // In proxy mode, connect to the Vite dev server
        geckosUrl = window.location.hostname;
        geckosPort = parseInt(window.location.port, 10) || (window.location.protocol === 'https:' ? 443 : 80);
        geckosPath = (import.meta.env.VITE_SIGNALING_PATH as string) || '/.wrtc/v2';
    } else {
        // In direct mode, connect to the EC2 IP directly
        // Geckos.io v3 requires: url with protocol+hostname (NOT port), port as separate param
        const urlObj = new URL(serverUrl);
        geckosUrl = `${urlObj.protocol}//${urlObj.hostname}`; // e.g., "http://3.108.77.64"
        geckosPort = connectionPort;
        geckosPath = (import.meta.env.VITE_SIGNALING_PATH as string) || '/.wrtc/v2';
    }

    return { geckosUrl, geckosPort, geckosPath };
}

// --------------- GameClient Class ---------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Channel = any;

export class GameClient {
    private channel: Channel = null;
    private connected = false;

    // ---- Connection ----

    async connect(): Promise<Channel> {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

        const options: any = {
            url: geckosUrl,
            port: geckosPort,
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun.metered.ca:80' },
            ],
        };

        if (geckosPath) {
            options.path = geckosPath;
        }

        const io = geckos(options);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Connection timeout'));
                }
            }, 15000);

            io.onConnect((error) => {
                clearTimeout(timeout);
                if (error) {
                    reject(error);
                    return;
                }
                this.channel = io;
                this.connected = true;
                resolve(io);
            });

            io.onDisconnect(() => {
                this.connected = false;
            });
        });
    }

    getChannel(): Channel {
        return this.channel;
    }

    isConnected(): boolean {
        return this.connected;
    }

    close(): void {
        if (this.connected && this.channel) {
            try { this.channel.close(); } catch { /* ignore */ }
            this.connected = false;
        }
    }

    // ---- Emit methods ----

    createRoom(): void {
        this.channel?.emit(EVENTS.CREATE_ROOM);
    }

    joinRoom(roomId: string, token: string, clientId?: string): void {
        this.channel?.emit(EVENTS.JOIN_ROOM, { roomId, token, clientId });
    }

    setTeamName(name: string): void {
        this.channel?.emit(EVENTS.SET_TEAM_NAME, { name });
    }

    playerReady(): void {
        this.channel?.emit(EVENTS.PLAYER_READY);
    }

    startGame(): void {
        this.channel?.emit(EVENTS.START_GAME);
    }

    shoot(targetXPercent: number, targetYPercent: number, power: number): void {
        this.channel?.emit(EVENTS.SHOOT, { targetXPercent, targetYPercent, power });
    }

    sendCrosshair(x: number, y: number): void {
        this.channel?.emit(EVENTS.CROSSHAIR, { x, y }, { reliable: false });
    }

    sendStartAiming(gyroEnabled: boolean): void {
        this.channel?.emit(EVENTS.START_AIMING, { gyroEnabled });
    }

    sendCancelAiming(): void {
        this.channel?.emit(EVENTS.CANCEL_AIMING);
    }

    sendTargeting(orbId: string | null): void {
        this.channel?.emit(EVENTS.TARGETING, { orbId });
    }

    restartGame(): void {
        this.channel?.emit(EVENTS.RESTART_GAME);
    }

    // ---- Event subscriptions ----

    onRoomCreated(cb: (data: { roomId: string; joinToken: string; leaderboard?: LeaderboardEntry[] }) => void): void {
        this.channel?.on(EVENTS.ROOM_CREATED, cb);
    }

    onJoinedRoom(cb: (data: { roomId: string; success: boolean; error?: string; role?: PlayerRole }) => void): void {
        this.channel?.on(EVENTS.JOINED_ROOM, cb);
    }

    onControllerJoined(cb: (data: { controllerId: string; role: PlayerRole }) => void): void {
        this.channel?.on(EVENTS.CONTROLLER_JOINED, cb);
    }

    onControllerLeft(cb: (data: { controllerId: string }) => void): void {
        this.channel?.on(EVENTS.CONTROLLER_LEFT, cb);
    }

    onLobbyUpdate(cb: (data: LobbyState) => void): void {
        this.channel?.on(EVENTS.LOBBY_UPDATE, cb);
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
}
