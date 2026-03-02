// ==========================================
// Event Handlers — Transport Layer
// Routes Geckos.io events to domain layer
// ==========================================

import { EVENTS } from '../shared/protocol.ts';
import { ORB_POSITIONS } from '../shared/types.ts';
import type { PlayerSelectionPayload, RevealResultPayload, TutorialProgressPayload, TutorialPlayerStatus, TutorialStatusUpdatePayload, TutorialStep } from '../shared/types.ts';
import { RoomManager } from '../domain/RoomManager.ts';
import { TeamManager } from '../domain/TeamManager.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

const connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const crosshairLastSent = new Map<string, number>(); // Throttle crosshair relay per controller
const CROSSHAIR_THROTTLE_MS = 33; // ~30fps max relay rate

// Per-room tutorial state tracking
interface RoomTutorialState {
    players: Map<string, TutorialPlayerStatus>;
    timeoutId: ReturnType<typeof setTimeout> | null;
    resolveComplete: (() => void) | null;
}
const roomTutorialStates = new Map<string, RoomTutorialState>();

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
            const leaderboard = TeamManager.getLeaderboard(10);
            channel.emit(EVENTS.ROOM_CREATED, { roomId, joinToken, leaderboard });
        });

        channel.on(EVENTS.JOIN_ROOM, (data: { roomId: string; token: string; clientId?: string }) => {
            clearConnectionTimeout(channel.id);
            const { roomId, token, clientId } = data;

            // clientId is now required for role persistence
            if (!clientId) {

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
            channel.emit(EVENTS.JOINED_ROOM, { roomId, success: true, role: result.role, colorIndex: result.colorIndex });

            // Notify screen with color index so it can assign consistent crosshair color
            const room = roomManager.getRoom(roomId);
            if (room) {
                room.screenChannel.emit(EVENTS.CONTROLLER_JOINED, { controllerId: clientId, role: result.role, colorIndex: result.colorIndex });
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

            if (!roomId || !clientId) {

                return;
            }

            const started = roomManager.startGame(roomId, clientId);
            if (!started) {

                return;
            }


            const room = roomManager.getRoom(roomId);
            if (!room) {

                return;
            }

            // Step 1: Initialize tutorial state for each player
            const tutorialState: RoomTutorialState = {
                players: new Map(),
                timeoutId: null,
                resolveComplete: null,
            };
            for (const c of room.controllers) {
                tutorialState.players.set(c.clientId, {
                    controllerId: c.clientId,
                    colorIndex: c.colorIndex,
                    currentStep: 'waiting' as TutorialStep,
                    completedSling: false,
                    completedTiltLeft: false,
                    completedTiltRight: false,
                    tiltX: 50,
                    tiltY: 50,
                });
            }
            roomTutorialStates.set(roomId, tutorialState);

            // Send TUTORIAL_START to all clients and screen
            room.screenChannel.emit(EVENTS.TUTORIAL_START, { duration: 60000 });
            for (const c of room.controllers) {
                c.channel.emit(EVENTS.TUTORIAL_START, { duration: 60000 });
            }

            // Broadcast initial tutorial status
            broadcastTutorialStatus(roomManager, roomId);

            // Step 2: Initialize quiz engine in background during tutorial
            console.log(`[Game] Initializing quiz engine for room ${roomId} during tutorial...`);
            try {
                await room.quizEngine.initialize();
                console.log(`[Game] Quiz engine initialized with ${room.quizEngine.getTotalQuestions()} questions for room ${roomId}`);
            } catch (error) {
                console.error(`[Game] Failed to initialize quiz engine:`, error);
            }

            // Step 3: Wait for all players to complete tutorial OR 60s timeout
            await new Promise<void>((resolve) => {
                tutorialState.resolveComplete = resolve;

                // Fallback timeout (60 seconds)
                tutorialState.timeoutId = setTimeout(() => {
                    console.log(`[Tutorial] Timeout reached for room ${roomId}, forcing start`);
                    resolve();
                }, 60000);

                // Check if already complete (e.g. single player)
                if (isTutorialComplete(roomId)) {
                    if (tutorialState.timeoutId) clearTimeout(tutorialState.timeoutId);
                    resolve();
                }
            });

            // Clean up tutorial state
            roomTutorialStates.delete(roomId);

            // Step 4: Send TUTORIAL_END

            room.screenChannel.emit(EVENTS.TUTORIAL_END, {});
            for (const c of room.controllers) {
                c.channel.emit(EVENTS.TUTORIAL_END, {});
            }

            // Set player count for timer logic
            const playerCount = room.controllers.length;
            room.quizEngine.setPlayerCount(playerCount);


            // Get first question
            const question = room.quizEngine.getCurrentQuestion();


            if (playerCount >= 2) {
                // ==========================================
                // MULTIPLAYER — Phase-based timer
                // ==========================================

                // Wire phase callbacks
                room.quizEngine.setPhaseCallbacks(
                    // Phase change
                    (phase, timeLeft, questionNumber) => {
                        const phasePayload = { phase, timeLeft, questionNumber };
                        room.screenChannel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                        for (const c of room.controllers) {
                            c.channel.emit(EVENTS.PHASE_CHANGE, phasePayload);
                        }

                        // When entering analysis for a NEW question (not the first),
                        // send the next question to all clients
                        // Note: analysis phase duration is 2 seconds, so timeLeft starts at 2
                        if (phase === 'analysis' && timeLeft === 2 && questionNumber > 1) {
                            const nextQ = room.quizEngine.getLastSelectedQuestion();
                            if (nextQ) {
                                room.screenChannel.emit(EVENTS.QUESTION, nextQ);
                                for (const c of room.controllers) {
                                    c.channel.emit(EVENTS.QUESTION, nextQ);
                                }
                            }
                        }
                    },
                    // Reveal result
                    (result: RevealResultPayload) => {
                        // Award points if any correct
                        if (result.anyCorrect) {
                            room.teamManager.addScore(result.points);
                        }

                        // Broadcast reveal to all
                        room.screenChannel.emit(EVENTS.REVEAL_RESULT, result);
                        for (const c of room.controllers) {
                            c.channel.emit(EVENTS.REVEAL_RESULT, result);
                        }

                        // Broadcast score update
                        const scorePayload = {
                            teamScore: room.teamManager.getLiveScore(),
                            teamName: room.teamManager.getTeamName(),
                        };
                        room.screenChannel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                        for (const c of room.controllers) {
                            c.channel.emit(EVENTS.SCORE_UPDATE, scorePayload);
                        }

                        // Next question is handled by evaluateSelections in QuizEngine
                        // which calls nextQuestion() → getCurrentQuestion() → beginPhase('analysis')
                        // We send the new QUESTION event from the phase change callback instead
                    },
                    // Game over
                    () => {
                        const finalScore = room.teamManager.getLiveScore();
                        const questionsAnswered = room.quizEngine.getSessionQuestionsAnswered();
                        room.teamManager.saveGameResult(roomId, room.quizEngine.getQuestionsAnswered());

                        const leaderboard = TeamManager.getLeaderboard(10);

                        // Determine reason from quiz engine
                        const reason = room.quizEngine.getLastGameOverReason();

                        const gameOverPayload = {
                            finalScore,
                            teamName: room.teamManager.getTeamName(),
                            leaderboard,
                            reason,
                            questionsAnswered,
                        };

                        room.screenChannel.emit(EVENTS.GAME_OVER, gameOverPayload);
                        for (const c of room.controllers) {
                            c.channel.emit(EVENTS.GAME_OVER, gameOverPayload);
                        }
                    }
                );

                // Send GAME_STARTED event
                const gameStartPayload = { question, timeLeft: 20 };
                room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
                for (const c of room.controllers) {
                    c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
                }

                // Start the phase timer
                room.quizEngine.startPhaseTimer();

            } else {
                // ==========================================
                // SINGLEPLAYER — Classic continuous timer
                // ==========================================

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
                        const questionsAnswered = room.quizEngine.getSessionQuestionsAnswered();
                        room.teamManager.saveGameResult(roomId, room.quizEngine.getQuestionsAnswered());

                        const leaderboard = TeamManager.getLeaderboard(10);
                        const gameOverPayload = {
                            finalScore,
                            teamName: room.teamManager.getTeamName(),
                            leaderboard,
                            reason: room.quizEngine.getLastGameOverReason(),
                            questionsAnswered,
                        };

                        room.screenChannel.emit(EVENTS.GAME_OVER, gameOverPayload);
                        for (const c of room.controllers) {
                            c.channel.emit(EVENTS.GAME_OVER, gameOverPayload);
                        }
                    }
                );

                // Start timer and send first question
                room.quizEngine.startTimer();
                const gameStartPayload = { question, timeLeft: room.quizEngine.getTimeLeft() };
                room.screenChannel.emit(EVENTS.GAME_STARTED, gameStartPayload);
                for (const c of room.controllers) {
                    c.channel.emit(EVENTS.GAME_STARTED, gameStartPayload);
                }
            }
        });

        // ---------- Game Input ----------

        channel.on(EVENTS.SHOOT, (data: { targetXPercent: number; targetYPercent: number; power: number }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room || !room.gameStarted) return;

            // Determine which orb was hit based on coordinates
            const hitOrb = detectOrbHit(data.targetXPercent, data.targetYPercent);

            if (room.quizEngine.isMultiplayer()) {
                // ==========================================
                // MULTIPLAYER — Phase-based selection
                // ==========================================

                const currentPhase = room.quizEngine.getCurrentPhase();

                if (currentPhase !== 'selection') {
                    // During analysis and reveal phases, ignore shots completely
                    // But still show the projectile visual if during analysis (so players see the slingshot animating)
                    return;
                }

                if (!hitOrb) return; // Missed all orbs

                // Find the controller's color index
                const controller = room.controllers.find(c => c.clientId === clientId);
                if (!controller) return;

                // Try to record the selection
                const accepted = room.quizEngine.recordSelection(clientId!, hitOrb, controller.colorIndex);
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
                    c.channel.emit(EVENTS.PLAYER_SELECTION, selectionPayload);
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

                    // Award points only for correct answers
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

                    // Always advance to next question after showing animation (both correct and wrong)
                    // Reset timer for fresh time on next question
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
            if (!room?.screenChannel || !clientId) return;

            // In multiplayer, only relay crosshair during selection phase
            if (room.quizEngine.isMultiplayer()) {
                const currentPhase = room.quizEngine.getCurrentPhase();
                if (currentPhase !== 'selection') return;
            }

            // Throttle relay to ~30fps per controller to reduce bandwidth
            const now = Date.now();
            const lastSent = crosshairLastSent.get(clientId) || 0;
            if (now - lastSent < CROSSHAIR_THROTTLE_MS) return;
            crosshairLastSent.set(clientId, now);

            room.screenChannel.emit(EVENTS.CROSSHAIR, { controllerId: clientId, ...data }, { reliable: false });
        });

        channel.on(EVENTS.START_AIMING, (data: { gyroEnabled: boolean }) => {
            const { roomId, clientId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room?.screenChannel || !clientId) return;

            // In multiplayer, only relay during selection phase
            if (room.quizEngine.isMultiplayer()) {
                const currentPhase = room.quizEngine.getCurrentPhase();
                if (currentPhase !== 'selection') return;
            }

            room.screenChannel.emit(EVENTS.START_AIMING, { controllerId: clientId, ...data });
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

        channel.on(EVENTS.TUTORIAL_PROGRESS, (data: TutorialProgressPayload) => {
            const { roomId, clientId } = channel.userData || {};
            if (!roomId || !clientId) return;

            const tutorialState = roomTutorialStates.get(roomId);
            if (!tutorialState) return;

            const playerState = tutorialState.players.get(clientId);
            if (!playerState) return;

            // Update tilt data for screen visualization
            if (data.tiltX !== undefined) playerState.tiltX = data.tiltX;
            if (data.tiltY !== undefined) playerState.tiltY = data.tiltY;

            // Update step completion
            switch (data.step) {
                case 'sling':
                    if (!playerState.completedSling) {
                        playerState.completedSling = true;
                        playerState.currentStep = 'tilt-left';
                        console.log(`[Tutorial] Player ${clientId.substring(0, 8)} completed SLING`);
                    }
                    break;
                case 'tilt-left':
                    if (playerState.completedSling && !playerState.completedTiltLeft) {
                        playerState.completedTiltLeft = true;
                        playerState.currentStep = 'tilt-right';
                        console.log(`[Tutorial] Player ${clientId.substring(0, 8)} completed TILT-LEFT`);
                    }
                    break;
                case 'tilt-right':
                    if (playerState.completedTiltLeft && !playerState.completedTiltRight) {
                        playerState.completedTiltRight = true;
                        playerState.currentStep = 'complete';
                        console.log(`[Tutorial] Player ${clientId.substring(0, 8)} completed TILT-RIGHT`);
                    }
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
            const { role, roomId, clientId } = channel.userData || {};

            // Clean up crosshair throttle map
            if (clientId) crosshairLastSent.delete(clientId);


            if (role === 'screen') {
                const room = roomManager.deleteRoomByScreen(channel.id);
                if (room) {


                    // Save the score before deleting the room (if game was in progress)
                    if (room.gameStarted) {
                        const finalScore = room.teamManager.getLiveScore();
                        const questionsAnswered = room.quizEngine.getQuestionsAnswered();
                        room.teamManager.saveGameResult(roomId, questionsAnswered);

                    }

                    // Get updated leaderboard after saving
                    const leaderboard = TeamManager.getLeaderboard(10);

                    // Notify all controllers that the room is gone
                    for (const c of room.controllers) {
                        c.channel.emit(EVENTS.GAME_OVER, {
                            finalScore: room.teamManager.getLiveScore(),
                            teamName: room.teamManager.getTeamName(),
                            leaderboard,
                            reason: 'time',
                            questionsAnswered: room.quizEngine.getSessionQuestionsAnswered(),
                        });
                    }
                }
            } else if (role === 'controller') {
                const { room, wasLeader } = roomManager.removeController(channel.id);
                if (room) {

                    room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: channel.id });
                    broadcastLobbyUpdate(roomManager, room.roomId);
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
        c.channel.emit(EVENTS.LOBBY_UPDATE, lobby);
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
        c.channel.emit(EVENTS.TUTORIAL_STATUS_UPDATE, payload);
    }
}

/** Check if all players in a room have completed the tutorial */
function isTutorialComplete(roomId: string): boolean {
    const tutorialState = roomTutorialStates.get(roomId);
    if (!tutorialState) return true; // No tutorial state means it's done
    const players = Array.from(tutorialState.players.values());
    return players.every(p => p.currentStep === 'complete');
}

/** Detect which orb was hit based on percentage coordinates */
function detectOrbHit(xPercent: number, yPercent: number): string | null {
    const HIT_RADIUS = 10; // percentage-based hit radius (increased for better mobile/gyro UX)

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
