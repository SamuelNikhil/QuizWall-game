// ==========================================
// Event Handlers — Transport Layer (Core)
// Handles room lifecycle events only.
// Game-specific logic lives in plugin handlers.
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { RoomManager } from '../domain/RoomManager.ts';
import { PlayerManager } from '../domain/PlayerManager.ts';
import { QuizEngine } from '../modes/ShootQuiz/QuizEngine.ts';
import { ShootQuizPlugin } from '../modes/ShootQuiz/ShootQuizPlugin.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function registerEventHandlers(io: GeckosServer, roomManager: RoomManager): void {

    // ---- Plugin registration ----
    // Each game plugin registers its own Geckos.io event handlers here.
    // The core room lifecycle below is game-agnostic.
    const shootQuizPlugin = new ShootQuizPlugin(roomManager);
    shootQuizPlugin.registerHandlers(io);

    // ---- Room lifecycle callbacks ----

    roomManager.setOnEmptyLobbyDeleted((deletedRoom) => {
        if (!deletedRoom.screenDisconnected && deletedRoom.screenChannel) {
            try {
                deletedRoom.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' });
                console.log(`[Transport] Notified screen of empty lobby deletion for room ${deletedRoom.roomId}`);
            } catch { /* screen channel may already be closed */ }
        }
    });

    // ---- Per-connection handlers ----

    io.onConnection((channel: ServerChannel) => {

        // Handshake timeout — close idle channels that never send CREATE_ROOM or JOIN_ROOM
        const timeoutId = setTimeout(() => {
            if (connectionTimeouts.has(channel.id)) {
                connectionTimeouts.delete(channel.id);
                console.warn(`[Transport] Handshake timeout for channel ${channel.id} — closing`);
                try { channel.close(); } catch { /* already closed */ }
            }
        }, 15_000);
        connectionTimeouts.set(channel.id, timeoutId);

        // ---- CREATE_ROOM (screen) ----

        channel.on(EVENTS.CREATE_ROOM, (data?: { roomId?: string }) => {
            clearConnectionTimeout(channel.id);

            // Screen reconnect: restore existing session if roomId provided
            if (data?.roomId) {
                const reconnectResult = roomManager.reconnectScreen(data.roomId, channel);
                if (reconnectResult.success) {
                    channel.userData = { role: 'screen', roomId: data.roomId };
                    const room = roomManager.getRoom(data.roomId);
                    if (room) {
                        const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                        channel.emit(EVENTS.ROOM_CREATED, {
                            roomId: data.roomId,
                            joinToken: room.joinToken,
                            leaderboard,
                            reconnected: true,
                        });
                        roomManager.broadcastLobbyUpdate(data.roomId);
                        console.log(`[Transport] Screen reconnected to room ${data.roomId}`);
                    }
                    return;
                }
            }

            const { roomId, joinToken } = roomManager.createRoom(channel);
            channel.userData = { role: 'screen', roomId };
            const leaderboard = PlayerManager.getPlayerLeaderboard(5);
            channel.emit(EVENTS.ROOM_CREATED, { roomId, joinToken, leaderboard });
        });

        // ---- JOIN_ROOM (controller) ----

        channel.on(EVENTS.JOIN_ROOM, (data: { roomId: string; token: string; clientId?: string }) => {
            clearConnectionTimeout(channel.id);
            const { roomId, token, clientId } = data;

            if (!clientId) {
                channel.emit(EVENTS.JOINED_ROOM, { roomId, success: false, error: 'Client ID required' });
                return;
            }

            // Try reconnect first (works for both lobby and gameplay disconnects)
            const existingRoom = roomManager.getRoom(roomId);
            if (existingRoom) {
                const reconnectResult = roomManager.reconnectController(roomId, clientId, channel);
                if (reconnectResult.success) {
                    channel.userData = { role: 'controller', roomId, clientId };
                    const rejoiningController = existingRoom.controllers.find(c => c.clientId === clientId);
                    channel.emit(EVENTS.RECONNECTED, {
                        success: true,
                        phase: reconnectResult.phase,
                        playerScores: reconnectResult.playerScores,
                        colorIndex: rejoiningController?.colorIndex ?? 0,
                        role: rejoiningController?.role ?? 'member',
                        ...reconnectResult.resyncState,
                    });
                    console.log(`[Transport] Controller ${clientId} reconnected to room ${roomId}, phase: ${reconnectResult.phase}`);

                    // Confirm leader role to the current leader (in case of demotion)
                    const currentLeader = existingRoom.controllers.find(
                        c => c.role === 'leader' && c.clientId !== clientId && !c.disconnected,
                    );
                    if (currentLeader?.channel) {
                        currentLeader.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                    }

                    roomManager.broadcastLobbyUpdate(roomId);
                    return;
                }
            }

            const result = roomManager.joinRoom(roomId, token, channel, clientId);

            if (!result.success) {
                channel.emit(EVENTS.JOINED_ROOM, { roomId, success: false, error: result.error });
                return;
            }

            channel.userData = { role: 'controller', roomId, clientId };
            channel.emit(EVENTS.JOINED_ROOM, {
                roomId,
                success: true,
                role: result.role,
                colorIndex: result.colorIndex,
                playerName: result.playerName,
            });

            const room = roomManager.getRoom(roomId);
            if (room) {
                if (!room.screenDisconnected) {
                    room.screenChannel.emit(EVENTS.CONTROLLER_JOINED, {
                        controllerId: clientId,
                        role: result.role,
                        colorIndex: result.colorIndex,
                    });
                }

                // Confirm leader role to existing leader when a new member joins
                if (result.role === 'member') {
                    const currentLeader = room.controllers.find(
                        c => c.role === 'leader' && c.clientId !== clientId && !c.disconnected,
                    );
                    if (currentLeader?.channel) {
                        currentLeader.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                    }
                }

                roomManager.broadcastLobbyUpdate(roomId);
            }
        });

        // ---- DISCONNECT ----

        channel.onDisconnect(() => {
            clearConnectionTimeout(channel.id);
            const { role, roomId, clientId } = channel.userData || {};

            // Clean up crosshair throttle
            if (clientId) {
                // The plugin owns the crosshairLastSent map; nothing to do here
            }

            if (role === 'screen') {
                const room = roomManager.markScreenDisconnected(channel.id, (expiredRoom) => {
                    const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                    for (const c of expiredRoom.controllers) {
                        if (c.channel) {
                            try {
                                c.channel.emit(EVENTS.GAME_OVER, {
                                    leaderboard,
                                    reason: 'screen_disconnected',
                                    questionsAnswered: expiredRoom.engine.getSessionQuestionsAnswered(),
                                    playerScores: roomManager.getPlayerScores(expiredRoom.roomId),
                                });
                            } catch { /* channel may be closed */ }
                        }
                    }
                    roomManager.deleteRoomById(expiredRoom.roomId);
                    console.log(`[Transport] Room ${expiredRoom.roomId} destroyed after screen grace period`);
                });

                if (room) {
                    if (room.gameStarted) {
                        const playerScores = roomManager.getPlayerScores(roomId);
                        PlayerManager.saveTopPlayer(roomId, playerScores);
                    }
                    for (const c of room.controllers) {
                        if (c.channel) {
                            try {
                                c.channel.emit(EVENTS.CONTROLLER_LEFT, {
                                    controllerId: 'screen',
                                    wasLeader: false,
                                    screenDisconnected: true,
                                });
                            } catch { /* ignore */ }
                        }
                    }
                }
            } else if (role === 'controller') {
                const { room, wasLeader, promotedControllerId } = roomManager.removeController(channel.id);
                if (room) {
                    if (!room.screenDisconnected) {
                        room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, {
                            controllerId: clientId || channel.id,
                            wasLeader,
                        });
                    }
                    roomManager.broadcastLobbyUpdate(room.roomId);

                    // If no active players remain, return to lobby
                    if (room.gameStarted && !roomManager.hasActivePlayers(room.roomId)) {
                        console.log(`[Transport] No active players after disconnect in ${room.roomId}, returning to lobby`);
                        roomManager.forceEndGame(room.roomId);

                        if (!room.screenDisconnected) {
                            room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
                        }
                        for (const c of room.controllers) {
                            if (c.channel) c.channel.emit(EVENTS.GAME_RESTARTED, {});
                        }
                        roomManager.broadcastLobbyUpdate(room.roomId);
                    }

                    if (promotedControllerId) {
                        const promotedController = room.controllers.find(c => c.clientId === promotedControllerId);
                        if (promotedController?.channel) {
                            promotedController.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                            console.log(`[Transport] Emitted ROLE_PROMOTED to ${promotedControllerId}`);
                        }
                    }

                    // Notify the quiz engine of the updated active player count
                    if (room.gameStarted && room.engine instanceof QuizEngine) {
                        const quizEngine = room.engine as QuizEngine;
                        if (quizEngine.isMultiplayer()) {
                            const activePlayers = room.controllers.filter(c => !c.isSpectating && !c.disconnected);
                            quizEngine.updateActivePlayerCount(activePlayers.length);
                        }
                    }
                }
            }
        });
    });
}

function clearConnectionTimeout(channelId: string): void {
    const timeout = connectionTimeouts.get(channelId);
    if (timeout) {
        clearTimeout(timeout);
        connectionTimeouts.delete(channelId);
    }
}
