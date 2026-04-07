// ==========================================
// Room Manager — Domain Layer
// ==========================================

import { randomBytes } from 'crypto';
import { QuizEngine } from './QuizEngine.ts';
import { EVENTS } from '../shared/protocol.ts';
import { PlayerManager } from './PlayerManager.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { PlayerRole, PlayerInfo, PlayerScoreEntry, LobbyState } from '../shared/types.ts';

export interface RoomController {
    id: string;
    clientId: string; // Persistent device ID
    role: PlayerRole;
    isReady: boolean;
    colorIndex: number; // For crosshair color assignment (0, 1, 2)
    name: string; // Individual player name
    score: number; // Individual player score for this game session
    isSpectating: boolean; // Whether player is currently in the lobby during an active game
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel: any; // Geckos.io ServerChannel
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    screenChannel: any; // Geckos.io ServerChannel
    controllers: RoomController[];
    quizEngine: QuizEngine;
    gameStarted: boolean;
    lastActivity: number; // Timestamp of last activity for idle reaping
    disconnectedPlayerScores: Map<string, DisconnectedPlayerScore>; // Scores of players who left during gameplay
}

export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    private idleReaperInterval: ReturnType<typeof setInterval> | null = null;
    private static readonly IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
    private static readonly REAPER_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

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
    createRoom(screenChannel: any): { roomId: string; joinToken: string } {
        const roomId = this.generateRoomId();
        const joinToken = this.generateToken();

        // Create quiz engine with unique session ID
        const sessionId = `room-${roomId}-${Date.now()}`;
        const quizEngine = new QuizEngine(sessionId);

        const room: Room = {
            roomId,
            joinToken,
            screenChannel,
            controllers: [],
            quizEngine,
            gameStarted: false,
            lastActivity: Date.now(),
            disconnectedPlayerScores: new Map(),
        };

        this.rooms.set(roomId, room);
        console.log(`[Room] Created: ${roomId} with session: ${sessionId}`);
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
            // Re-bind to the new connection but keep role, state, AND colorIndex
            existing.id = channel.id;
            existing.channel = channel;
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

        if (room.controllers.length >= CONFIG.MAX_PLAYERS_PER_ROOM) {
            return { success: false, error: 'Room is full (max 4 players)' };
        }

        if (room.gameStarted) {
            return { success: false, error: 'Game already in progress' };
        }

        // First controller = leader, rest = members
        const role: PlayerRole = room.controllers.length === 0 ? 'leader' : 'member';

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
        const defaultName = playerNumber === 1 ? 'Leader' : `Player ${playerNumber}`;

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
        console.log(`[Room] ${role.toUpperCase()} joined ${roomId} (clientId: ${clientId.substring(0, 8)}...)`);

        // If this is a returning player from the database, return their name
        const existingName = PlayerManager.getExistingPlayerName(clientId);
        if (existingName) {
            controller.name = existingName;
        }

        return { success: true, role, colorIndex, playerName: existingName ?? undefined };
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

    /** Check if all players are ready (or solo leader) */
    canStartGame(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        if (room.controllers.length === 0) return false;

        // Solo leader can always start
        if (room.controllers.length === 1) {

            return true;
        }

        // Otherwise all members must be ready
        const allReady = room.controllers.every((c) => {

            return c.isReady;
        });


        return allReady;
    }

    /** Start the game. Uses clientId for leader verification. */
    startGame(roomId: string, clientId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) {
            console.warn(`[RoomManager] Room ${roomId} not found`);
            return false;
        }

        // Only leader can start — look up by clientId, NOT channel.id
        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') {
            console.warn(`[RoomManager] Controller ${clientId} is not leader (role: ${controller?.role})`);
            return false;
        }

        const canStart = this.canStartGame(roomId);
        if (!canStart) {
            const room = this.rooms.get(roomId)!;
            const readyStatus = room.controllers.map(c => `${c.clientId.substring(0, 8)}: ready=${c.isReady}, role=${c.role}`).join(', ');
            console.warn(`[RoomManager] Cannot start game - not all players ready. Controllers: ${room.controllers.length}. Status: [${readyStatus}]`);
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

        const players: PlayerInfo[] = room.controllers.map((c) => ({
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

    /** Remove a controller from its room */
    removeController(channelId: string): { room: Room | null; wasLeader: boolean; promotedControllerId?: string } {
        for (const [, room] of this.rooms) {
            const idx = room.controllers.findIndex((c) => c.id === channelId);
            if (idx !== -1) {
                const wasLeader = room.controllers[idx].role === 'leader';
                const leftController = room.controllers[idx];
                const leftColorIndex = leftController.colorIndex;

                // If game is in progress, save the player's score so it's preserved on the scoreboard
                if (room.gameStarted && leftController.score > 0) {
                    room.disconnectedPlayerScores.set(leftController.clientId, {
                        clientId: leftController.clientId,
                        name: leftController.name,
                        colorIndex: leftController.colorIndex,
                        score: leftController.score,
                    });
                    console.log(`[Room] Saved score ${leftController.score} for disconnected player ${leftController.name} (${leftController.clientId})`);
                }

                room.controllers.splice(idx, 1);
                room.lastActivity = Date.now();

                // Preserve color indices in lobby to maintain character consistency
                // Only reassign during gameplay to avoid duplicate colors on scoreboard
                // Note: Color indices may have gaps now, which is fine for lobby consistency

                let promotedControllerId: string | undefined;

                // If leader left and there are still members, promote the controller with the lowest colorIndex
                // This ensures consistent leadership hierarchy (Wulf -> Talon -> Ryker -> Roux)
                if (wasLeader && room.controllers.length > 0) {
                    // Find the controller with the smallest colorIndex (maintains character hierarchy)
                    let nextLeader = room.controllers[0];
                    for (const controller of room.controllers) {
                        if (controller.colorIndex < nextLeader.colorIndex) {
                            nextLeader = controller;
                        }
                    }

                    nextLeader.role = 'leader';
                    nextLeader.isReady = true; // New leader is always ready
                    promotedControllerId = nextLeader.clientId;
                    console.log(`[Room] Leader left - promoted controller ${nextLeader.clientId} (${nextLeader.name}, colorIndex: ${nextLeader.colorIndex}) as new leader`);
                }

                console.log(`[Room] Controller left (colorIndex: ${leftColorIndex}), remaining: ${room.controllers.length}`);

                return { room, wasLeader, promotedControllerId };
            }
        }
        return { room: null, wasLeader: false };
    }

    /** Delete a room (when screen disconnects) */
    deleteRoomByScreen(channelId: string): Room | null {
        for (const [roomId, room] of this.rooms) {
            if (room.screenChannel.id === channelId) {
                room.quizEngine.destroy();
                this.rooms.delete(roomId);

                return room;
            }
        }
        return null;
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
            if (room.screenChannel.id === channelId) {
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
        room.quizEngine.reset(); // Silent reset

        // Reset ready states and spectating status
        this.resetSpectatingStatus(roomId);
        for (const c of room.controllers) {
            if (c.role === 'member') {
                c.isReady = false;
            }
        }
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
        // Also reset their ready state so they don't auto-ready for the next game
        if (controller.role === 'member') {
            controller.isReady = false;
        }
        console.log(`[Room] Player ${controller.name} (${clientId.substring(0, 8)}) is now spectating and unreadied`);
        return true;
    }

    /** Set player name. Uses clientId for lookup. */
    setPlayerName(roomId: string, clientId: string, name: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller) return false;

        controller.name = name;

        // Persist the name association immediately to the database
        PlayerManager.persistPlayerName(clientId, name);

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
                    room.quizEngine.destroy();
                    this.rooms.delete(roomId);
                    try { room.screenChannel.emit('room:expired', { reason: 'idle_timeout' }); } catch { /* closed */ }
                }
                continue; // Skip the 2-min check for Landing Page
            }

            // Lobby (team-lobby) or Winner Screen (game-over): reap after 2 minutes idle.
            // Gameplay is excluded — the QuizEngine timer drives it to game-over naturally.
            if (!room.gameStarted && idleTime > RoomManager.IDLE_TIMEOUT_MS) {
                console.log(`[RoomManager] Reaping idle lobby/game-over room ${roomId} (idle for ${Math.round(idleTime / 1000)}s)`);
                room.quizEngine.destroy();
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
