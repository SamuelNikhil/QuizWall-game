// ==========================================
// Event Handlers — Transport Layer
// Routes Geckos.io events to domain layer
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { ORB_POSITIONS, QUIZ_TOPICS, TOPIC_SELECTION_TIMEOUT_MS } from '../shared/types.ts';
import type { PlayerSelectionPayload, RevealResultPayload, TutorialProgressPayload, TutorialPlayerStatus, TutorialStatusUpdatePayload, QuizTopicId, QuizDifficulty } from '../shared/types.ts';
import { RoomManager, type Room } from '../domain/RoomManager.ts';
import { PlayerManager } from '../domain/PlayerManager.ts';
import { QuizEngine } from '../domain/QuizEngine.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

/**
 * Safely cast a room's engine to QuizEngine.
 * Returns null if the room is running a different game type.
 * All quiz-specific event handlers use this instead of accessing room.engine directly.
 */
function asQuizEngine(room: Room): QuizEngine | null {
    return room.engine instanceof QuizEngine ? room.engine : null;
}

const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const crosshairLastSent = new Map<string, number>(); // Throttle crosshair relay per controller
const CROSSHAIR_THROTTLE_MS = 33; // ~30fps max relay rate
// Periodically clean up old crosshair timestamps to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [clientId, timestamp] of crosshairLastSent.entries()) {
        if (now - timestamp > 300000) { // 5 minutes
            crosshairLastSent.delete(clientId);
        }
    }
    // Hard cap — evict oldest if map grows beyond expected max (25 rooms × 4 players)
    while (crosshairLastSent.size > 100) {
        const oldest = crosshairLastSent.keys().next().value;
        if (oldest) crosshairLastSent.delete(oldest);
    }
}, 60000); // Run cleanup every minute

// Per-room tutorial state tracking (kept for loading state compatibility)
interface RoomTutorialState {
    players: Map<string, TutorialPlayerStatus>;
    timeoutId: ReturnType<typeof setTimeout> | null;
    resolveComplete: (() => void) | null;
}
const roomTutorialStates = new Map<string, RoomTutorialState>();

async function finalizeTopicSelection(roomId: string, topicId: QuizTopicId, roomManager: RoomManager, difficulty: QuizDifficulty = 'medium'): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const topicLabel = QUIZ_TOPICS.find(t => t.id === topicId)?.label || topicId;
    console.log(`[Game] Topic selected in ${roomId}: ${topicId} (${topicLabel}), difficulty: ${difficulty}`);

    const topicSelectedPayload = { topicId, topicLabel, difficulty };
    room.screenChannel.emit(EVENTS.TOPIC_SELECTED, topicSelectedPayload);
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.TOPIC_SELECTED, topicSelectedPayload);
    }

    await startGameAfterTopicSelection(roomId, topicId, roomManager, difficulty);
}

