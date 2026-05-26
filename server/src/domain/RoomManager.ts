// ==========================================
// Room Manager — Domain Layer
// Fully game-agnostic: manages room lifecycle,
// player slots, scores, and disconnect handling.
// All game-specific logic lives in plugin handlers.
// ==========================================

import { randomBytes } from 'crypto';
import { createGameEngine } from './GameRegistry.ts';
import type { GameEngine, GameType } from './GameEngine.ts';
import { EVENTS } from '../shared/protocol.ts';
import { CONFIG } from '../infrastructure/config.ts';
import { QUIZ_TOPICS } from '../shared/types.ts';
import type { PlayerRole, PlayerInfo, PlayerScoreEntry, LobbyState } from '../shared/types.ts';
import * as playerRepo from '../data/playerRepository.ts';
import * as teamRepo from '../data/teamRepository.ts';
import { getApiCallLog } from '../modes/ShootQuiz/GroqService.ts';

// ---- Public interfaces ----

export interface RoomController {
    id: string;
    clientId: string; // Persistent device ID
    role: PlayerRole;
    isReady: boolean;
    colorIndex: number;
    name: string;
    score: number;
    isSpectating: boolean;
    disconnected?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel: any;
}

export interface DisconnectedPlayerScore {
    clientId: string;
    name: string;
    colorIndex: number;
    score: number;
}

/**
 * Core room state — game-agnostic.
 * Game plugins store their own per-room state in a separate Map keyed by roomId.
 */
export interface Room {
    roomId: string;
    joinToken: string;
    gameType: GameType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    screenChannel: any; // Geckos.io ServerChannel
    controllers: RoomController[];
    engine: GameEngine;
    gameStarted: boolean;
    lastActivity: number;
    disconnectedPlayerScores: Map<string, DisconnectedPlayerScore>;
    disconnectGraceTimers: Map<string, NodeJS.Timeout>;
    // Screen reconnect grace period
    screenDisconnected?: boolean;
    screenGraceTimer?: NodeJS.Timeout;
    // Empty lobby deletion timer
    emptyLobbyTimer?: NodeJS.Timeout;
    // Set when game-over is broadcast; used by LEAVE_GAME to destroy room
    gameOverBroadcasted?: boolean;
    // Live topic/difficulty tracking for admin monitoring
    currentTopic?: string;
    currentDifficulty?: string;
    // Human-readable screen identifier for admin status
    screenLabel?: string;
}

export interface ConnectionEvent {
    roomId: string;
    clientLabel: string;
    eventType: 'screen_connect' | 'screen_disconnect' | 'screen_reconnect'
        | 'controller_connect' | 'controller_disconnect'
        | 'controller_reconnect' | 'controller_reconnect_failed'
        | 'controller_grace_expired';
    details: string;
    timestamp: number;
}

export const PRE_CONFIG_NAMES = ['Wulf', 'Talon', 'Ryker', 'Zark'];

