// ==========================================
// Room Manager — Domain Layer
// ==========================================

import { randomBytes } from 'crypto';
import { createGameEngine } from './GameRegistry.ts';
import type { GameEngine, GameType } from './GameEngine.ts';
import { QuizEngine } from './QuizEngine.ts';
import { EVENTS } from '../shared/protocol.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { PlayerRole, PlayerInfo, PlayerScoreEntry, LobbyState, QuizTopicId, QuizDifficulty, TopicVoteUpdatePayload, TopicSelectedPayload } from '../shared/types.ts';
import { QUIZ_TOPICS, DEFAULT_TOPIC, DEFAULT_DIFFICULTY, TOPIC_SELECTION_TIMEOUT_MS } from '../shared/types.ts';

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

export interface Room {
    roomId: string;
    joinToken: string;
    gameType: GameType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    screenChannel: any; // Geckos.io ServerChannel
    controllers: RoomController[];
    engine: GameEngine;
    gameStarted: boolean;
    lastActivity: number; // Timestamp of last activity for idle reaping
    disconnectedPlayerScores: Map<string, DisconnectedPlayerScore>;
    disconnectGraceTimers: Map<string, NodeJS.Timeout>;
    topicVotes: Map<string, QuizTopicId>;
    topicSelectionTimer: ReturnType<typeof setTimeout> | null;
    topicSelectionStarted: boolean;
    topicSelectionStartedAt: number | null;
    selectedDifficulty: QuizDifficulty;
    // Screen reconnect grace period
    screenDisconnected?: boolean;
    screenGraceTimer?: NodeJS.Timeout;
    // Empty lobby deletion timer (fires when last controller leaves the lobby)
    emptyLobbyTimer?: NodeJS.Timeout;
    // Topic selection countdown broadcast interval (stored so it can be cleared on room deletion)
    topicCountdownInterval?: ReturnType<typeof setInterval>;
}

export const PRE_CONFIG_NAMES = ['Wulf', 'Talon', 'Ryker', 'Zark'];

