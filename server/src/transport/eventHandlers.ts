// ==========================================
// Event Handlers — Transport Layer
// Routes Geckos.io events to domain layer
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { ORB_POSITIONS, QUIZ_TOPICS, TOPIC_SELECTION_TIMEOUT_MS } from '../shared/types.ts';
import type { PlayerSelectionPayload, RevealResultPayload, TutorialProgressPayload, TutorialPlayerStatus, TutorialStatusUpdatePayload, TutorialStep, QuizTopicId } from '../shared/types.ts';
import { RoomManager } from '../domain/RoomManager.ts';
import { PlayerManager } from '../domain/PlayerManager.ts';
import { preGenerateForSession } from '../data/questionRepository.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const crosshairLastSent = new Map<string, number>(); // Throttle crosshair relay per controller
const CROSSHAIR_THROTTLE_MS = 33; // ~30fps max relay rate

// Periodically clean up old crosshair timestamps to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    // Remove entries older than 5 minutes
    for (const [clientId, timestamp] of crosshairLastSent.entries()) {
        if (now - timestamp > 300000) { // 5 minutes
            crosshairLastSent.delete(clientId);
        }
    }
}, 60000); // Run cleanup every minute

// Per-room tutorial state tracking (kept for loading state compatibility)
interface RoomTutorialState {
    players: Map<string, TutorialPlayerStatus>;
    timeoutId: ReturnType<typeof setTimeout> | null;
    resolveComplete: (() => void) | null;
}
const roomTutorialStates = new Map<string, RoomTutorialState>();

async function finalizeTopicSelection(roomId: string, topicId: QuizTopicId, roomManager: RoomManager): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const topicLabel = QUIZ_TOPICS.find(t => t.id === topicId)?.label || topicId;
    console.log(`[Game] Topic selected in ${roomId}: ${topicId} (${topicLabel})`);

    const topicSelectedPayload = { topicId, topicLabel };
    room.screenChannel.emit(EVENTS.TOPIC_SELECTED, topicSelectedPayload);
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.TOPIC_SELECTED, topicSelectedPayload);
    }

    // Fire-and-forget: start pre-generating questions immediately so they may be
    // ready (or partially ready) by the time initialize() is called in startGameAfterTopicSelection.
    preGenerateForSession(room.quizEngine.getSessionId(), topicId).catch(err => {
        console.warn(`[Game] Pre-generation failed for room ${roomId}, topic ${topicId}:`, err);
    });

    await startGameAfterTopicSelection(roomId, topicId, roomManager);
}