async function startGameAfterTopicSelection(roomId: string, topicId: QuizTopicId, roomManager: RoomManager, difficulty: QuizDifficulty = 'medium'): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const quizEngine = asQuizEngine(room);
    if (!quizEngine) {
        console.error(`[Game] Room ${roomId} is not running a quiz game — cannot start quiz`);
        return;
    }

    const playerCount = room.controllers.length;

    room.screenChannel.emit(EVENTS.LOADING_START, { playerCount });
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.LOADING_START, { playerCount });
    }

    try {
        // Ensure initialized flag is cleared before loading questions for this round
        quizEngine.reset(true);
        await quizEngine.initialize(topicId, difficulty);
        console.log(`[Game] Quiz engine initialized with ${quizEngine.getTotalQuestions()} questions for room ${roomId} (topic: ${topicId})`);
    } catch (error) {
        console.error(`[Game] Failed to initialize quiz engine:`, error);
    }

    room.screenChannel.emit(EVENTS.LOADING_COUNTDOWN, { duration: 3 });
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.LOADING_COUNTDOWN, { duration: 3 });
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    const modeChanged = quizEngine.setPlayerCount(playerCount);
    if (modeChanged) {
        console.log(`[EventHandlers] Game mode changed — resetting player scores`);
        roomManager.resetPlayerScores(roomId);
    }

    const question = quizEngine.getCurrentQuestion();

    if (playerCount >= 2) {
        quizEngine.setPhaseCallbacks(
            (phase, timeLeft, questionNumber) => {
                const phasePayload = { phase, timeLeft, questionNumber };
                room.screenChannel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                }
                if (phase === 'analysis' && timeLeft === 1 && questionNumber > 1) {
                    const nextQ = quizEngine.getLastSelectedQuestion();
                    if (nextQ) {
                        room.screenChannel.emit(EVENTS.QUESTION, nextQ);
                        for (const c of room.controllers) {
                            if (c.channel) c.channel.emit(EVENTS.QUESTION, nextQ);
                        }
                    }
                }
            },
            (result: RevealResultPayload) => {
                if (result.playerScores) {
                    for (const ps of result.playerScores) {
                        if (ps.correct && ps.score > 0) {
                            roomManager.addPlayerScore(roomId, ps.controllerId, ps.score);
                        }
                    }
                }
                room.screenChannel.emit(EVENTS.REVEAL_RESULT, result);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.REVEAL_RESULT, result);
                }
                const scorePayload = { playerScores: roomManager.getPlayerScores(roomId) };
                room.screenChannel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                }
            },
            () => {
                const questionsAnswered = quizEngine.getSessionQuestionsAnswered();
                const playerScores = roomManager.getPlayerScores(roomId);
                PlayerManager.saveTopPlayer(roomId, playerScores);
                const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                const reason = quizEngine.getLastGameOverReason();
                const gameOverPayload = { leaderboard, reason, questionsAnswered, playerScores };
                room.screenChannel.emit(EVENTS.GAME_OVER, gameOverPayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.GAME_OVER, gameOverPayload);
                }
                roomManager.clearDisconnectedScores(roomId);
            }
        );

        const gameStartPayload = { question, timeLeft: 20 };
        room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        for (const c of room.controllers) {
            if (c.channel) c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        }
        quizEngine.startPhaseTimer();
    } else {
        quizEngine.setCallbacks(
            (timeLeft: number) => {
                room.screenChannel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                }
            },
            () => {
                const questionsAnswered = quizEngine.getSessionQuestionsAnswered();
                const playerScores = roomManager.getPlayerScores(roomId);
                PlayerManager.saveTopPlayer(roomId, playerScores);
                const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                const gameOverPayload = {
                    leaderboard,
                    reason: quizEngine.getLastGameOverReason(),
                    questionsAnswered,
                    playerScores,
                };
                room.screenChannel.emit(EVENTS.GAME_OVER, gameOverPayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.GAME_OVER, gameOverPayload);
                }
                roomManager.clearDisconnectedScores(roomId);
            }
        );

        quizEngine.startTimer();
        const gameStartPayload = { question, timeLeft: quizEngine.getTimeLeft() };
        room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        for (const c of room.controllers) {
            if (c.channel) c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        }
    }
}