export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    private idleReaperInterval: ReturnType<typeof setInterval> | null = null;
    private static readonly IDLE_TIMEOUT_MS = 2 * 60 * 1000;
    private static readonly REAPER_INTERVAL_MS = 30 * 1000;
    private static readonly GRACE_MS = 60_000;

    private onEmptyLobbyDeleted: ((room: Room) => void) | null = null;
    private onRoomDeleted: ((roomId: string) => void) | null = null;

    /** Connection event log (ring buffer, max 500 entries) */
    private connectionLog: ConnectionEvent[] = [];
    private static readonly MAX_CONNECTION_LOG = 500;

    private logConnectionEvent(event: ConnectionEvent): void {
        this.connectionLog.push(event);
        while (this.connectionLog.length > RoomManager.MAX_CONNECTION_LOG) {
            this.connectionLog.shift();
        }
    }

    setOnEmptyLobbyDeleted(cb: (room: Room) => void): void {
        this.onEmptyLobbyDeleted = cb;
    }

    setOnRoomDeleted(cb: (roomId: string) => void): void {
        this.onRoomDeleted = cb;
    }

    constructor() {
        this.idleReaperInterval = setInterval(
            () => this.reapIdleRooms(),
            RoomManager.REAPER_INTERVAL_MS,
        );
        console.log('[RoomManager] Idle room reaper started (2 min timeout)');
    }

    // ---- Room creation ----

    private generateRoomId(): string {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    private generateToken(): string {
        return randomBytes(16).toString('hex');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRoom(screenChannel: any, gameType: GameType = 'shootquiz'): { roomId: string; joinToken: string } {
        const roomId = this.generateRoomId();
        const joinToken = this.generateToken();
        const sessionId = `room-${roomId}-${Date.now()}`;
        const engine = createGameEngine(gameType, sessionId);

        const room: Room = {
            roomId,
            joinToken,
            gameType,
            screenChannel,
            controllers: [],
            engine,
            gameStarted: false,
            lastActivity: Date.now(),
            disconnectedPlayerScores: new Map(),
            disconnectGraceTimers: new Map(),
            screenLabel: `Screen_${roomId}`,
        };

        this.rooms.set(roomId, room);
        this.logConnectionEvent({
            roomId,
            clientLabel: `Screen_${roomId}`,
            eventType: 'screen_connect',
            details: `Screen created room ${roomId} (session: ${sessionId})`,
            timestamp: Date.now(),
        });
        console.log(`[Room] Created: ${roomId} (game: ${gameType}, session: ${sessionId})`);
        return { roomId, joinToken };
    }

    // ---- Join / leave ----

    joinRoom(
        roomId: string,
        token: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        channel: any,
        clientId: string,
    ): { success: boolean; error?: string; role?: PlayerRole; colorIndex?: number; playerName?: string; reconnected?: boolean; phase?: string; playerScores?: PlayerScoreEntry[]; resyncState?: Record<string, unknown> } {
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: 'Room not found' };
        if (room.joinToken !== token) return { success: false, error: 'Invalid token' };

        // Already in room (reconnecting via joinRoom path — race where JOIN_ROOM
        // arrived before onDisconnect, so the controller isn't marked disconnected yet)
        const existingIdx = room.controllers.findIndex(c => c.clientId === clientId);
        if (existingIdx !== -1) {
            const existing = room.controllers[existingIdx];

            // Cancel any pending grace timer so fullyRemoveController won't fire later
            const timer = room.disconnectGraceTimers.get(clientId);
            if (timer) {
                clearTimeout(timer);
                room.disconnectGraceTimers.delete(clientId);
            }

            existing.id = channel.id;
            existing.channel = channel;
            existing.disconnected = false;
            existing.isSpectating = false;

            if (room.emptyLobbyTimer) {
                clearTimeout(room.emptyLobbyTimer);
                room.emptyLobbyTimer = undefined;
            }
            room.lastActivity = Date.now();
            room.disconnectedPlayerScores.delete(clientId);

            const otherLeader = room.controllers.find(
                c => c.clientId !== clientId && c.role === 'leader' && !c.disconnected,
            );
            if (otherLeader) existing.role = 'member';
            this.ensureSingleLeader(room);

            const phase = room.gameStarted ? 'playing' : 'lobby';
            const resyncState = room.gameStarted ? room.engine.getResyncState?.() : undefined;

            this.logConnectionEvent({
                roomId,
                clientLabel: existing.name,
                eventType: 'controller_reconnect',
                details: `Controller ${existing.name} reconnected (fallback path) — phase: ${phase}`,
                timestamp: Date.now(),
            });
            return {
                success: true,
                reconnected: true,
                phase,
                role: existing.role,
                colorIndex: existing.colorIndex,
                playerName: existing.name,
                playerScores: this.getPlayerScores(roomId),
                resyncState,
            };
        }

        const previousScore = room.disconnectedPlayerScores.get(clientId);
        if (previousScore) {
            room.disconnectedPlayerScores.delete(clientId);
            console.log(`[Room] Player ${clientId} rejoining, clearing disconnected score entry`);
        }

        // Clean up if this channel is in another room
        this.removeController(channel.id);

        if (room.controllers.length >= CONFIG.MAX_PLAYERS_PER_ROOM) {
            return { success: false, error: 'Room is full (max 4 players)' };
        }
        if (room.gameStarted) {
            // Allow rejoining as spectator when game is in progress
            // (grace period expired — they missed the reconnect window)
            // Instead of hard-blocking, add them as a spectating controller
            const usedColorIndices = new Set(room.controllers.map(c => c.colorIndex));
            let colorIndex = 0;
            while (usedColorIndices.has(colorIndex) && colorIndex < 4) colorIndex++;
            const defaultName = PRE_CONFIG_NAMES[colorIndex] || `Player ${room.controllers.length + 1}`;

            const controller: RoomController = {
                id: channel.id,
                clientId,
                role: 'member',
                isReady: true,
                colorIndex,
                name: defaultName,
                score: 0,
                isSpectating: true,
                channel,
            };

            // Clean up any previous disconnected score entry
            room.disconnectedPlayerScores.delete(clientId);

            room.controllers.push(controller);
            room.lastActivity = Date.now();

            if (room.emptyLobbyTimer) {
                clearTimeout(room.emptyLobbyTimer);
                room.emptyLobbyTimer = undefined;
            }

            this.logConnectionEvent({
                roomId,
                clientLabel: defaultName,
                eventType: 'controller_connect',
                details: `Controller ${defaultName} joined as spectator (game in progress)`,
                timestamp: Date.now(),
            });
            console.log(`[Room] ${clientId.substring(0, 8)}... joined room ${roomId} as spectator (game in progress)`);
            return { success: true, role: 'member', colorIndex, playerName: defaultName };
        }

        const currentLeaders = room.controllers.filter(c => c.role === 'leader');
        const role: PlayerRole = currentLeaders.length === 0 ? 'leader' : 'member';

        const usedColorIndices = new Set(room.controllers.map(c => c.colorIndex));
        let colorIndex = 0;
        if (previousScore && !usedColorIndices.has(previousScore.colorIndex)) {
            colorIndex = previousScore.colorIndex;
        } else {
            while (usedColorIndices.has(colorIndex) && colorIndex < 4) colorIndex++;
        }

        const defaultName = PRE_CONFIG_NAMES[colorIndex] || `Player ${room.controllers.length + 1}`;

        const controller: RoomController = {
            id: channel.id,
            clientId,
            role,
            isReady: true,
            colorIndex,
            name: defaultName,
            score: previousScore?.score || 0,
            isSpectating: false,
            channel,
        };

        room.controllers.push(controller);
        room.lastActivity = Date.now();

        if (room.emptyLobbyTimer) {
            clearTimeout(room.emptyLobbyTimer);
            room.emptyLobbyTimer = undefined;
            console.log(`[Room] Empty-lobby timer cancelled — new controller joined ${roomId}`);
        }

        this.logConnectionEvent({
            roomId,
            clientLabel: defaultName,
            eventType: 'controller_connect',
            details: `Controller ${defaultName} (${role}) joined room ${roomId}`,
            timestamp: Date.now(),
        });
        console.log(`[Room] ${role.toUpperCase()} joined ${roomId} (clientId: ${clientId.substring(0, 8)}...)`);
        return { success: true, role, colorIndex, playerName: undefined };
    }

    setPlayerReady(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        const controller = room.controllers.find(c => c.clientId === clientId);
        if (!controller) return false;
        controller.isReady = true;
        return true;
    }

    canStartGame(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        return room.controllers.some(c => !c.disconnected);
    }

    startGame(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) {
            console.warn(`[RoomManager] Room ${roomId} not found`);
            return false;
        }

        this.ensureSingleLeader(room);

        const controller = room.controllers.find(c => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') {
            console.warn(`[RoomManager] Controller ${clientId} is not leader (role: ${controller?.role})`);
            return false;
        }

        if (!this.canStartGame(roomId)) {
            console.warn(`[RoomManager] Cannot start game - no players in room ${roomId}`);
            return false;
        }

        console.log(`[RoomManager] Starting game in room ${roomId} with ${room.controllers.length} players`);
        room.gameStarted = true;
        room.lastActivity = Date.now();

        for (const c of room.controllers) c.isSpectating = false;

        console.log(`[Room] Game started in ${roomId}`);
        return true;
    }

    getLobbyState(roomId: string): LobbyState | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const players: PlayerInfo[] = room.controllers
            .filter(c => !c.disconnected)
            .map(c => ({
                id: c.clientId,
                role: c.role,
                isReady: c.isReady,
                colorIndex: c.colorIndex,
                name: c.name,
                isSpectating: c.isSpectating,
            }));

        return { roomId, players, canStart: this.canStartGame(roomId) };
    }

    removeController(channelId: string): { room: Room | null; wasLeader: boolean; promotedControllerId?: string } {
        for (const [, room] of this.rooms) {
            const idx = room.controllers.findIndex(c => c.id === channelId);
            if (idx === -1) continue;

            const wasLeader = room.controllers[idx].role === 'leader';
            const leftController = room.controllers[idx];
            const leftColorIndex = leftController.colorIndex;

            if (room.gameStarted) {
                if (room.controllers.length === 1) {
                    // Last player mid-game — force-end game, don't destroy room, caller handles
                    this.logConnectionEvent({
                        roomId: room.roomId,
                        clientLabel: leftController.name,
                        eventType: 'controller_disconnect',
                        details: `Last player ${leftController.name} disconnected mid-game — will force-end`,
                        timestamp: Date.now(),
                    });
                    leftController.isSpectating = true;
                    room.controllers.splice(idx, 1);
                    room.lastActivity = Date.now();
                    console.log(`[Room] Last player ${leftController.name} disconnected mid-game — caller will force-end`);
                    this.ensureSingleLeader(room);
                    return { room, wasLeader, promotedControllerId: undefined };
                }

                leftController.disconnected = true;
                leftController.channel = null;
                leftController.isSpectating = true;

                // If every remaining player is now disconnected, no point in grace period.
                // The caller's hasActivePlayers check will force-end the game to lobby.
                const anyConnected = room.controllers.some(c => !c.disconnected);
                if (!anyConnected) {
                    this.logConnectionEvent({
                        roomId: room.roomId,
                        clientLabel: leftController.name,
                        eventType: 'controller_disconnect',
                        details: `All players disconnected mid-game in ${room.roomId} — will force-end`,
                        timestamp: Date.now(),
                    });
                    console.log(`[Room] All players disconnected mid-game in ${room.roomId} — caller will force-end`);
                    if (leftController.score > 0) {
                        room.disconnectedPlayerScores.set(leftController.clientId, {
                            clientId: leftController.clientId,
                            name: leftController.name,
                            colorIndex: leftController.colorIndex,
                            score: leftController.score,
                        });
                    }
                    room.lastActivity = Date.now();
                    this.ensureSingleLeader(room);
                    return { room, wasLeader, promotedControllerId: undefined };
                }

                if (leftController.score > 0) {
                    room.disconnectedPlayerScores.set(leftController.clientId, {
                        clientId: leftController.clientId,
                        name: leftController.name,
                        colorIndex: leftController.colorIndex,
                        score: leftController.score,
                    });
                }

                const clientId = leftController.clientId;
                const timer = setTimeout(() => {
                    this.fullyRemoveController(room.roomId, clientId);
                }, RoomManager.GRACE_MS);
                room.disconnectGraceTimers.set(clientId, timer);

                this.logConnectionEvent({
                    roomId: room.roomId,
                    clientLabel: leftController.name,
                    eventType: 'controller_disconnect',
                    details: `Controller ${leftController.name} disconnected during gameplay — ${RoomManager.GRACE_MS / 1000}s grace`,
                    timestamp: Date.now(),
                });
                console.log(`[Room] Controller ${leftController.name} (${clientId}) disconnected during gameplay — ${RoomManager.GRACE_MS / 1000}s grace`);
                const promotedControllerId = this.ensureSingleLeader(room);
                return { room, wasLeader, promotedControllerId };
            }

            // Lobby disconnect
            leftController.disconnected = true;
            leftController.channel = null;

            const clientId = leftController.clientId;
            const remainingConnected = room.controllers.filter(c => !c.disconnected && c !== leftController).length;

            if (remainingConnected === 0) {
                // Last player left the lobby — destroy the room immediately.
                // No grace period, no 500ms timer. The screen will get ROOM_EXPIRED
                // and create a fresh room.
                this.logConnectionEvent({
                    roomId: room.roomId,
                    clientLabel: leftController.name,
                    eventType: 'controller_disconnect',
                    details: `Last lobby player ${leftController.name} disconnected — destroying room`,
                    timestamp: Date.now(),
                });
                room.controllers.splice(idx, 1);
                room.lastActivity = Date.now();
                console.log(`[Room] Last lobby player ${leftController.name} (colorIndex: ${leftColorIndex}) disconnected — destroying room immediately`);
                const deletedRoom = this.deleteRoomById(room.roomId);
                if (deletedRoom) {
                    this.onEmptyLobbyDeleted?.(deletedRoom);
                }
                return { room, wasLeader, promotedControllerId: undefined };
            }

            const lobbyTimer = setTimeout(() => {
                this.fullyRemoveController(room.roomId, clientId);
            }, RoomManager.GRACE_MS);
            room.disconnectGraceTimers.set(clientId, lobbyTimer);

            this.logConnectionEvent({
                roomId: room.roomId,
                clientLabel: leftController.name,
                eventType: 'controller_disconnect',
                details: `Controller ${leftController.name} disconnected in lobby — ${RoomManager.GRACE_MS / 1000}s grace`,
                timestamp: Date.now(),
            });
            room.lastActivity = Date.now();
            const promotedControllerId = this.ensureSingleLeader(room);
            console.log(`[Room] Controller ${leftController.name} (colorIndex: ${leftColorIndex}) disconnected in lobby — ${RoomManager.GRACE_MS / 1000}s grace`);
            return { room, wasLeader, promotedControllerId };
        }
        return { room: null, wasLeader: false };
    }

    private ensureSingleLeader(room: Room): string | undefined {
        const connected = room.controllers.filter(c => !c.disconnected);
        if (connected.length === 0) return undefined;

        const currentLeaders = connected.filter(c => c.role === 'leader');

        if (currentLeaders.length > 1) {
            let keepLeader = currentLeaders[0];
            for (const c of currentLeaders) {
                if (c.colorIndex < keepLeader.colorIndex) keepLeader = c;
            }
            for (const c of currentLeaders) {
                if (c !== keepLeader) {
                    c.role = 'member';
                    console.log(`[Room] Demoted ${c.name} (${c.clientId.substring(0, 8)}) from leader — duplicate`);
                }
            }
            return undefined;
        }

        if (currentLeaders.length === 0) {
            let nextLeader = connected[0];
            for (const c of connected) {
                if (c.colorIndex < nextLeader.colorIndex) nextLeader = c;
            }
            nextLeader.role = 'leader';
            nextLeader.isReady = true;
            console.log(`[Room] Promoted ${nextLeader.name} (${nextLeader.clientId.substring(0, 8)}) as new leader`);
            return nextLeader.clientId;
        }

        return undefined;
    }

    private fullyRemoveController(roomId: string, clientId: string): string | undefined {
        const room = this.rooms.get(roomId);
        if (!room) return undefined;

        const idx = room.controllers.findIndex(c => c.clientId === clientId);
        if (idx === -1) return undefined;

        const controller = room.controllers[idx];
        room.controllers.splice(idx, 1);
        room.disconnectGraceTimers.delete(clientId);
        room.lastActivity = Date.now();

        this.logConnectionEvent({
            roomId,
            clientLabel: controller.name,
            eventType: 'controller_grace_expired',
            details: `Grace expired — fully removed ${controller.name} (${clientId})`,
            timestamp: Date.now(),
        });
        console.log(`[Room] Grace expired — fully removed ${controller.name} (${clientId})`);

        const connectedCount = room.controllers.filter(c => !c.disconnected).length;
        if (connectedCount === 0 && !room.gameStarted) {
            console.log(`[Room] Lobby ${roomId} empty after grace expired — destroying immediately`);
            const deletedRoom = this.deleteRoomById(roomId);
            if (deletedRoom) {
                this.onEmptyLobbyDeleted?.(deletedRoom);
            }
        }

        return this.ensureSingleLeader(room);
    }

    // ---- Reconnect ----

    reconnectController(
        roomId: string,
        clientId: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newChannel: any,
    ): { success: boolean; phase?: string; playerScores?: PlayerScoreEntry[]; resyncState?: Record<string, unknown>; error?: string } {
        const room = this.rooms.get(roomId);
        if (!room) {
            this.logConnectionEvent({
                roomId,
                clientLabel: clientId,
                eventType: 'controller_reconnect_failed',
                details: 'Room not found',
                timestamp: Date.now(),
            });
            return { success: false, error: 'Room not found' };
        }

        const controller = room.controllers.find(c => c.clientId === clientId && c.disconnected);
        if (!controller) {
            this.logConnectionEvent({
                roomId,
                clientLabel: clientId,
                eventType: 'controller_reconnect_failed',
                details: 'No disconnected controller found with that ID',
                timestamp: Date.now(),
            });
            return { success: false, error: 'No disconnected controller found with that ID' };
        }

        const timer = room.disconnectGraceTimers.get(clientId);
        if (timer) {
            clearTimeout(timer);
            room.disconnectGraceTimers.delete(clientId);
        }

        controller.disconnected = false;
        controller.isSpectating = false;
        controller.id = newChannel.id;
        controller.channel = newChannel;

        if (room.emptyLobbyTimer) {
            clearTimeout(room.emptyLobbyTimer);
            room.emptyLobbyTimer = undefined;
            console.log(`[Room] Empty-lobby timer cancelled — controller reconnected to ${roomId}`);
        }
        room.lastActivity = Date.now();
        room.disconnectedPlayerScores.delete(clientId);

        const otherLeader = room.controllers.find(
            c => c.clientId !== clientId && c.role === 'leader' && !c.disconnected,
        );
        if (otherLeader) controller.role = 'member';

        this.ensureSingleLeader(room);

        const phase = room.gameStarted ? 'playing' : 'lobby';
        const resyncState = room.gameStarted ? room.engine.getResyncState?.() : undefined;

        this.logConnectionEvent({
            roomId,
            clientLabel: controller.name,
            eventType: 'controller_reconnect',
            details: `Controller ${controller.name} reconnected — phase: ${phase}`,
            timestamp: Date.now(),
        });
        console.log(`[Room] Controller ${controller.name} (${clientId}) reconnected — phase: ${phase}`);
        return { success: true, phase, playerScores: this.getPlayerScores(roomId), resyncState };
    }

    markScreenDisconnected(
        channelId: string,
        onGraceExpired: (room: Room) => void,
    ): Room | null {
        for (const [, room] of this.rooms) {
            if (room.screenChannel?.id !== channelId) continue;
            if (room.screenDisconnected) return room;

            if (room.controllers.length === 0 && !room.gameStarted) {
                console.log(`[Room] Screen disconnected from empty landing page ${room.roomId} — deleting immediately`);
                onGraceExpired(room);
                return room;
            }

            room.screenDisconnected = true;
            room.lastActivity = Date.now();
            this.logConnectionEvent({
                roomId: room.roomId,
                clientLabel: room.screenLabel || 'Screen',
                eventType: 'screen_disconnect',
                details: `Screen disconnected from ${room.roomId} — ${RoomManager.GRACE_MS / 1000}s grace`,
                timestamp: Date.now(),
            });
            console.log(`[Room] Screen disconnected from ${room.roomId} — ${RoomManager.GRACE_MS / 1000}s grace`);

            room.screenGraceTimer = setTimeout(() => {
                room.screenGraceTimer = undefined;
                if (!room.screenDisconnected) {
                    console.log(`[Room] Grace timer fired but screen already reconnected for ${room.roomId} — ignoring`);
                    return;
                }
                onGraceExpired(room);
            }, RoomManager.GRACE_MS);

            return room;
        }
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reconnectScreen(roomId: string, newChannel: any): { success: boolean; error?: string } {
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: 'Room not found' };

        if (room.screenGraceTimer) {
            clearTimeout(room.screenGraceTimer);
            room.screenGraceTimer = undefined;
        }

        const wasDisconnected = room.screenDisconnected;
        room.screenChannel = newChannel;
        room.screenDisconnected = false;
        room.lastActivity = Date.now();

        if (wasDisconnected) {
            this.logConnectionEvent({
                roomId,
                clientLabel: room.screenLabel || 'Screen',
                eventType: 'screen_reconnect',
                details: `Screen reconnected to ${roomId}`,
                timestamp: Date.now(),
            });
        }
        console.log(`[Room] Screen took over channel for ${roomId} (was disconnected: ${wasDisconnected})`);
        return { success: true };
    }

    findRoomWithDisconnectedScreen(roomId: string): Room | null {
        const room = this.rooms.get(roomId);
        return room?.screenDisconnected ? room : null;
    }

    deleteRoomByScreen(channelId: string): Room | null {
        for (const [roomId, room] of this.rooms) {
            if (room.screenChannel?.id !== channelId && !room.screenDisconnected) continue;
            if (room.screenChannel?.id !== channelId && !room.screenDisconnected) continue;

            if (room.screenGraceTimer) {
                clearTimeout(room.screenGraceTimer);
                room.screenGraceTimer = undefined;
            }
            for (const t of room.disconnectGraceTimers.values()) clearTimeout(t);
            room.disconnectGraceTimers.clear();

            room.engine.destroy();
            this.rooms.delete(roomId);
            this.onRoomDeleted?.(roomId);
            return room;
        }
        return null;
    }

    deleteRoomById(roomId: string): Room | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        if (room.screenGraceTimer) {
            clearTimeout(room.screenGraceTimer);
            room.screenGraceTimer = undefined;
        }
        if (room.emptyLobbyTimer) {
            clearTimeout(room.emptyLobbyTimer);
            room.emptyLobbyTimer = undefined;
        }
        for (const t of room.disconnectGraceTimers.values()) clearTimeout(t);
        room.disconnectGraceTimers.clear();

        room.engine.destroy();
        this.rooms.delete(roomId);
        this.onRoomDeleted?.(roomId);
        return room;
    }

    // ---- Queries ----

    getRoom(roomId: string): Room | null {
        return this.rooms.get(roomId) || null;
    }

    findRoomByController(channelId: string): Room | null {
        for (const [, room] of this.rooms) {
            if (room.controllers.some(c => c.id === channelId)) return room;
        }
        return null;
    }

    findRoomByScreen(channelId: string): Room | null {
        for (const [, room] of this.rooms) {
            if (room.screenChannel?.id === channelId) return room;
        }
        return null;
    }

    hasActivePlayers(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        return room.controllers.some(c => !c.isSpectating);
    }

    forceEndGame(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        room.gameStarted = false;
        room.gameOverBroadcasted = false;
        room.engine.reset();
        for (const c of room.controllers) {
            c.isReady = true;
            c.isSpectating = false;
        }
        this.clearDisconnectedScores(roomId);
    }

    resetSpectatingStatus(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        for (const c of room.controllers) c.isSpectating = false;
    }

    leaveGame(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        const controller = room.controllers.find(c => c.clientId === clientId);
        if (!controller) return false;
        controller.isSpectating = true;
        console.log(`[Room] Player ${controller.name} (${clientId.substring(0, 8)}) is now spectating`);
        return true;
    }

    // ---- Scores ----

    addPlayerScore(roomId: string, clientId: string, points: number): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        const controller = room.controllers.find(c => c.clientId === clientId);
        if (controller) controller.score += points;
    }

    getPlayerScores(roomId: string): PlayerScoreEntry[] {
        const room = this.rooms.get(roomId);
        if (!room) return [];

        const activeScores = room.controllers.map(c => ({
            controllerId: c.clientId,
            name: c.name,
            colorIndex: c.colorIndex,
            score: c.score,
        }));

        const disconnectedScores = Array.from(room.disconnectedPlayerScores.values()).map(p => ({
            controllerId: p.clientId,
            name: p.name,
            colorIndex: p.colorIndex,
            score: p.score,
        }));

        return [...activeScores, ...disconnectedScores].sort((a, b) => b.score - a.score);
    }

    resetPlayerScores(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        for (const c of room.controllers) c.score = 0;
    }

    clearDisconnectedScores(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        room.disconnectedPlayerScores.clear();
        console.log(`[Room] Cleared disconnected scores in ${roomId}`);
    }

    // ---- Idle reaper ----

    private reapIdleRooms(): void {
        const now = Date.now();
        const STALE_ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

        for (const [roomId, room] of this.rooms) {
            const idleTime = now - room.lastActivity;

            // Landing page — exempt from 2-min reap; only reap after 2 hours
            if (room.controllers.length === 0 && !room.gameStarted) {
                if (idleTime > STALE_ROOM_TTL_MS) {
                    console.log(`[RoomManager] Reaping orphaned landing-page room ${roomId} (idle ${Math.round(idleTime / 60000)}min)`);
                    room.engine.destroy();
                    this.rooms.delete(roomId);
                    try { room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' }); } catch { /* closed */ }
                }
                continue;
            }

            if (!room.gameStarted && idleTime > RoomManager.IDLE_TIMEOUT_MS) {
                console.log(`[RoomManager] Reaping idle lobby/game-over room ${roomId} (idle ${Math.round(idleTime / 1000)}s)`);
                room.engine.destroy();
                this.rooms.delete(roomId);
                try {
                    room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' });
                    for (const controller of room.controllers) {
                        try { controller.channel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' }); } catch { /* closed */ }
                    }
                } catch { /* closed */ }
            }
        }
    }

    /** Broadcast current lobby state to screen and all controllers in a room */
    broadcastLobbyUpdate(roomId: string): void {
        const lobby = this.getLobbyState(roomId);
        const room = this.rooms.get(roomId);
        if (!lobby || !room) return;
        room.screenChannel.emit(EVENTS.LOBBY_UPDATE, lobby);
        for (const c of room.controllers) {
            if (c.channel) c.channel.emit(EVENTS.LOBBY_UPDATE, lobby);
        }
    }

    stopReaper(): void {
        if (this.idleReaperInterval) {
            clearInterval(this.idleReaperInterval);
            this.idleReaperInterval = null;
        }
    }

    /** Admin analytics: returns real data from the database */
    getAdminAnalytics(getRoomTopics?: (roomId: string) => { topicVotes: Record<string, string>; totalVoters: number }): {
        topicPopularity: Array<{ topicId: string; selectionCount: number; avgScore: number }>;
        difficultyStats: Array<{ difficulty: string; gamesPlayed: number; avgCorrectPct: number; avgScore: number }>;
        playerLeaderboard: Array<{ rank: number; playerName: string; totalScore: number; gamesPlayed: number }>;
        connectionStats: { total: number; recent: ConnectionEvent[] };
        apiCallLog: Array<{ roomId: string; rounds: number; apiCalls: number }>;
        roomTopics: Array<{ roomId: string; topicId: string; topicLabel: string; voteCount: number; totalVoters: number; questionsAnswered: number; correctAnswers: number; wrongAnswers: number }>;
        roomDifficulties: Array<{ roomId: string; difficulty: string; avgScore: number; avgCorrectPct: number }>;
        recentActivity: Array<{ timestamp: string; activeRooms: number; activePlayers: number }>;
    } {
        const recentLog = this.connectionLog.slice(-50);
        const roomTopics: Array<{ roomId: string; topicId: string; topicLabel: string; voteCount: number; totalVoters: number; questionsAnswered: number; correctAnswers: number; wrongAnswers: number }> = [];
        const roomDifficulties: Array<{ roomId: string; difficulty: string; avgScore: number; avgCorrectPct: number }> = [];
        for (const [, room] of this.rooms) {
            const topicVoteData = getRoomTopics?.(room.roomId) ?? { topicVotes: {}, totalVoters: 0 };
            const totalVoters = topicVoteData.totalVoters;
            const correctAnswers = room.engine.getSessionQuestionsAnswered();
            const totalAttempted = room.engine.getTotalQuestionsAttempted();
            const wrongAnswers = totalAttempted > correctAnswers ? totalAttempted - correctAnswers : 0;
            // Count votes per topic from the topicVotes map
            const voteCounts: Record<string, number> = {};
            for (const [, topicId] of Object.entries(topicVoteData.topicVotes)) {
                voteCounts[topicId] = (voteCounts[topicId] || 0) + 1;
            }
            // If no votes recorded but topic is set, show the topic with 0 votes
            if (Object.keys(voteCounts).length === 0 && room.currentTopic) {
                voteCounts[room.currentTopic] = 0;
            }
            for (const [topicId, count] of Object.entries(voteCounts)) {
                const topicLabel = QUIZ_TOPICS.find(t => t.id === topicId)?.label || topicId;
                roomTopics.push({
                    roomId: room.roomId,
                    topicId,
                    topicLabel,
                    voteCount: count,
                    totalVoters,
                    questionsAnswered: totalAttempted,
                    correctAnswers,
                    wrongAnswers,
                });
            }
            if (room.currentDifficulty) {
                const playerScores = this.getPlayerScores(room.roomId);
                const totalScore = playerScores.reduce((sum, p) => sum + p.score, 0);
                const avgScore = playerScores.length > 0 ? totalScore / playerScores.length : 0;
                roomDifficulties.push({
                    roomId: room.roomId,
                    difficulty: room.currentDifficulty,
                    avgScore: Math.round(avgScore * 10) / 10,
                    avgCorrectPct: 0,
                });
            }
        }
        return {
            topicPopularity: teamRepo.getTopicPopularity(),
            difficultyStats: teamRepo.getDifficultyStats(),
            playerLeaderboard: playerRepo.getPlayerLeaderboard(10),
            connectionStats: {
                total: this.connectionLog.length,
                recent: recentLog,
            },
            apiCallLog: getApiCallLog(),
            roomTopics,
            roomDifficulties,
            recentActivity: teamRepo.getRecentActivity(60),
        };
    }

    /** Admin monitoring: returns a JSON snapshot of all rooms and players */
    getAdminStatus(getTopicVotes?: (roomId: string) => { topicVotes: Record<string, string>; totalVoters: number }): {
        totalRooms: number;
        activeRooms: number;
        totalPlayers: number;
        connectedPlayers: number;
        reconnectingPlayers: number;
        rooms: Array<{
            roomId: string;
            gameType: string;
            gameStarted: boolean;
            lastActivity: number;
            screenDisconnected: boolean;
            screenLabel: string | null;
            currentTopic: string | null;
            currentDifficulty: string | null;
            topicVotes: Record<string, string>; // controllerId -> topicId
            totalVoters: number;
            players: Array<{
                id: string;
                clientId: string;
                name: string;
                role: string;
                colorIndex: number;
                score: number;
                isSpectating: boolean;
                disconnected: boolean;
            }>;
            leaderName: string | null;
        }>;
    } {
        let totalPlayers = 0;
        let connectedPlayers = 0;
        let reconnectingPlayers = 0;
        let activeRooms = 0;

        const rooms: Array<{
            roomId: string;
            gameType: string;
            gameStarted: boolean;
            lastActivity: number;
            screenDisconnected: boolean;
            screenLabel: string | null;
            currentTopic: string | null;
            currentDifficulty: string | null;
            topicVotes: Record<string, string>;
            totalVoters: number;
            players: Array<{
                id: string;
                clientId: string;
                name: string;
                role: string;
                colorIndex: number;
                score: number;
                isSpectating: boolean;
                disconnected: boolean;
            }>;
            leaderName: string | null;
        }> = [];

        for (const [, room] of this.rooms) {
            const playerList = room.controllers.map(c => ({
                id: c.id,
                clientId: c.clientId,
                name: c.name,
                role: c.role,
                colorIndex: c.colorIndex,
                score: c.score,
                isSpectating: c.isSpectating,
                disconnected: !!c.disconnected,
            }));

            const leader = room.controllers.find(c => c.role === 'leader' && !c.disconnected);

            totalPlayers += room.controllers.length;
            connectedPlayers += room.controllers.filter(c => !c.disconnected).length;
            reconnectingPlayers += room.controllers.filter(c => !!c.disconnected).length;

            if (room.gameStarted) activeRooms++;

            const topicVoteData = getTopicVotes?.(room.roomId) ?? { topicVotes: {}, totalVoters: 0 };

            rooms.push({
                roomId: room.roomId,
                gameType: room.gameType,
                gameStarted: room.gameStarted,
                lastActivity: room.lastActivity,
                screenDisconnected: !!room.screenDisconnected,
                screenLabel: room.screenLabel ?? null,
                currentTopic: room.currentTopic ?? null,
                currentDifficulty: room.currentDifficulty ?? null,
                topicVotes: topicVoteData.topicVotes,
                totalVoters: topicVoteData.totalVoters,
                players: playerList,
                leaderName: leader?.name ?? null,
            });
        }

        return {
            totalRooms: this.rooms.size,
            activeRooms,
            totalPlayers,
            connectedPlayers,
            reconnectingPlayers,
            rooms,
        };
    }
}
