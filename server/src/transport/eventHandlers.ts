// ==========================================
// Event Handlers — Transport Layer (Core)
// Handles room lifecycle events only.
// Game-specific logic lives in plugin handlers.
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { QUIZ_TOPICS } from '../shared/types.ts';
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
            // Only send ROOM_EXPIRED if the screen channel is still associated
            // with this specific room. After a reconnect, the same channel may
            // now belong to a different room.
            const channelRoomId = deletedRoom.screenChannel.userData?.roomId;
            if (channelRoomId && channelRoomId !== deletedRoom.roomId) {
                console.log(`[Transport] Skipping ROOM_EXPIRED for room ${deletedRoom.roomId} — screen channel now belongs to room ${channelRoomId}`);
                return;
            }
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

            // Guard: if this channel is already the screen for an existing room,
            // ignore the request. Prevents stale ROOM_EXPIRED or duplicate
            // _reJoin() calls from orphaning the current room.
            if (channel.userData?.role === 'screen' && channel.userData?.roomId) {
                const existingRoom = roomManager.getRoom(channel.userData.roomId);
                if (existingRoom) {
                    console.log(`[Transport] Ignoring duplicate CREATE_ROOM from channel ${channel.id} — already screen for room ${channel.userData.roomId}`);
                    const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                    channel.emit(EVENTS.ROOM_CREATED, {
                        roomId: existingRoom.roomId,
                        joinToken: existingRoom.joinToken,
                        leaderboard,
                        reconnected: true,
                    });
                    return;
                }
            }

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

                    // Clear this player's stale selection from the quiz engine so
                    // they can shoot again during this round. Must happen BEFORE
                    // restoring the active player count to avoid a premature early
                    // advance triggered by the stale entry.
                    if (existingRoom.gameStarted) {
                        const quizEngine = existingRoom.engine as QuizEngine;
                        if (quizEngine) {
                            quizEngine.removeSelection(clientId);
                        }
                    }

                    // Restore the active player count now that a player reconnected.
                    // When a controller disconnects, removeController() calls
                    // updateActivePlayerCount(), potentially dropping out of multiplayer
                    // mode. We must bump it back so the game expects all players to answer.
                    if (existingRoom.gameStarted && existingRoom.engine) {
                        const quizEngine = existingRoom.engine as QuizEngine;
                        if (quizEngine.isMultiplayer !== undefined) {
                            const activePlayers = existingRoom.controllers.filter(
                                c => !c.isSpectating && !c.disconnected,
                            );
                            quizEngine.updateActivePlayerCount(activePlayers.length);
                        }
                    }

                    // Resend current game state for reconnecting controllers
                    if (existingRoom.gameStarted && existingRoom.engine) {
                        const quizEngine = existingRoom.engine as QuizEngine | null;
                        if (quizEngine) {
                            // Resend current question
                            const resyncState = existingRoom.engine.getResyncState?.();
                            if (resyncState?.currentQuestion) {
                                channel.emit(EVENTS.QUESTION, resyncState.currentQuestion);
                            }

                            // Resend phase change if in multiplayer mode
                            if (quizEngine.isMultiplayer() && resyncState) {
                                channel.emit(EVENTS.PHASE_CHANGE, {
                                    phase: resyncState.currentPhase,
                                    timeLeft: resyncState.phaseTimeLeft,
                                    questionNumber: resyncState.questionNumber,
                                });
                                // Resend selections that have already been made this round
                                if (Array.isArray(resyncState.playerSelections) && resyncState.playerSelections.length > 0) {
                                    for (const sel of resyncState.playerSelections) {
                                        channel.emit(EVENTS.PLAYER_SELECTION, sel);
                                    }
                                }
                            }
                        }

                        // Resend topic selection state if in progress
                        const topicState = shootQuizPlugin.getState(roomId);
                        if (topicState?.topicSelectionStarted) {
                            const topicUpdate = shootQuizPlugin.getTopicVoteUpdate(roomId);
                            if (topicUpdate) {
                                const topicOrbs = QUIZ_TOPICS.map((t, i) => ({
                                    id: t.id, label: t.label, emoji: t.emoji, x: 10 + i * 20, y: 50,
                                }));
                                channel.emit(EVENTS.TOPIC_VOTE_UPDATE, { ...topicUpdate, topics: topicOrbs });
                            }
                        }
                    }

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
                // Special case: if the room exists but game is in progress and the
                // player failed to reconnect (grace period expired), include extra
                // context so the client can offer spectate instead of dead-ending.
                if (result.error === 'Game already in progress') {
                    const room = roomManager.getRoom(roomId);
                    if (room) {
                        channel.emit(EVENTS.JOINED_ROOM, {
                            roomId,
                            success: false,
                            error: 'Game already in progress',
                            gameInProgress: true,
                        });
                        return;
                    }
                }
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

                    // If no active players remain, return to lobby or destroy room
                    if (room.gameStarted && !roomManager.hasActivePlayers(room.roomId)) {
                        // If game-over was already broadcast (winner screen), destroy
                        // the room immediately instead of returning to lobby.
                        if (room.gameOverBroadcasted) {
                            console.log(`[Transport] No active players on winner screen in ${room.roomId} — destroying room`);
                            try { room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' }); } catch { /* ignore */ }
                            roomManager.deleteRoomById(room.roomId);
                            return;
                        }
                        console.log(`[Transport] No active players after disconnect in ${room.roomId}, returning to lobby`);
                        roomManager.forceEndGame(room.roomId);

                        // After forceEndGame, if nobody is still connected, destroy the
                        // room so the screen refreshes to a fresh landing page.
                        const anyoneConnected = room.controllers.some(c => c.channel);
                        if (!anyoneConnected) {
                            console.log(`[Transport] No connected controllers after force-end in ${room.roomId} — destroying room`);
                            try { room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' }); } catch { /* ignore */ }
                            roomManager.deleteRoomById(room.roomId);
                            return;
                        }

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