export function registerEventHandlers(io: GeckosServer, roomManager: RoomManager): void {

    // When an empty lobby is deleted, notify the screen so it resets to a fresh room
    roomManager.setOnEmptyLobbyDeleted((deletedRoom) => {
        if (!deletedRoom.screenDisconnected && deletedRoom.screenChannel) {
            try {
                deletedRoom.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' });
                console.log(`[Transport] Notified screen of empty lobby deletion for room ${deletedRoom.roomId}`);
            } catch { /* screen channel may already be closed */ }
        }
    });

    // Clean up transport-layer per-room state whenever any room is deleted
    roomManager.setOnRoomDeleted((roomId) => {
        roomTutorialStates.delete(roomId);
    });

    io.onConnection((channel: ServerChannel) => {

        // Handshake timeout — close idle channels that never send CREATE_ROOM or JOIN_ROOM
        const timeoutId = setTimeout(() => {
            if (connectionTimeouts.has(channel.id)) {
                connectionTimeouts.delete(channel.id);
                console.warn(`[Transport] Handshake timeout for channel ${channel.id} — closing`);
                try { channel.close(); } catch { /* already closed */ }
            }
        }, 15000);
        connectionTimeouts.set(channel.id, timeoutId);

        // ---------- Room Lifecycle ----------

        channel.on(EVENTS.CREATE_ROOM, (data?: { roomId?: string }) => {
            clearConnectionTimeout(channel.id);

            // Screen reconnect: if a roomId is provided and the room has a disconnected screen,
            // restore the session instead of creating a new room.
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
                        broadcastLobbyUpdate(roomManager, data.roomId);
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

        channel.on(EVENTS.JOIN_ROOM, (data: { roomId: string; token: string; clientId?: string }) => {
            clearConnectionTimeout(channel.id);
            const { roomId, token, clientId } = data;

            if (!clientId) {
                channel.emit(EVENTS.JOINED_ROOM, { roomId, success: false, error: 'Client ID required' });
                return;
            }

            // Try reconnect for both gameplay AND lobby disconnects
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
                        // Game-specific resync state (e.g. currentQuestion, phaseTimeLeft for quiz)
                        ...reconnectResult.resyncState,
                    });
                    console.log(`[Transport] Controller ${clientId} reconnected to room ${roomId}, phase: ${reconnectResult.phase}, role: ${rejoiningController?.role}`);

                    // Notify the current leader so their controller UI stays in sync.
                    // This matters when the rejoining player was the old leader and got
                    // demoted — the promoted leader must know they're still leader.
                    const currentLeader = existingRoom.controllers.find(c => c.role === 'leader' && c.clientId !== clientId && !c.disconnected);
                    if (currentLeader?.channel) {
                        currentLeader.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                        console.log(`[Transport] Confirmed ROLE_PROMOTED(leader) to ${currentLeader.clientId.substring(0, 8)} after ${clientId.substring(0, 8)} rejoined`);
                    }

                    broadcastLobbyUpdate(roomManager, roomId);
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
                    room.screenChannel.emit(EVENTS.CONTROLLER_JOINED, { controllerId: clientId, role: result.role, colorIndex: result.colorIndex });
                }

                // If the joining player came in as member, confirm the current leader's role
                // so their controller UI stays in sync (handles the case where the old leader
                // rejoins after their grace period expired and gets a fresh member slot).
                if (result.role === 'member') {
                    const currentLeader = room.controllers.find(c => c.role === 'leader' && c.clientId !== clientId && !c.disconnected);
                    if (currentLeader?.channel) {
                        currentLeader.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                        console.log(`[Transport] Confirmed ROLE_PROMOTED(leader) to ${currentLeader.clientId.substring(0, 8)} after new member joined`);
                    }
                }

                broadcastLobbyUpdate(roomManager, roomId);
            }
        });

        // ---------- Lobby ----------

        channel.on(EVENTS.START_GAME, async () => {
            const { roomId, clientId } = channel.userData || {};

            if (!roomId || !clientId) {
                console.warn('[Game] START_GAME: Missing roomId or clientId. roomId:', roomId, 'clientId:', clientId);
                return;
            }

            console.log(`[Game] START_GAME received from clientId=${clientId} in room ${roomId}`);

            const started = roomManager.startGame(roomId, clientId);
            if (!started) {
                console.warn(`[Game] startGame() returned false for room ${roomId}, clientId ${clientId}`);
                return;
            }

            const room = roomManager.getRoom(roomId);
            if (!room) {
                console.error(`[Game] Room ${roomId} not found after startGame()`);
                return;
            }

            // --- Topic Selection Phase ---
            const topicUpdate = roomManager.startTopicSelection(roomId);
            if (topicUpdate) {
                const topicOrbs = QUIZ_TOPICS.map((t, i) => ({
                    id: t.id,
                    label: t.label,
                    emoji: t.emoji,
                    x: 10 + (i * 20),
                    y: 50,
                }));

                room.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                    votes: topicUpdate.votes,
                    votedControllerIds: topicUpdate.votedControllerIds,
                    totalVoters: topicUpdate.totalVoters,
                    timeLeft: topicUpdate.timeLeft,
                    topics: topicOrbs,
                    difficulty: topicUpdate.difficulty,
                });
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                        votes: topicUpdate.votes,
                        votedControllerIds: topicUpdate.votedControllerIds,
                        totalVoters: topicUpdate.totalVoters,
                        timeLeft: topicUpdate.timeLeft,
                        topics: topicOrbs,
                        difficulty: topicUpdate.difficulty,
                    });
                }

                // Broadcast countdown every second — store reference so it can be cleared on room deletion
                room.topicCountdownInterval = setInterval(() => {
                    const currentRoom = roomManager.getRoom(roomId);
                    const currentUpdate = currentRoom ? roomManager.getTopicVoteUpdate(roomId) : null;
                    if (!currentUpdate || currentUpdate.timeLeft <= 0) {
                        if (currentRoom?.topicCountdownInterval) {
                            clearInterval(currentRoom.topicCountdownInterval);
                            currentRoom.topicCountdownInterval = undefined;
                        }
                        return;
                    }
                    if (!currentRoom?.screenDisconnected) {
                        currentRoom?.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                            votes: currentUpdate.votes,
                            votedControllerIds: currentUpdate.votedControllerIds,
                            totalVoters: currentUpdate.totalVoters,
                            timeLeft: currentUpdate.timeLeft,
                            topics: topicOrbs,
                            difficulty: currentUpdate.difficulty,
                        });
                    }
                }, 1000);

                // Override the timeout to call startGameAfterTopicSelection
                if (room.topicSelectionTimer) {
                    clearTimeout(room.topicSelectionTimer);
                }
                room.topicSelectionTimer = setTimeout(() => {
                    const result = roomManager.resolveTopicVote(roomId);
                    finalizeTopicSelection(roomId, result.topicId, roomManager, result.difficulty);
                }, TOPIC_SELECTION_TIMEOUT_MS);
            }
        });

        channel.on(EVENTS.TOPIC_VOTE, (data: { topicId: QuizTopicId }) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const result = roomManager.castTopicVote(roomId, clientId, data.topicId);

            if (result.update) {
                const room = roomManager.getRoom(roomId);
                if (room) {
                    room.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, result.update);
                    for (const c of room.controllers) {
                        if (c.channel) c.channel.emit(EVENTS.TOPIC_VOTE_UPDATE, result.update);
                    }
                }
            }

            if (result.resolved) {
                finalizeTopicSelection(roomId, result.resolved.topicId, roomManager, result.resolved.difficulty);
            }
        });

        channel.on(EVENTS.SET_DIFFICULTY, (data: { difficulty: QuizDifficulty }) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const accepted = roomManager.setDifficulty(roomId, clientId, data.difficulty);
            if (!accepted) return; // Not the leader — ignore

            // Broadcast updated vote state (which now includes the new difficulty)
            const update = roomManager.getTopicVoteUpdate(roomId);
            if (update) {
                const room = roomManager.getRoom(roomId);
                if (room) {
                    room.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, update);
                    for (const c of room.controllers) {
                        if (c.channel) c.channel.emit(EVENTS.TOPIC_VOTE_UPDATE, update);
                    }
                }
            }
        });

        // ---------- Game Input ----------
        channel.on(EVENTS.SHOOT, (data: { targetXPercent: number; targetYPercent: number; power: number }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room || !room.gameStarted) return;
            
            // Check if player is spectating
            const controller = room.controllers.find(c => c.clientId === clientId);
            if (controller?.isSpectating) return;
            
            // Validate coordinates
            if (!isFinite(data.targetXPercent) || !isFinite(data.targetYPercent) || 
                data.targetXPercent < 0 || data.targetXPercent > 100 || 
                data.targetYPercent < 0 || data.targetYPercent > 100) {
                console.warn(`[Game] Invalid SHOOT coordinates from ${clientId?.substring(0, 8)}:`, data);
                return;
            }

            // Determine which orb was hit based on coordinates
            const hitOrb = detectOrbHit(data.targetXPercent, data.targetYPercent);
            room.lastActivity = Date.now();
            console.log(`[Game] SHOOT from ${clientId?.substring(0, 8)}... hitOrb: ${hitOrb}, coords: (${data.targetXPercent.toFixed(1)}, ${data.targetYPercent.toFixed(1)})`);

            const quizEngine = asQuizEngine(room);
            if (!quizEngine) return; // Not a quiz room

            if (quizEngine.isMultiplayer()) {
                // ==========================================
                // MULTIPLAYER — Phase-based selection
                // ==========================================

                const currentPhase = quizEngine.getCurrentPhase();
                console.log(`[Game] Multiplayer shoot, currentPhase: ${currentPhase}`);

                if (currentPhase !== 'selection') {
                    console.log(`[Game] Ignoring shot - not in selection phase (current: ${currentPhase})`);
                    return;
                }

                if (!hitOrb) {
                    console.log(`[Game] Shot missed all orbs`);
                    return;
                }

                const controller = room.controllers.find(c => c.clientId === clientId);
                if (!controller) {
                    console.log(`[Game] Controller not found for clientId: ${clientId}`);
                    return;
                }

                const accepted = quizEngine.recordSelection(clientId!, hitOrb, controller.colorIndex);
                console.log(`[Game] Selection accepted: ${accepted} for ${clientId?.substring(0, 8)}... orb: ${hitOrb}`);
                if (!accepted) return;

                // Keep the engine's active player count in sync with non-spectating, connected players
                const activePlayers = room.controllers.filter(c => !c.isSpectating && !c.disconnected);
                quizEngine.updateActivePlayerCount(activePlayers.length);

                room.screenChannel.emit(EVENTS.PROJECTILE, {
                    controllerId: clientId,
                    targetXPercent: data.targetXPercent,
                    targetYPercent: data.targetYPercent,
                });

                const selectionPayload: PlayerSelectionPayload = {
                    controllerId: clientId!,
                    orbId: hitOrb,
                    colorIndex: controller.colorIndex,
                };
                room.screenChannel.emit(EVENTS.PLAYER_SELECTION, selectionPayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.PLAYER_SELECTION, selectionPayload);
                }

            } else {
                // ==========================================
                // SINGLEPLAYER — Classic immediate validation
                // ==========================================

                room.screenChannel.emit(EVENTS.PROJECTILE, {
                    controllerId: channel.id,
                    targetXPercent: data.targetXPercent,
                    targetYPercent: data.targetYPercent,
                });

                if (hitOrb) {
                    const result = quizEngine.validateAnswer(hitOrb);

                    if (result.correct) {
                        if (clientId) {
                            roomManager.addPlayerScore(roomId, clientId, result.points);
                        }
                    }

                    const hitPayload = {
                        controllerId: channel.id,
                        correct: result.correct,
                        points: result.points,
                        baseScore: result.baseScore,
                        bonus: result.bonus,
                        orbId: hitOrb,
                    };

                    room.screenChannel.emit(EVENTS.HIT_RESULT, hitPayload);
                    channel.emit(EVENTS.HIT_RESULT, hitPayload);

                    const scorePayload = { playerScores: roomManager.getPlayerScores(roomId) };
                    room.screenChannel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                    for (const c of room.controllers) {
                        if (c.channel) c.channel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                    }

                    quizEngine.resetTimer();

                    setTimeout(async () => {
                        const nextQ = await quizEngine.nextQuestion();
                        if (nextQ) {
                            room.screenChannel.emit(EVENTS.QUESTION, nextQ);
                            for (const c of room.controllers) {
                                if (c.channel) c.channel.emit(EVENTS.QUESTION, nextQ);
                            }
                        }
                    }, 800);
                }
            }
        });

        channel.on(EVENTS.LEAVE_GAME, () => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const room = roomManager.getRoom(roomId);
            if (!room) return;

            // Set spectating status
            roomManager.leaveGame(roomId, clientId);

            // Notify screen to remove crosshair
            room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: clientId });

            // If no active players left, return everyone to lobby
            if (!roomManager.hasActivePlayers(roomId)) {
                console.log(`[Room] No active players left in ${roomId}, returning to lobby`);
                roomManager.forceEndGame(roomId);

                // Broadcast game restarted to return all controllers to lobby view
                room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.GAME_RESTARTED, {});
                }
            } else {
                // Update the engine's active player count so the early-reveal check
                // stays accurate if a player leaves during the selection phase.
                const quizEngine = asQuizEngine(room);
                if (quizEngine?.isMultiplayer()) {
                    const activePlayers = room.controllers.filter(c => !c.isSpectating && !c.disconnected);
                    quizEngine.updateActivePlayerCount(activePlayers.length);
                }
            }

            // Broadcast updated lobby state
            broadcastLobbyUpdate(roomManager, roomId);
        });

        // ---------- Visual relay (high frequency, unreliable) ----------
        // Use clientId (persistent) instead of channel.id (volatile) for controllerId

        channel.on(EVENTS.CROSSHAIR, (data: { x: number; y: number }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room?.screenChannel || !clientId) return;

            if (roomManager.isTopicSelectionStarted(roomId)) {
                // Allow crosshair during topic selection
            } else {
                const qe = asQuizEngine(room);
                if (qe?.isMultiplayer() && qe.getCurrentPhase() !== 'selection') return;
            }

            room.lastActivity = Date.now();

            const now = Date.now();
            const lastSent = crosshairLastSent.get(clientId) || 0;
            if (now - lastSent < CROSSHAIR_THROTTLE_MS) return;
            crosshairLastSent.set(clientId, now);

            room.screenChannel.emit(EVENTS.CROSSHAIR, { controllerId: clientId, ...data }, { reliable: false });
        });

        channel.on(EVENTS.START_AIMING, () => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room?.screenChannel || !clientId) return;

            if (roomManager.isTopicSelectionStarted(roomId)) {
                // Allow aiming during topic selection
            } else {
                const qe = asQuizEngine(room);
                if (qe?.isMultiplayer() && qe.getCurrentPhase() !== 'selection') return;
            }

            room.screenChannel.emit(EVENTS.START_AIMING, { controllerId: clientId, gyroEnabled: false });
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

        // ---------- Tutorial Progress ----------
