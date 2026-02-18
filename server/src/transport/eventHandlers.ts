// ==========================================
// Event Handlers — Transport Layer
// Routes Geckos.io events to domain layer
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { ORB_POSITIONS } from '../shared/types.ts';
import { RoomManager } from '../domain/RoomManager.ts';
import { TeamManager } from '../domain/TeamManager.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function registerEventHandlers(io: GeckosServer, roomManager: RoomManager): void {
    io.onConnection((channel: ServerChannel) => {
        console.log(`[Geckos] New client connected: ${channel.id}`);

        // Handshake timeout
        const timeoutId = setTimeout(() => {
            if (connectionTimeouts.has(channel.id)) {
                console.log(`[WARNING] Client ${channel.id} handshake timeout`);
                connectionTimeouts.delete(channel.id);
            }
        }, 15000);
        connectionTimeouts.set(channel.id, timeoutId);

        // ---------- Room Lifecycle ----------

        channel.on(EVENTS.CREATE_ROOM, () => {
            clearConnectionTimeout(channel.id);
            const { roomId, joinToken } = roomManager.createRoom(channel);
            channel.userData = { role: 'screen', roomId };
            const leaderboard = TeamManager.getLeaderboard(10);
            channel.emit(EVENTS.ROOM_CREATED, { roomId, joinToken, leaderboard });
        });

        channel.on(EVENTS.JOIN_ROOM, (data: { roomId: string; token: string; clientId?: string }) => {
            clearConnectionTimeout(channel.id);
            const { roomId, token, clientId } = data;

            // clientId is now required for role persistence
            if (!clientId) {
                console.log(`[Room] Join failed: missing clientId for ${roomId}`);
                channel.emit(EVENTS.JOINED_ROOM, { roomId, success: false, error: 'Client ID required' });
                return;
            }

            const result = roomManager.joinRoom(roomId, token, channel, clientId);

            if (!result.success) {
                channel.emit(EVENTS.JOINED_ROOM, { roomId, success: false, error: result.error });
                return;
            }

            // Store clientId in userData so ALL future events can use it
            channel.userData = { role: 'controller', roomId, clientId };
            channel.emit(EVENTS.JOINED_ROOM, { roomId, success: true, role: result.role });

            // Notify screen
            const room = roomManager.getRoom(roomId);
            if (room) {
                room.screenChannel.emit(EVENTS.CONTROLLER_JOINED, { controllerId: clientId, role: result.role });
                broadcastLobbyUpdate(roomManager, roomId);
            }
        });

        // ---------- Team & Lobby ----------

        channel.on(EVENTS.SET_TEAM_NAME, (data: { name: string }) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const success = roomManager.setTeamName(roomId, clientId, data.name);
            if (success) {
                broadcastLobbyUpdate(roomManager, roomId);
            }
        });

        channel.on(EVENTS.PLAYER_READY, () => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            roomManager.setPlayerReady(roomId, clientId);
            broadcastLobbyUpdate(roomManager, roomId);
        });

        channel.on(EVENTS.START_GAME, async () => {
            const { roomId, clientId } = channel.userData || {};
            console.log(`[Game] START_GAME received from channel ${channel.id}, roomId: ${roomId}, clientId: ${clientId?.substring(0, 8)}...`);
            if (!roomId || !clientId) {
                console.log(`[Game] Start failed: missing roomId/clientId in userData`);
                return;
            }

            const started = roomManager.startGame(roomId, clientId);
            if (!started) {
                console.log(`[Game] Start failed: RoomManager.startGame returned false for ${roomId}`);
                return;
            }

            console.log(`[Game] Room ${roomId} game started flag set!`);
            const room = roomManager.getRoom(roomId);
            if (!room) {
                console.log(`[Game] Room ${roomId} not found after startGame`);
                return;
            }

            // Initialize quiz engine with questions (Gemini or JSON fallback)
            // This is async to allow Gemini API calls if needed
            console.log(`[Game] Initializing quiz engine for room ${roomId}...`);
            try {
                await room.quizEngine.initialize();
                console.log(`[Game] Quiz engine initialized with ${room.quizEngine.getTotalQuestions()} questions for room ${roomId}`);
                
                // Log the first question for debugging
                const firstQ = room.quizEngine.getCurrentQuestion();
                console.log(`[Game] First question text: ${firstQ?.text?.substring(0, 50)}...`);
            } catch (error) {
                console.error(`[Game] Failed to initialize quiz engine:`, error);
                // Continue anyway - fallback questions should still work
            }

            // Set up quiz engine callbacks
            room.quizEngine.setCallbacks(
                // Timer tick
                (timeLeft: number) => {
                    room.screenChannel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                    for (const c of room.controllers) {
                        c.channel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                    }
                },
                // Game over
                () => {
                    const finalScore = room.teamManager.getLiveScore();
                    const questionsAnswered = room.quizEngine.getQuestionsAnswered();
                    room.teamManager.saveGameResult(roomId, questionsAnswered);

                    const leaderboard = TeamManager.getLeaderboard(10);
                    const gameOverPayload = {
                        finalScore,
                        teamName: room.teamManager.getTeamName(),
                        leaderboard,
                    };

                    room.screenChannel.emit(EVENTS.GAME_OVER, gameOverPayload);
                    for (const c of room.controllers) {
                        c.channel.emit(EVENTS.GAME_OVER, gameOverPayload);
                    }
                }
            );

            // Set player count for timer logic (1 player = 30s, 2-3 players = 15s)
            const playerCount = room.controllers.length;
            room.quizEngine.setPlayerCount(playerCount);
            console.log(`[Game] Starting with ${playerCount} player(s), timer set to ${playerCount === 1 ? '30s' : '15s'}`);

            // Start timer and send first question
            room.quizEngine.startTimer();
            const question = room.quizEngine.getCurrentQuestion();

            console.log(`[Game] Sending GAME_STARTED with question: ${question?.text?.substring(0, 30)}...`);
            const gameStartPayload = { question, timeLeft: room.quizEngine.getTimeLeft() };
            room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
            for (const c of room.controllers) {
                c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
            }
        });

        // ---------- Game Input ----------

        channel.on(EVENTS.SHOOT, (data: { targetXPercent: number; targetYPercent: number; power: number }) => {
            const { roomId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room || !room.gameStarted) return;

            // Determine which orb was hit based on coordinates
            const hitOrb = detectOrbHit(data.targetXPercent, data.targetYPercent);

            // Send projectile to screen for visual
            room.screenChannel.emit(EVENTS.PROJECTILE, {
                controllerId: channel.id,
                targetXPercent: data.targetXPercent,
                targetYPercent: data.targetYPercent,
            });

            if (hitOrb) {
                // Validate answer server-side
                const result = room.quizEngine.validateAnswer(hitOrb);

                if (result.correct) {
                    room.teamManager.addScore(result.points);
                }

                const hitPayload = {
                    controllerId: channel.id,
                    correct: result.correct,
                    points: result.points,
                    orbId: hitOrb,
                };

                // Send result to screen and controller
                room.screenChannel.emit(EVENTS.HIT_RESULT, hitPayload);
                channel.emit(EVENTS.HIT_RESULT, hitPayload);

                // Send score update
                const scorePayload = {
                    teamScore: room.teamManager.getLiveScore(),
                    teamName: room.teamManager.getTeamName(),
                };
                room.screenChannel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                for (const c of room.controllers) {
                    c.channel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                }

                // If correct, advance to next question and reset timer
                if (result.correct) {
                    // Reset timer for next question
                    room.quizEngine.resetTimer();
                    
                    setTimeout(async () => {
                        const nextQ = await room.quizEngine.nextQuestion();
                        if (nextQ) {
                            room.screenChannel.emit(EVENTS.QUESTION, nextQ);
                            for (const c of room.controllers) {
                                c.channel.emit(EVENTS.QUESTION, nextQ);
                            }
                        }
                    }, 1500); // Match the existing transition delay
                }
            }
        });

        // ---------- Visual relay (high frequency, unreliable) ----------
        // Use clientId (persistent) instead of channel.id (volatile) for controllerId

        channel.on(EVENTS.CROSSHAIR, (data: { x: number; y: number }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (room?.screenChannel && clientId) {
                room.screenChannel.emit(EVENTS.CROSSHAIR, { controllerId: clientId, ...data }, { reliable: false });
            }
        });

        channel.on(EVENTS.START_AIMING, (data: { gyroEnabled: boolean }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (room?.screenChannel && clientId) {
                room.screenChannel.emit(EVENTS.START_AIMING, { controllerId: clientId, ...data });
            }
        });

        channel.on(EVENTS.CANCEL_AIMING, () => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (room?.screenChannel && clientId) {
                room.screenChannel.emit(EVENTS.CANCEL_AIMING, { controllerId: clientId });
            }
        });

        channel.on(EVENTS.TARGETING, (data: { orbId: string | null }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (room?.screenChannel && clientId) {
                room.screenChannel.emit(EVENTS.TARGETING, { controllerId: clientId, ...data });
            }
        });

        // ---------- Restart ----------

        channel.on(EVENTS.RESTART_GAME, () => {
            const { roomId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room) return;

            // Only leader can restart — use clientId
            const { clientId: restartClientId } = channel.userData || {};
            const controller = room.controllers.find((c) => c.clientId === restartClientId);
            if (!controller || controller.role !== 'leader') return;

            room.quizEngine.reset();
            room.teamManager.resetScore();
            room.gameStarted = false;

            // Reset ready states for members
            for (const c of room.controllers) {
                if (c.role === 'member') {
                    c.isReady = false;
                }
            }

            room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
            for (const c of room.controllers) {
                c.channel.emit(EVENTS.GAME_RESTARTED, {});
            }

            broadcastLobbyUpdate(roomManager, roomId);
        });

        // ---------- Disconnect ----------

        channel.onDisconnect(() => {
            clearConnectionTimeout(channel.id);
            const { role, roomId } = channel.userData || {};
            console.log(`[Geckos] Client disconnected: ${channel.id} (role: ${role}, roomId: ${roomId})`);

            if (role === 'screen') {
                const room = roomManager.deleteRoomByScreen(channel.id);
                if (room) {
                    console.log(`[Room] Screen for ${room.roomId} disconnected, room deleted`);
                    
                    // Save the score before deleting the room (if game was in progress)
                    if (room.gameStarted) {
                        const finalScore = room.teamManager.getLiveScore();
                        const questionsAnswered = room.quizEngine.getQuestionsAnswered();
                        room.teamManager.saveGameResult(roomId, questionsAnswered);
                        console.log(`[Room] Saved score ${finalScore} for team "${room.teamManager.getTeamName()}" on disconnect`);
                    }
                    
                    // Get updated leaderboard after saving
                    const leaderboard = TeamManager.getLeaderboard(10);
                    
                    // Notify all controllers that the room is gone
                    for (const c of room.controllers) {
                        c.channel.emit(EVENTS.GAME_OVER, {
                            finalScore: room.teamManager.getLiveScore(),
                            teamName: room.teamManager.getTeamName(),
                            leaderboard,
                        });
                    }
                }
            } else if (role === 'controller') {
                const { room, wasLeader } = roomManager.removeController(channel.id);
                if (room) {
                    console.log(`[Room] Controller ${channel.id} (wasLeader: ${wasLeader}) removed from ${room.roomId}`);
                    room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: channel.id });
                    broadcastLobbyUpdate(roomManager, room.roomId);
                } else {
                    console.log(`[Room] Disconnected controller ${channel.id} was not tracked in any room`);
                }
            }
        });
    });
}