async function startGameAfterTopicSelection(roomId: string, topicId: QuizTopicId, roomManager: RoomManager): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const playerCount = room.controllers.length;

    room.screenChannel.emit(EVENTS.LOADING_START, { playerCount });
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.LOADING_START, { playerCount });
    }

    try {
        // Ensure initialized flag is cleared before loading questions for this round
        room.quizEngine.reset(true);
        await room.quizEngine.initialize(topicId);
        console.log(`[Game] Quiz engine initialized with ${room.quizEngine.getTotalQuestions()} questions for room ${roomId} (topic: ${topicId})`);
    } catch (error) {
        console.error(`[Game] Failed to initialize quiz engine:`, error);
    }

    room.screenChannel.emit(EVENTS.LOADING_COUNTDOWN, { duration: 3 });
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(EVENTS.LOADING_COUNTDOWN, { duration: 3 });
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    const modeChanged = room.quizEngine.setPlayerCount(playerCount);
    if (modeChanged) {
        console.log(`[EventHandlers] Game mode changed — resetting player scores`);
        roomManager.resetPlayerScores(roomId);
    }

    const question = room.quizEngine.getCurrentQuestion();

    if (playerCount >= 2) {
        room.quizEngine.setPhaseCallbacks(
            (phase, timeLeft, questionNumber) => {
                const phasePayload = { phase, timeLeft, questionNumber };
                room.screenChannel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                }
                if (phase === 'analysis' && timeLeft === 1 && questionNumber > 1) {
                    const nextQ = room.quizEngine.getLastSelectedQuestion();
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
                const questionsAnswered = room.quizEngine.getSessionQuestionsAnswered();
                const playerScores = roomManager.getPlayerScores(roomId);
                PlayerManager.saveTopPlayer(roomId, playerScores);
                const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                const reason = room.quizEngine.getLastGameOverReason();
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
        room.quizEngine.startPhaseTimer();
    } else {
        room.quizEngine.setCallbacks(
            (timeLeft: number) => {
                room.screenChannel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.TIMER_SYNC, { timeLeft });
                }
            },
            () => {
                const questionsAnswered = room.quizEngine.getSessionQuestionsAnswered();
                const playerScores = roomManager.getPlayerScores(roomId);
                PlayerManager.saveTopPlayer(roomId, playerScores);
                const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                const gameOverPayload = {
                    leaderboard,
                    reason: room.quizEngine.getLastGameOverReason(),
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

        room.quizEngine.startTimer();
        const gameStartPayload = { question, timeLeft: room.quizEngine.getTimeLeft() };
        room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        for (const c of room.controllers) {
            if (c.channel) c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
        }
    }
}

export function registerEventHandlers(io: GeckosServer, roomManager: RoomManager): void {
    io.onConnection((channel: ServerChannel) => {


        // Handshake timeout
        const timeoutId = setTimeout(() => {
            if (connectionTimeouts.has(channel.id)) {
                connectionTimeouts.delete(channel.id);
            }
        }, 15000);
        connectionTimeouts.set(channel.id, timeoutId);

        // ---------- Room Lifecycle ----------

        channel.on(EVENTS.CREATE_ROOM, () => {
            clearConnectionTimeout(channel.id);
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

            // Try reconnect first if game is in progress
            const existingRoom = roomManager.getRoom(roomId);
            if (existingRoom && existingRoom.gameStarted) {
                const reconnectResult = roomManager.reconnectController(roomId, clientId, channel);
                if (reconnectResult.success) {
                    channel.userData = { role: 'controller', roomId, clientId };
                    channel.emit(EVENTS.RECONNECTED, {
                        success: true,
                        phase: reconnectResult.phase,
                        playerScores: reconnectResult.playerScores,
                        colorIndex: existingRoom.controllers.find(c => c.clientId === clientId)?.colorIndex ?? 0,
                        role: existingRoom.controllers.find(c => c.clientId === clientId)?.role ?? 'member',
                    });
                    console.log(`[Transport] Controller ${clientId} reconnected to room ${roomId}, phase: ${reconnectResult.phase}`);
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
                room.screenChannel.emit(EVENTS.CONTROLLER_JOINED, { controllerId: clientId, role: result.role, colorIndex: result.colorIndex });
                broadcastLobbyUpdate(roomManager, roomId);
            }
        });

        // ---------- Lobby ----------

        channel.on(EVENTS.SET_PLAYER_NAME, (data: { name: string }) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const trimmedName = (data.name || '').trim();
            if (trimmedName.length < 1 || trimmedName.length > 20) return;

            const success = roomManager.setPlayerName(roomId, clientId, trimmedName);
            if (success) {
                const room = roomManager.getRoom(roomId);
                if (room) room.lastActivity = Date.now();
                broadcastLobbyUpdate(roomManager, roomId);
            }
        });

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
                });
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                        votes: topicUpdate.votes,
                        votedControllerIds: topicUpdate.votedControllerIds,
                        totalVoters: topicUpdate.totalVoters,
                        timeLeft: topicUpdate.timeLeft,
                        topics: topicOrbs,
                    });
                }

                // Broadcast countdown every second
                let topicCountdown = setInterval(() => {
                    const currentUpdate = roomManager.getTopicVoteUpdate(roomId);
                    if (!currentUpdate || currentUpdate.timeLeft <= 0) {
                        clearInterval(topicCountdown);
                        return;
                    }
                    room.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                        votes: currentUpdate.votes,
                        votedControllerIds: currentUpdate.votedControllerIds,
                        totalVoters: currentUpdate.totalVoters,
                        timeLeft: currentUpdate.timeLeft,
                        topics: topicOrbs,
                    });
                }, 1000);

                // Override the timeout to call startGameAfterTopicSelection
                if (room.topicSelectionTimer) {
                    clearTimeout(room.topicSelectionTimer);
                }
                room.topicSelectionTimer = setTimeout(() => {
                    const result = roomManager.resolveTopicVote(roomId);
                    finalizeTopicSelection(roomId, result.topicId, roomManager);
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
                finalizeTopicSelection(roomId, result.resolved.topicId, roomManager);
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

            if (room.quizEngine.isMultiplayer()) {
                // ==========================================
                // MULTIPLAYER — Phase-based selection
                // ==========================================

                const currentPhase = room.quizEngine.getCurrentPhase();
                console.log(`[Game] Multiplayer shoot, currentPhase: ${currentPhase}`);

                if (currentPhase !== 'selection') {
                    // During analysis and reveal phases, ignore shots completely
                    // But still show the projectile visual if during analysis (so players see the slingshot animating)
                    console.log(`[Game] Ignoring shot - not in selection phase (current: ${currentPhase})`);
                    return;
                }

                if (!hitOrb) {
                    console.log(`[Game] Shot missed all orbs`);
                    return; // Missed all orbs
                }

                // Find the controller's color index
                const controller = room.controllers.find(c => c.clientId === clientId);
                if (!controller) {
                    console.log(`[Game] Controller not found for clientId: ${clientId}`);
                    return;
                }

                // Try to record the selection
                const accepted = room.quizEngine.recordSelection(clientId!, hitOrb, controller.colorIndex);
                console.log(`[Game] Selection accepted: ${accepted} for ${clientId?.substring(0, 8)}... orb: ${hitOrb}`);
                if (!accepted) return; // Already selected or wrong phase

                // Send projectile to screen for visual
                room.screenChannel.emit(EVENTS.PROJECTILE, {
                    controllerId: clientId,
                    targetXPercent: data.targetXPercent,
                    targetYPercent: data.targetYPercent,
                });

                // Broadcast the player's selection to screen + all controllers
                const selectionPayload: PlayerSelectionPayload = {
                    controllerId: clientId!,
                    orbId: hitOrb,
                    colorIndex: controller.colorIndex,
                };
                room.screenChannel.emit(EVENTS.PLAYER_SELECTION, selectionPayload);
                for (const c of room.controllers) {
                    if (c.channel) c.channel.emit(EVENTS.PLAYER_SELECTION, selectionPayload);
                }

                // No HIT_RESULT in multiplayer — correctness is only revealed during the Reveal phase
                // The controller already locks after shooting via client-side state

            } else {
                // ==========================================
                // SINGLEPLAYER — Classic immediate validation
                // ==========================================

                // Send projectile to screen for visual
                room.screenChannel.emit(EVENTS.PROJECTILE, {
                    controllerId: channel.id,
                    targetXPercent: data.targetXPercent,
                    targetYPercent: data.targetYPercent,
                });

                if (hitOrb) {
                    // Validate answer server-side
                    const result = room.quizEngine.validateAnswer(hitOrb);

                    // Award individual score for correct singleplayer hit
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

                    // Send result to screen and controller
                    room.screenChannel.emit(EVENTS.HIT_RESULT, hitPayload);
                    channel.emit(EVENTS.HIT_RESULT, hitPayload);

                    // Send score update
                    const scorePayload = {
                        playerScores: roomManager.getPlayerScores(roomId),
                    };
                    room.screenChannel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                    for (const c of room.controllers) {
                        if (c.channel) c.channel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                    }

                    // Always advance to next question after showing animation (both correct and wrong)
                    // Reset timer for fresh time on next question
                    room.quizEngine.resetTimer();

                    setTimeout(async () => {
                        const nextQ = await room.quizEngine.nextQuestion();
                        if (nextQ) {
                            room.screenChannel.emit(EVENTS.QUESTION, nextQ);
                            for (const c of room.controllers) {
                                if (c.channel) c.channel.emit(EVENTS.QUESTION, nextQ);
                            }
                        }
                    }, 1500); // Match the existing transition delay
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
            } else if (room.quizEngine.isMultiplayer()) {
                const currentPhase = room.quizEngine.getCurrentPhase();
                if (currentPhase !== 'selection') return;
            }

            // Update activity on crosshair move (throttled by the check below naturally)
            room.lastActivity = Date.now();

            // Throttle relay to ~30fps per controller to reduce bandwidth
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
            } else if (room.quizEngine.isMultiplayer()) {
                const currentPhase = room.quizEngine.getCurrentPhase();
                if (currentPhase !== 'selection') return;
            }

            // Always send with gyro disabled since we removed that functionality
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

        channel.on(EVENTS.RESTART_GAME, async () => {
            const { roomId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room) return;

            // Only leader can restart — use clientId
            const { clientId: restartClientId } = channel.userData || {};
            const controller = room.controllers.find((c) => c.clientId === restartClientId);
            if (!controller || controller.role !== 'leader') return;

            console.log(`[Room] Regenerating questions for restart in ${roomId}...`);

            // Regenerate fresh AI questions (async)
            try {
                await room.quizEngine.resetAndRegenerate();
            } catch (err) {
                console.error('[Room] Failed to regenerate questions on restart, using reset fallback:', err);
                room.quizEngine.reset();
            }

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
                const room = roomManager.deleteRoomByScreen(channel.id);
                if (room) {

                    // Save the top player score before deleting the room (if game was in progress)
                    if (room.gameStarted) {
                        const playerScores = roomManager.getPlayerScores(roomId);
                        PlayerManager.saveTopPlayer(roomId, playerScores);
                    }

                    // Get updated leaderboard
                    const leaderboard = PlayerManager.getPlayerLeaderboard(5);

                    // Notify all controllers that the room is gone
                    for (const c of room.controllers) {
                        if (c.channel) c.channel.emit(EVENTS.GAME_OVER, {
                            leaderboard,
                            reason: 'time',
                            questionsAnswered: room.quizEngine.getSessionQuestionsAnswered(),
                            playerScores: roomManager.getPlayerScores(roomId),
                        });
                    }
                }
            } else if (role === 'controller') {
                const { room, wasLeader, promotedControllerId } = roomManager.removeController(channel.id);
                if (room) {

                    // Use persistent clientId so screen and controllers resolve the same player identity.
                    room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: clientId || channel.id, wasLeader });
                    broadcastLobbyUpdate(roomManager, room.roomId);

                    // If NO active players left, return everyone to lobby
                    if (room.gameStarted && !roomManager.hasActivePlayers(room.roomId)) {
                        console.log(`[Events] No active players left after disconnect in ${room.roomId}, returning to lobby`);
                        roomManager.forceEndGame(room.roomId);

                        // Broadcast game restarted to return all remaining controllers to lobby view
                        room.screenChannel.emit(EVENTS.GAME_RESTARTED, {});
                        for (const c of room.controllers) {
                            if (c.channel) c.channel.emit(EVENTS.GAME_RESTARTED, {});
                        }
                        broadcastLobbyUpdate(roomManager, room.roomId);
                    }

                    // Notify the promoted controller of their new role
                    if (promotedControllerId) {
                        const promotedController = room.controllers.find(c => c.clientId === promotedControllerId);
                        if (promotedController) {
                            promotedController.channel.emit(EVENTS.ROLE_PROMOTED, { role: 'leader' });
                            console.log(`[Events] Emitted ROLE_PROMOTED to ${promotedControllerId}`);
                        }
                    }
                } else {

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