// Kept for loading state compatibility (gyro functionality removed)

        channel.on(EVENTS.TUTORIAL_PROGRESS, (data: TutorialProgressPayload) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const tutorialState = roomTutorialStates.get(roomId);
            if (!tutorialState) return;

            const playerState = tutorialState.players.get(clientId);
            if (!playerState) return;

            // Update tilt data for screen visualization (kept for compatibility)
            if (data.tiltX !== undefined) playerState.tiltX = data.tiltX;
            if (data.tiltY !== undefined) playerState.tiltY = data.tiltY;

            // Mark steps as complete (auto-complete since gyro is disabled)
            switch (data.step) {
                case 'sling':
                    if (!playerState.completedSling) {
                        playerState.completedSling = true;
                        playerState.currentStep = 'tilt';
                    }
                    break;
                case 'tilt-left':
                case 'tilt-right':
                case 'tilt-up':
                case 'tilt-down':
                    // Auto-complete all tilt steps
                    playerState.completedTiltLeft = true;
                    playerState.completedTiltRight = true;
                    playerState.completedTiltUp = true;
                    playerState.completedTiltDown = true;
                    playerState.currentStep = 'complete';
                    break;
            }

            // Broadcast updated status to all
            broadcastTutorialStatus(roomManager, roomId);

            // Check if all players are complete
            if (isTutorialComplete(roomId)) {
                console.log(`[Tutorial] All players complete in room ${roomId}!`);
                if (tutorialState.timeoutId) clearTimeout(tutorialState.timeoutId);
                tutorialState.resolveComplete?.();
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

            // Reset game state — fresh questions will be generated when the next topic is selected
            room.engine.reset();

            // NOTE: We do NOT reset the score - it accumulates across restarts
            room.gameStarted = false;
            room.lastActivity = Date.now();
            roomManager.resetSpectatingStatus(roomId);

            // Keep players ready after restart so host can immediately start the next round.
            for (const c of room.controllers) {
                c.isReady = true;
            }

            // Player scores are intentionally NOT reset — they persist across games in the same lobby
            // But clear disconnected player scores from previous game
            roomManager.clearDisconnectedScores(roomId);

            room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
            for (const c of room.controllers) {
                if (c.channel) c.channel.emit(EVENTS.GAME_RESTARTED, {});
            }

            broadcastLobbyUpdate(roomManager, roomId);
        });

        // ---------- Disconnect ----------

        channel.onDisconnect(() => {
            clearConnectionTimeout(channel.id);
            const { role, roomId, clientId } = channel.userData || {};

            // Clean up crosshair throttle map
            if (clientId) crosshairLastSent.delete(clientId);

            if (role === 'screen') {
                // Start a 60s grace period before destroying the room.
                // If the screen reconnects within that window the session is preserved.
                const room = roomManager.markScreenDisconnected(channel.id, (expiredRoom) => {
                    // Grace period expired — destroy the room now
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
                    roomTutorialStates.delete(expiredRoom.roomId);
                    console.log(`[Transport] Room ${expiredRoom.roomId} destroyed after screen grace period`);
                });

                if (room) {
                    // Save top player score immediately (in case grace period expires)
                    if (room.gameStarted) {
                        const playerScores = roomManager.getPlayerScores(roomId);
                        PlayerManager.saveTopPlayer(roomId, playerScores);
                    }
                    // Notify controllers that the screen is temporarily gone
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
                    // Only emit to screen if it's still connected
                    if (!room.screenDisconnected) {
                        room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: clientId || channel.id, wasLeader });
                    }
                    broadcastLobbyUpdate(roomManager, room.roomId);

                    // If NO active players left, return everyone to lobby
                    if (room.gameStarted && !roomManager.hasActivePlayers(room.roomId)) {
                        console.log(`[Events] No active players left after disconnect in ${room.roomId}, returning to lobby`);
                        roomManager.forceEndGame(room.roomId);

                        if (!room.screenDisconnected) {
                            room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
                        }
                        for (const c of room.controllers) {
                            if (c.channel) c.channel.emit(EVENTS.GAME_RESTARTED, {});
                        }
                        broadcastLobbyUpdate(roomManager, room.roomId);
                    }

                    // Notify the promoted controller of their new role
                    if (promotedControllerId) {
                        const promotedController = room.controllers.find(c => c.clientId === promotedControllerId);
                        if (promotedController?.channel) {
                            promotedController.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                            console.log(`[Events] Emitted ROLE_PROMOTED to ${promotedControllerId}`);
                        }
                    }

                    // Update the engine's active player count so the early-reveal check
                    // stays accurate if a player disconnects during the selection phase.
                    if (room.gameStarted) {
                        const quizEngine = asQuizEngine(room);
                        if (quizEngine?.isMultiplayer()) {
                            const activePlayers = room.controllers.filter(c => !c.isSpectating && !c.disconnected);
                            quizEngine.updateActivePlayerCount(activePlayers.length);
                        }
                    }
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



    room.screenChannel.emit(EVENTS.LOBBY_UPDATE, lobby);
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.LOBBY_UPDATE, lobby);
    }
}

/** Broadcast tutorial status to all participants in a room */
function broadcastTutorialStatus(roomManager: RoomManager, roomId: string): void {
    const room = roomManager.getRoom(roomId);
    const tutorialState = roomTutorialStates.get(roomId);
    if (!room || !tutorialState) return;

    const players: TutorialPlayerStatus[] = Array.from(tutorialState.players.values());
    const allComplete = players.every(p => p.currentStep === 'complete');

    const payload: TutorialStatusUpdatePayload = { players, allComplete };

    room.screenChannel.emit(EVENTS.TUTORIAL_STATUS_UPDATE, payload);
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.TUTORIAL_STATUS_UPDATE, payload);
    }
}

/** Check if all players in a room have completed the tutorial */
function isTutorialComplete(roomId: string): boolean {
    const tutorialState = roomTutorialStates.get(roomId);
    if (!tutorialState) return true;
    const players = Array.from(tutorialState.players.values());
    return players.every(p => p.currentStep === 'complete');
}

/** Detect which orb was hit based on percentage coordinates */
function detectOrbHit(xPercent: number, yPercent: number): string | null {
    const HIT_RADIUS = 10; // percentage-based hit radius

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