export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    private idleReaperInterval: ReturnType<typeof setInterval> | null = null;
    private static readonly IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
    private static readonly REAPER_INTERVAL_MS = 30 * 1000; // Check every 30 seconds
    /** Unified grace period for any disconnect (controller or screen) before removal/destruction (ms) */
    private static readonly GRACE_MS = 60_000;
    /** Delay before deleting an empty lobby (ms) */
    private static readonly EMPTY_LOBBY_DELETE_MS = 500;

    /** Called when an empty lobby is deleted so the transport layer can notify the screen */
    private onEmptyLobbyDeleted: ((room: Room) => void) | null = null;
    /** Called whenever any room is fully deleted — lets the transport layer clean up its own per-room state */
    private onRoomDeleted: ((roomId: string) => void) | null = null;

    setOnEmptyLobbyDeleted(cb: (room: Room) => void): void {
        this.onEmptyLobbyDeleted = cb;
    }

    setOnRoomDeleted(cb: (roomId: string) => void): void {
        this.onRoomDeleted = cb;
    }

    constructor() {
        // Start the idle room reaper
        this.idleReaperInterval = setInterval(() => this.reapIdleRooms(), RoomManager.REAPER_INTERVAL_MS);
        console.log('[RoomManager] Idle room reaper started (2 min timeout)');
    }
    /** Generate a 6-char room ID */
    private generateRoomId(): string {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    /** Generate a secure join token */
    private generateToken(): string {
        return randomBytes(16).toString('hex');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRoom(screenChannel: any, gameType: GameType = 'shootquiz'): { roomId: string; joinToken: string } {
        const roomId = this.generateRoomId();
        const joinToken = this.generateToken();

        // Create game engine via registry — decoupled from specific game type
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
            topicVotes: new Map(),
            topicSelectionTimer: null,
            topicSelectionStarted: false,
            topicSelectionStartedAt: null,
            selectedDifficulty: DEFAULT_DIFFICULTY,
        };

        this.rooms.set(roomId, room);
        console.log(`[Room] Created: ${roomId} (game: ${gameType}, session: ${sessionId})`);
        return { roomId, joinToken };
    }

    /** Join a room as a controller. First joiner becomes leader. */
    joinRoom(
        roomId: string,
        token: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        channel: any,
        clientId: string
    ): { success: boolean; error?: string; role?: PlayerRole; colorIndex?: number; playerName?: string } {
        const room = this.rooms.get(roomId);

        if (!room) {
            return { success: false, error: 'Room not found' };
        }

        if (room.joinToken !== token) {
            return { success: false, error: 'Invalid token' };
        }

        // 1. Check if this CLIENT (device) is already in the room (reconnecting)
        const existingIdx = room.controllers.findIndex(c => c.clientId === clientId);
        if (existingIdx !== -1) {
            const existing = room.controllers[existingIdx];
            existing.id = channel.id;
            existing.channel = channel;
            existing.disconnected = false;

            // If there is already another leader while this player was away, demote
            // the rejoining player to member so the promoted leader keeps their role.
            const otherLeader = room.controllers.find(c => c.clientId !== clientId && c.role === 'leader' && !c.disconnected);
            if (otherLeader) {
                existing.role = 'member';
            }

            this.ensureSingleLeader(room);
            return {
                success: true,
                role: existing.role,
                colorIndex: existing.colorIndex,
                playerName: existing.name
            };
        }

        // 1.5 Check if this player had a previous score (rejoining after disconnect)
        const previousScore = room.disconnectedPlayerScores.get(clientId);

        // If rejoining, remove from disconnected scores (will be added back if they leave again)
        if (previousScore) {
            room.disconnectedPlayerScores.delete(clientId);
            console.log(`[Room] Player ${clientId} rejoining, clearing disconnected score entry`);
        }

        // 2. Also check if this CHANNEL (connection) is in ANY other room and clean up
        this.removeController(channel.id);
        // removeController may have promoted a new leader in another room; that's fine.

        if (room.controllers.length >= CONFIG.MAX_PLAYERS_PER_ROOM) {
            return { success: false, error: 'Room is full (max 4 players)' };
        }

        if (room.gameStarted) {
            return { success: false, error: 'Game already in progress' };
        }

        // Determine role: leader only if no other leader exists in the room
        const currentLeaders = room.controllers.filter(c => c.role === 'leader');
        const role: PlayerRole = currentLeaders.length === 0 ? 'leader' : 'member';

        // Find the first available color index (for when players leave and rejoin)
        // But prefer to restore the previous colorIndex if available
        const usedColorIndices = new Set(room.controllers.map(c => c.colorIndex));
        let colorIndex = 0;

        if (previousScore && !usedColorIndices.has(previousScore.colorIndex)) {
            // Restore previous colorIndex if it's still available
            colorIndex = previousScore.colorIndex;
        } else {
            // Find first available color index
            while (usedColorIndices.has(colorIndex) && colorIndex < 4) {
                colorIndex++;
            }
        }

        // Assign default name based on position
        const playerNumber = room.controllers.length + 1;
        const defaultName = PRE_CONFIG_NAMES[colorIndex] || `Player ${playerNumber}`;

        const controller: RoomController = {
            id: channel.id,
            clientId,
            role,
            isReady: true, // Auto-ready by default, UI controls name entry phase
            colorIndex,
            name: defaultName,
            score: previousScore?.score || 0,
            isSpectating: false,
            channel,
        };

        room.controllers.push(controller);
        room.lastActivity = Date.now();

        // Cancel any pending empty-lobby deletion — someone just joined
        if (room.emptyLobbyTimer) {
            clearTimeout(room.emptyLobbyTimer);
            room.emptyLobbyTimer = undefined;
            console.log(`[Room] Empty-lobby timer cancelled — new controller joined ${roomId}`);
        }

        console.log(`[Room] ${role.toUpperCase()} joined ${roomId} (clientId: ${clientId.substring(0, 8)}...)`);

        return { success: true, role, colorIndex, playerName: undefined };
    }

    /** Mark a player as ready. Uses clientId for lookup. */
    setPlayerReady(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller) return false;

        controller.isReady = true;
        return true;
    }

    /** Check if game can be started (at least 1 connected player present) */
    canStartGame(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        return room.controllers.some(c => !c.disconnected);
    }

    /** Start the game. Uses clientId for leader verification. */
    startGame(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) {
            console.warn(`[RoomManager] Room ${roomId} not found`);
            return false;
        }

        // Safety: ensure exactly one leader before starting
        this.ensureSingleLeader(room);

        // Only leader can start — look up by clientId, NOT channel.id
        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') {
            console.warn(`[RoomManager] Controller ${clientId} is not leader (role: ${controller?.role})`);
            return false;
        }

        const canStart = this.canStartGame(roomId);
        if (!canStart) {
            console.warn(`[RoomManager] Cannot start game - no players in room ${roomId}`);
            return false;
        }

        console.log(`[RoomManager] Starting game in room ${roomId} with ${room.controllers.length} players`);
        room.gameStarted = true;
        room.lastActivity = Date.now();

        // Reset spectating status for all players when a new game starts
        for (const c of room.controllers) {
            c.isSpectating = false;
        }

        console.log(`[Room] Game started in ${roomId}`);
        return true;
    }

    /** Get lobby state for UI */
    getLobbyState(roomId: string): LobbyState | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        // Only include connected (non-disconnected) controllers in the lobby view
        const players: PlayerInfo[] = room.controllers
            .filter(c => !c.disconnected)
            .map((c) => ({
                id: c.clientId,
                role: c.role,
                isReady: c.isReady,
                colorIndex: c.colorIndex,
                name: c.name,
                isSpectating: c.isSpectating,
            }));

        return {
            roomId,
            players,
            canStart: this.canStartGame(roomId),
        };
    }

    removeController(channelId: string): { room: Room | null; wasLeader: boolean; promotedControllerId?: string } {
        for (const [, room] of this.rooms) {
            const idx = room.controllers.findIndex((c) => c.id === channelId);
            if (idx === -1) continue;

            const wasLeader = room.controllers[idx].role === 'leader';
            const leftController = room.controllers[idx];
            const leftColorIndex = leftController.colorIndex;

            if (room.gameStarted) {
                // Last player disconnecting during gameplay — delete room+session immediately
                if (room.controllers.length === 1) {
                    room.controllers.splice(idx, 1);
                    room.lastActivity = Date.now();
                    console.log(`[Room] Last player ${leftController.name} disconnected during gameplay — deleting room+session immediately`);
                    if (!room.emptyLobbyTimer) {
                        room.emptyLobbyTimer = setTimeout(() => {
                            const deletedRoom = this.deleteRoomById(room.roomId);
                            if (deletedRoom) {
                                console.log(`[Room] Room ${room.roomId} deleted after last player left`);
                                this.onEmptyLobbyDeleted?.(deletedRoom);
                            }
                        }, RoomManager.EMPTY_LOBBY_DELETE_MS);
                    }
                    return { room, wasLeader, promotedControllerId: undefined };
                }

                // Other players still in game — 60s grace so network blips don't lose progress
                leftController.disconnected = true;
                leftController.channel = null;

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

                console.log(`[Room] Controller ${leftController.name} (${clientId}) disconnected during gameplay — ${RoomManager.GRACE_MS / 1000}s grace period started`);

                const promotedControllerId = this.ensureSingleLeader(room);
                return { room, wasLeader, promotedControllerId };
            }

            // Lobby disconnect — if this is the last connected player, skip the grace
            // period and go straight to the 1s empty-lobby deletion.
            leftController.disconnected = true;
            leftController.channel = null;

            const clientId = leftController.clientId;
            const remainingConnected = room.controllers.filter(c => !c.disconnected && c !== leftController).length;

            if (remainingConnected === 0) {
                // Nobody left — fully remove immediately and let the empty-lobby timer handle deletion
                room.controllers.splice(idx, 1);
                room.lastActivity = Date.now();
                console.log(`[Room] Last lobby player ${leftController.name} (colorIndex: ${leftColorIndex}) disconnected — scheduling room deletion in ${RoomManager.EMPTY_LOBBY_DELETE_MS}ms`);
                if (!room.emptyLobbyTimer) {
                    room.emptyLobbyTimer = setTimeout(() => {
                        const deletedRoom = this.deleteRoomById(room.roomId);
                        if (deletedRoom) {
                            console.log(`[Room] Empty lobby ${room.roomId} deleted`);
                            this.onEmptyLobbyDeleted?.(deletedRoom);
                        }
                    }, RoomManager.EMPTY_LOBBY_DELETE_MS);
                }
                const promotedControllerId = this.ensureSingleLeader(room);
                return { room, wasLeader, promotedControllerId };
            }

            // Other players still connected — use the unified grace period so brief
            // network blips don't permanently remove the player's slot and color.
            const lobbyTimer = setTimeout(() => {
                this.fullyRemoveController(room.roomId, clientId);
            }, RoomManager.GRACE_MS);
            room.disconnectGraceTimers.set(clientId, lobbyTimer);

            room.lastActivity = Date.now();
            const promotedControllerId = this.ensureSingleLeader(room);
            console.log(`[Room] Controller ${leftController.name} (colorIndex: ${leftColorIndex}) disconnected in lobby — ${RoomManager.GRACE_MS / 1000}s grace period started`);
            return { room, wasLeader, promotedControllerId };
        }
        return { room: null, wasLeader: false };
    }

    /**
     * Ensures exactly one connected (non-disconnected) controller has role='leader'.
     * If no leader exists among connected controllers, promotes the one with the
     * lowest colorIndex. Returns the clientId of the promoted controller, or
     * undefined if no promotion was needed.
     */
    private ensureSingleLeader(room: Room): string | undefined {
        const connected = room.controllers.filter(c => !c.disconnected);
        if (connected.length === 0) return undefined;

        let currentLeaders = connected.filter(c => c.role === 'leader');

        if (currentLeaders.length > 1) {
            // Multiple leaders: keep the one with the lowest colorIndex, demote the rest
            let keepLeader = currentLeaders[0];
            for (const c of currentLeaders) {
                if (c.colorIndex < keepLeader.colorIndex) keepLeader = c;
            }
            for (const c of currentLeaders) {
                if (c !== keepLeader) {
                    c.role = 'member';
                    console.log(`[Room] Demoted ${c.name} (${c.clientId.substring(0, 8)}) from leader to member — duplicate leader`);
                }
            }
            return undefined;
        }

        if (currentLeaders.length === 0) {
            // No leader among connected controllers — promote the one with lowest colorIndex
            let nextLeader = connected[0];
            for (const c of connected) {
                if (c.colorIndex < nextLeader.colorIndex) nextLeader = c;
            }
            nextLeader.role = 'leader';
            nextLeader.isReady = true;
            console.log(`[Room] No leader found — promoted ${nextLeader.name} (${nextLeader.clientId.substring(0, 8)}) as new leader`);
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

        console.log(`[Room] Grace period expired — fully removed controller ${controller.name} (${clientId})`);

        // If the lobby is now completely empty, schedule room deletion in 5s
        const connectedCount = room.controllers.filter(c => !c.disconnected).length;
        if (connectedCount === 0 && !room.gameStarted) {
            if (!room.emptyLobbyTimer) {
                console.log(`[Room] Lobby ${roomId} is empty — scheduling deletion in ${RoomManager.EMPTY_LOBBY_DELETE_MS}ms`);
                room.emptyLobbyTimer = setTimeout(() => {
                    const deletedRoom = this.deleteRoomById(roomId);
                    if (deletedRoom) {
                        console.log(`[Room] Empty lobby ${roomId} deleted`);
                        this.onEmptyLobbyDeleted?.(deletedRoom);
                    }
                }, RoomManager.EMPTY_LOBBY_DELETE_MS);
            }
        }

        return this.ensureSingleLeader(room);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reconnectController(roomId: string, clientId: string, newChannel: any): { success: boolean; phase?: string; playerScores?: PlayerScoreEntry[]; resyncState?: Record<string, unknown>; error?: string } {
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: 'Room not found' };

        // Accept reconnect for both gameplay and lobby disconnects
        const controller = room.controllers.find(c => c.clientId === clientId && c.disconnected);
        if (!controller) return { success: false, error: 'No disconnected controller found with that ID' };

        // Clear any pending grace timer
        const timer = room.disconnectGraceTimers.get(clientId);
        if (timer) {
            clearTimeout(timer);
            room.disconnectGraceTimers.delete(clientId);
        }

        controller.disconnected = false;
        controller.id = newChannel.id; // Update channel ID to new connection
        controller.channel = newChannel;

        // Cancel any pending empty-lobby deletion
        if (room.emptyLobbyTimer) {
            clearTimeout(room.emptyLobbyTimer);
            room.emptyLobbyTimer = undefined;
            console.log(`[Room] Empty-lobby timer cancelled — controller reconnected to ${roomId}`);
        }
        room.lastActivity = Date.now();

        // Remove from disconnected scores map (score is live on the controller object)
        room.disconnectedPlayerScores.delete(clientId);

        // If another leader was promoted while this player was disconnected, keep
        // the promoted leader and demote the rejoining player to member.
        const otherLeader = room.controllers.find(c => c.clientId !== clientId && c.role === 'leader' && !c.disconnected);
        if (otherLeader) {
            controller.role = 'member';
        }

        this.ensureSingleLeader(room);

        const phase = room.gameStarted ? 'playing' : 'lobby';

        // Provide current game state so the reconnected client can resync
        const resyncState = room.gameStarted
            ? room.engine.getResyncState?.()
            : undefined;

        console.log(`[Room] Controller ${controller.name} (${clientId}) reconnected — phase: ${phase}`);

        return {
            success: true,
            phase,
            playerScores: this.getPlayerScores(roomId),
            resyncState,
        };
    }

    /**
     * Mark the screen as disconnected and start a grace period.
     * Returns the room if found, null otherwise.
     * The caller is responsible for destroying the room if the grace timer fires.
     */
    markScreenDisconnected(
        channelId: string,
        onGraceExpired: (room: Room) => void
    ): Room | null {
        for (const [, room] of this.rooms) {
            if (room.screenChannel?.id !== channelId) continue;

            // Already in grace period — ignore duplicate disconnect
            if (room.screenDisconnected) return room;

            // The screen channel has already been replaced by a reconnect — the old
            // channel's onDisconnect fired late. Do not start a new grace period.
            // (room.screenChannel.id !== channelId means a new channel took over)
            // This check is redundant with the one above but kept for clarity.

            // Landing page with no players — delete immediately, no grace needed
            if (room.controllers.length === 0 && !room.gameStarted) {
                console.log(`[Room] Screen disconnected from empty landing page ${room.roomId} — deleting immediately`);
                onGraceExpired(room);
                return room;
            }

            room.screenDisconnected = true;
            room.lastActivity = Date.now();

            console.log(`[Room] Screen disconnected from ${room.roomId} — ${RoomManager.GRACE_MS / 1000}s grace period started`);

            room.screenGraceTimer = setTimeout(() => {
                room.screenGraceTimer = undefined;
                // Double-check the room hasn't reconnected while the timer was pending
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

    /**
     * Reconnect (or take over) the screen channel for an existing room.
     * Works whether the screen was already marked disconnected or not —
     * handles the race where the new channel arrives before the old one closes.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reconnectScreen(roomId: string, newChannel: any): { success: boolean; error?: string } {
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: 'Room not found' };

        // Clear any pending grace timer (covers both the disconnected and race-condition cases)
        if (room.screenGraceTimer) {
            clearTimeout(room.screenGraceTimer);
            room.screenGraceTimer = undefined;
        }

        const wasDisconnected = room.screenDisconnected;
        room.screenChannel = newChannel;
        room.screenDisconnected = false;
        room.lastActivity = Date.now();

        console.log(`[Room] Screen took over channel for ${roomId} (was disconnected: ${wasDisconnected})`);
        return { success: true };
    }

    /** Find a room that has a disconnected screen (for screen reconnect flow) */
    findRoomWithDisconnectedScreen(roomId: string): Room | null {
        const room = this.rooms.get(roomId);
        return room?.screenDisconnected ? room : null;
    }

    /** Delete a room (when screen grace period expires or screen leaves intentionally) */
    deleteRoomByScreen(channelId: string): Room | null {
        for (const [roomId, room] of this.rooms) {
            if (room.screenChannel?.id === channelId || room.screenDisconnected) {
                // Only delete if the channel matches OR the room is already in grace period
                if (room.screenChannel?.id !== channelId && !room.screenDisconnected) continue;

                if (room.screenGraceTimer) {
                    clearTimeout(room.screenGraceTimer);
                    room.screenGraceTimer = undefined;
                }
                // Clear topic selection timer
                if (room.topicSelectionTimer) {
                    clearTimeout(room.topicSelectionTimer);
                    room.topicSelectionTimer = null;
                }
                // Clear topic countdown broadcast interval
                if (room.topicCountdownInterval) {
                    clearInterval(room.topicCountdownInterval);
                    room.topicCountdownInterval = undefined;
                }
                // Clear all controller grace timers
                for (const t of room.disconnectGraceTimers.values()) clearTimeout(t);
                room.disconnectGraceTimers.clear();

                room.engine.destroy();
                this.rooms.delete(roomId);
                this.onRoomDeleted?.(roomId);
                return room;
            }
        }
        return null;
    }

    /** Delete a room by its roomId directly (used after grace period expires) */
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
        if (room.topicSelectionTimer) {
            clearTimeout(room.topicSelectionTimer);
            room.topicSelectionTimer = null;
        }
        if (room.topicCountdownInterval) {
            clearInterval(room.topicCountdownInterval);
            room.topicCountdownInterval = undefined;
        }
        for (const t of room.disconnectGraceTimers.values()) clearTimeout(t);
        room.disconnectGraceTimers.clear();

        room.engine.destroy();
        this.rooms.delete(roomId);
        this.onRoomDeleted?.(roomId);
        return room;
    }

    /** Get room by ID */
    getRoom(roomId: string): Room | null {
        return this.rooms.get(roomId) || null;
    }

    /** Find room by controller channel ID */
    findRoomByController(channelId: string): Room | null {
        for (const [, room] of this.rooms) {
            if (room.controllers.some((c) => c.id === channelId)) {
                return room;
            }
        }
        return null;
    }

    /** Find room by screen channel ID */
    findRoomByScreen(channelId: string): Room | null {
        for (const [, room] of this.rooms) {
            if (room.screenChannel?.id === channelId) {
                return room;
            }
        }
        return null;
    }

    /** Check if anyone is actually playing (not spectating) */
    hasActivePlayers(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        // Someone is active if they are NOT spectating
        return room.controllers.some(c => !c.isSpectating);
    }

    /** Force end the game and return to lobby */
    forceEndGame(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.gameStarted = false;
        room.engine.reset();

        this.resetSpectatingStatus(roomId);
        for (const c of room.controllers) {
            c.isReady = true;
        }
        this.clearDisconnectedScores(roomId);
    }

    /** Reset spectating status for all players in a room */
    resetSpectatingStatus(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        for (const c of room.controllers) {
            c.isSpectating = false;
        }
    }

    /** Set player spectating status (leaves game but stays in room) */
    leaveGame(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller) return false;

        controller.isSpectating = true;
        console.log(`[Room] Player ${controller.name} (${clientId.substring(0, 8)}) is now spectating`);
        return true;
    }

    /** Add points to an individual player's score */
    addPlayerScore(roomId: string, clientId: string, points: number): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (controller) {
            controller.score += points;
        }
    }

    /** Get individual player scores sorted by highest score first */
    getPlayerScores(roomId: string): PlayerScoreEntry[] {
        const room = this.rooms.get(roomId);
        if (!room) return [];

        // Get scores from active controllers
        const activeScores = room.controllers.map((c) => ({
            controllerId: c.clientId,
            name: c.name,
            colorIndex: c.colorIndex,
            score: c.score,
        }));

        // Include scores from disconnected players
        const disconnectedScores = Array.from(room.disconnectedPlayerScores.values()).map((p) => ({
            controllerId: p.clientId,
            name: p.name,
            colorIndex: p.colorIndex,
            score: p.score,
        }));

        // Combine and sort by score
        return [...activeScores, ...disconnectedScores].sort((a, b) => b.score - a.score);
    }

    /** Reset all player scores (for game restart) */
    resetPlayerScores(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        for (const c of room.controllers) {
            c.score = 0;
        }
    }

    /** Clear disconnected player scores (called after game over) */
    clearDisconnectedScores(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.disconnectedPlayerScores.clear();
        console.log(`[Room] Cleared disconnected scores in ${roomId}`);
    }

    /** Set difficulty — only the leader can change it */
    setDifficulty(roomId: string, clientId: string, difficulty: QuizDifficulty): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const controller = room.controllers.find(c => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') return false;

        room.selectedDifficulty = difficulty;
        console.log(`[Room] Difficulty set to "${difficulty}" in ${roomId} by leader ${clientId.substring(0, 8)}`);
        return true;
    }

    startTopicSelection(roomId: string): TopicVoteUpdatePayload | null {
        const room = this.rooms.get(roomId);
        if (!room || room.topicSelectionStarted) return null;

        room.topicVotes.clear();
        room.topicSelectionStarted = true;
        room.topicSelectionStartedAt = Date.now();

        room.topicSelectionTimer = setTimeout(() => {
            console.log(`[Room] Topic selection timeout in ${roomId}`);
            // Timer expired, resolution will be handled elsewhere
        }, TOPIC_SELECTION_TIMEOUT_MS);

        console.log(`[Room] Topic selection started in ${roomId}`);

        return this.getTopicVoteUpdate(roomId);
    }

    castTopicVote(roomId: string, clientId: string, topicId: QuizTopicId): { accepted: boolean; update: TopicVoteUpdatePayload | null; resolved: TopicSelectedPayload | null } {
        const room = this.rooms.get(roomId);
        if (!room || !room.topicSelectionStarted) return { accepted: false, update: null, resolved: null };

        const validTopic = QUIZ_TOPICS.find(t => t.id === topicId);
        if (!validTopic) return { accepted: false, update: null, resolved: null };

        room.topicVotes.set(clientId, topicId);

        const update = this.getTopicVoteUpdate(roomId)!;

        const activePlayers = room.controllers.filter(c => !c.disconnected);
        const allVoted = room.topicVotes.size >= activePlayers.length;

        if (allVoted) {
            if (room.topicSelectionTimer) {
                clearTimeout(room.topicSelectionTimer);
                room.topicSelectionTimer = null;
            }
            const resolved = this.resolveTopicVote(roomId);
            return { accepted: true, update, resolved };
        }

        if (room.controllers.length === 1) {
            if (room.topicSelectionTimer) {
                clearTimeout(room.topicSelectionTimer);
                room.topicSelectionTimer = null;
            }
            const resolved = this.resolveTopicVote(roomId);
            return { accepted: true, update, resolved };
        }

        return { accepted: true, update, resolved: null };
    }

    resolveTopicVote(roomId: string): TopicSelectedPayload {
        const room = this.rooms.get(roomId);
        if (!room) return { topicId: DEFAULT_TOPIC, topicLabel: QUIZ_TOPICS.find(t => t.id === DEFAULT_TOPIC)!.label, difficulty: DEFAULT_DIFFICULTY };

        const voteCounts = new Map<QuizTopicId, number>();
        for (const [, topicId] of room.topicVotes) {
            voteCounts.set(topicId, (voteCounts.get(topicId) || 0) + 1);
        }

        let selectedTopic: QuizTopicId;
        let maxVotes = 0;
        let tiedTopics: QuizTopicId[] = [];

        for (const [topicId, count] of voteCounts) {
            if (count > maxVotes) {
                maxVotes = count;
                tiedTopics = [topicId];
            } else if (count === maxVotes) {
                tiedTopics.push(topicId);
            }
        }

        if (tiedTopics.length === 0 || room.topicVotes.size === 0) {
            selectedTopic = DEFAULT_TOPIC;
            console.log(`[Room] No votes cast in ${roomId}, defaulting to ${DEFAULT_TOPIC}`);
        } else if (tiedTopics.length === 1) {
            selectedTopic = tiedTopics[0];
        } else {
            const leader = room.controllers.find(c => c.role === 'leader' && !c.disconnected);
            const leaderVote = leader ? room.topicVotes.get(leader.clientId) : null;
            selectedTopic = leaderVote && tiedTopics.includes(leaderVote) ? leaderVote : tiedTopics[0];
            console.log(`[Room] Tie in ${roomId}, leader's vote: ${leaderVote || 'none'}, selected: ${selectedTopic}`);
        }

        const topicLabel = QUIZ_TOPICS.find(t => t.id === selectedTopic)?.label || selectedTopic;
        room.topicSelectionStarted = false;
        room.topicSelectionTimer = null;

        // setTopic is quiz-specific — cast safely
        if (room.engine instanceof QuizEngine) {
            room.engine.setTopic(selectedTopic);
        }

        console.log(`[Room] Topic selected in ${roomId}: ${selectedTopic} (${topicLabel})`);
        return { topicId: selectedTopic, topicLabel, difficulty: room.selectedDifficulty };
    }

    getTopicVoteUpdate(roomId: string): TopicVoteUpdatePayload | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const votes: Record<string, number> = {};
        const playerVotes: Record<string, string> = {};
        for (const [clientId, topicId] of room.topicVotes) {
            votes[clientId] = 1;
            playerVotes[clientId] = topicId;
        }

        const votedControllerIds = Array.from(room.topicVotes.keys());
        const activePlayers = room.controllers.filter(c => !c.disconnected);
        const totalVoters = activePlayers.length;

        const elapsedMs = room.topicSelectionStartedAt ? Date.now() - room.topicSelectionStartedAt : 0;
        const timeLeft = room.topicSelectionTimer == null
            ? 0
            : Math.max(0, Math.ceil((TOPIC_SELECTION_TIMEOUT_MS - elapsedMs) / 1000));

        return { votes, votedControllerIds, playerVotes, totalVoters, timeLeft, difficulty: room.selectedDifficulty };
    }

    isTopicSelectionStarted(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        return room?.topicSelectionStarted ?? false;
    }

    /** Reap idle rooms — Landing Page (0 players, game not started) is exempt.
     *  Only reaps rooms that have progressed to Lobby or Game Over and gone idle. */
    private reapIdleRooms(): void {
        const now = Date.now();
        const STALE_ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — safety net for orphaned screen rooms

        for (const [roomId, room] of this.rooms) {
            const idleTime = now - room.lastActivity;

            // Landing Page state: screen is waiting for the first player.
            // Do NOT reap — the QR code must stay stable indefinitely.
            // Exception: if the room has been completely idle for 2 hours it's orphaned (screen left).
            if (room.controllers.length === 0 && !room.gameStarted) {
                if (idleTime > STALE_ROOM_TTL_MS) {
                    console.log(`[RoomManager] Reaping orphaned landing-page room ${roomId} (idle for ${Math.round(idleTime / 60000)}min)`);
                    room.engine.destroy();
                    this.rooms.delete(roomId);
                    try { room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' }); } catch { /* closed */ }
                }
                continue; // Skip the 2-min check for Landing Page
            }

            // Lobby (team-lobby) or Winner Screen (game-over): reap after 2 minutes idle.
            // Gameplay is excluded — the game engine timer drives it to game-over naturally.
            if (!room.gameStarted && idleTime > RoomManager.IDLE_TIMEOUT_MS) {
                console.log(`[RoomManager] Reaping idle lobby/game-over room ${roomId} (idle for ${Math.round(idleTime / 1000)}s)`);
                room.engine.destroy();
                this.rooms.delete(roomId);
                try {
                    room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' });
                    // Also notify all connected controllers so they can return to landing page
                    for (const controller of room.controllers) {
                        try {
                            controller.channel.emit(EVENTS.ROOM_EXPIRED, { reason: 'idle_timeout' });
                        } catch { /* channel closed */ }
                    }
                } catch { /* channel may already be closed */ }
            }
        }
    }

    /** Stop the idle reaper (for graceful shutdown) */
    stopReaper(): void {
        if (this.idleReaperInterval) {
            clearInterval(this.idleReaperInterval);
            this.idleReaperInterval = null;
        }
    }
}