/** Broadcast lobby state to all participants in a room */
function broadcastLobbyUpdate(roomManager: RoomManager, roomId: string): void {
    const lobby = roomManager.getLobbyState(roomId);
    const room = roomManager.getRoom(roomId);
    if (!lobby || !room) return;

    console.log(`[Lobby] Broadcasting update for ${roomId}:`, {
        room: roomId,
        players: lobby.team.members.length,
        canStart: lobby.canStart
    });

    room.screenChannel.emit(EVENTS.LOBBY_UPDATE, lobby);
    for (const c of room.controllers) {
        c.channel.emit(EVENTS.LOBBY_UPDATE, lobby);
    }
}

/** Detect which orb was hit based on percentage coordinates */
function detectOrbHit(xPercent: number, yPercent: number): string | null {
    const HIT_RADIUS = 8; // percentage-based hit radius

    for (const orb of ORB_POSITIONS) {
        const dist = Math.sqrt(Math.pow(xPercent - orb.x, 2) + Math.pow(yPercent - orb.y, 2));
        if (dist < HIT_RADIUS) {
            return orb.id;
        }
    }
    return null;
}

function clearConnectionTimeout(channelId: string): void {
    const timeout = connectionTimeouts.get(channelId);
    if (timeout) {
        clearTimeout(timeout);
        connectionTimeouts.delete(channelId);
    }
}
