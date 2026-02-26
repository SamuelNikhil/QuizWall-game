// ==========================================
// Room Manager — Domain Layer
// ==========================================

import { randomBytes } from 'crypto';
import { QuizEngine } from './QuizEngine.ts';
import { TeamManager } from './TeamManager.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { PlayerRole, PlayerInfo, LobbyState } from '../shared/types.ts';

export interface RoomController {
    id: string;
    clientId: string; // Persistent device ID
    role: PlayerRole;
    isReady: boolean;
    colorIndex: number; // For crosshair color assignment (0, 1, 2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel: any; // Geckos.io ServerChannel
}

export interface Room {
    roomId: string;
    joinToken: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    screenChannel: any; // Geckos.io ServerChannel
    controllers: RoomController[];
    quizEngine: QuizEngine;
    teamManager: TeamManager;
    gameStarted: boolean;
    lastActivity: number; // Timestamp of last activity for idle reaping
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
            teamManager: new TeamManager(),
            gameStarted: false,
            lastActivity: Date.now(),
        };

        this.rooms.set(roomId, room);
        console.log(`[Room] Created: ${roomId} with session: ${sessionId}`);
        return { roomId, joinToken };
    }

    /** Join a room as a controller. First joiner becomes leader. */
    joinRoom(
        roomId: string,
        token: string,
        channel: any,
        clientId: string
    ): { success: boolean; error?: string; role?: PlayerRole; colorIndex?: number } {
        const room = this.rooms.get(roomId);

        if (!room) {

            return { success: false, error: 'Room not found' };
        }

        if (room.joinToken !== token) {

            return { success: false, error: 'Invalid token' };
        }

        // 1. Check if this CLIENT (device) is already in the room
        const existingIdx = room.controllers.findIndex(c => c.clientId === clientId);
        if (existingIdx !== -1) {
            const existing = room.controllers[existingIdx];


            // Re-bind to the new connection but keep role, state, AND colorIndex
            existing.id = channel.id;
            existing.channel = channel;

            return { success: true, role: existing.role, colorIndex: existing.colorIndex };
        }

        // 2. Also check if this CHANNEL (connection) is in ANY other room and clean up
        this.removeController(channel.id);

        if (room.controllers.length >= CONFIG.MAX_PLAYERS_PER_ROOM) {

            return { success: false, error: 'Room is full (max 3 players)' };
        }

        if (room.gameStarted) {

            return { success: false, error: 'Game already in progress' };
        }

        // First controller = leader, rest = members
        const role: PlayerRole = room.controllers.length === 0 ? 'leader' : 'member';

        // Assign color index based on position (0, 1, 2 for up to 3 players)
        const colorIndex = room.controllers.length;

        const controller: RoomController = {
            id: channel.id,
            clientId,
            role,
            isReady: role === 'leader', // Leader is always "ready"
            colorIndex,
            channel,
        };

        room.controllers.push(controller);
        room.lastActivity = Date.now();
        console.log(`[Room] ${role.toUpperCase()} joined ${roomId}`);

        return { success: true, role, colorIndex };
    }

    /** Set team name (leader only). Uses clientId for lookup. */
    setTeamName(roomId: string, clientId: string, name: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') return false;

        room.teamManager.setTeamName(name);
        return true;
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

            return false;
        }

        // Only leader can start — look up by clientId, NOT channel.id
        const controller = room.controllers.find((c) => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') {

            return false;
        }

        const canStart = this.canStartGame(roomId);
        if (!canStart) {

            return false;
        }

        room.gameStarted = true;
        room.lastActivity = Date.now();
        console.log(`[Room] Game started in ${roomId}`);
        return true;
    }

    /** Get lobby state for UI */
    getLobbyState(roomId: string): LobbyState | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const members: PlayerInfo[] = room.controllers.map((c) => ({
            id: c.id,
            role: c.role,
            isReady: c.isReady,
            colorIndex: c.colorIndex,
        }));

        return {
            roomId,
            team: {
                name: room.teamManager.getTeamName(),
                members,
            },
            canStart: this.canStartGame(roomId),
        };
    }

    /** Remove a controller from its room */
    removeController(channelId: string): { room: Room | null; wasLeader: boolean } {
        for (const [, room] of this.rooms) {
            const idx = room.controllers.findIndex((c) => c.id === channelId);
            if (idx !== -1) {
                const wasLeader = room.controllers[idx].role === 'leader';
                room.controllers.splice(idx, 1);
                room.lastActivity = Date.now();

                // If leader left and there are still members, promote first member
                if (wasLeader && room.controllers.length > 0) {
                    room.controllers[0].role = 'leader';
                    room.controllers[0].isReady = true;

                }


                return { room, wasLeader };
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

    /** Reap idle rooms that have no controllers and haven't been active */
    private reapIdleRooms(): void {
        const now = Date.now();
        for (const [roomId, room] of this.rooms) {
            const idleTime = now - room.lastActivity;
            if (room.controllers.length === 0 && !room.gameStarted && idleTime > RoomManager.IDLE_TIMEOUT_MS) {
                console.log(`[RoomManager] Reaping idle room ${roomId} (idle for ${Math.round(idleTime / 1000)}s)`);
                room.quizEngine.destroy();
                this.rooms.delete(roomId);

                // Notify screen that room was cleaned up
                try {
                    room.screenChannel.emit('room:expired', { reason: 'idle_timeout' });
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
