// ==========================================
// ShootQuiz Plugin — Game-specific handler
// Owns all quiz state per room and all quiz
// event handlers (topic voting, shooting, etc.)
// The core RoomManager knows nothing about this.
// ==========================================

import { EVENTS } from '../../shared/protocol.ts';
import { ORB_POSITIONS, QUIZ_TOPICS, TOPIC_SELECTION_TIMEOUT_MS, DEFAULT_TOPIC, DEFAULT_DIFFICULTY } from '../../shared/types.ts';
import type { PlayerSelectionPayload, RevealResultPayload, QuizTopicId, QuizDifficulty, TopicVoteUpdatePayload, TopicSelectedPayload } from '../../shared/types.ts';
import { RoomManager, type Room } from '../../domain/RoomManager.ts';
import { PlayerManager } from '../../domain/PlayerManager.ts';
import { QuizEngine, PHASE_DURATIONS } from './QuizEngine.ts';
import * as teamRepo from '../../data/teamRepository.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeckosServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerChannel = any;

// ---- Per-room quiz state ----

interface QuizRoomState {
    topicVotes: Map<string, QuizTopicId>;
    topicSelectionTimer: ReturnType<typeof setTimeout> | null;
    topicSelectionStarted: boolean;
    topicSelectionStartedAt: number | null;
    selectedDifficulty: QuizDifficulty;
    topicCountdownInterval?: ReturnType<typeof setInterval>;
    /** Persisted voter count available even after topicSelectionStarted is set to false */
    finalVoteCount: number;
}

// ---- Crosshair throttle (shared across all rooms) ----

const crosshairLastSent = new Map<string, number>();
const CROSSHAIR_THROTTLE_MS = 33; // ~30fps

setInterval(() => {
    const now = Date.now();
    for (const [clientId, ts] of crosshairLastSent.entries()) {
        if (now - ts > 300_000) crosshairLastSent.delete(clientId);
    }
    while (crosshairLastSent.size > 100) {
        const oldest = crosshairLastSent.keys().next().value;
        if (oldest) crosshairLastSent.delete(oldest);
    }
}, 60_000);

// ---- Helper: safe cast to QuizEngine ----

function asQuizEngine(room: Room): QuizEngine | null {
    return room.engine instanceof QuizEngine ? room.engine : null;
}

// ---- Broadcast helpers ----

function broadcastAll(room: Room, event: string, payload: unknown): void {
    room.screenChannel.emit(event, payload);
    for (const c of room.controllers) {
        if (c.channel) c.channel.emit(event, payload);
    }
}

// ---- Orb hit detection ----

function detectOrbHit(xPercent: number, yPercent: number): string | null {
    const HIT_RADIUS = 10;
    for (const orb of ORB_POSITIONS) {
        const dist = Math.sqrt(Math.pow(xPercent - orb.x, 2) + Math.pow(yPercent - orb.y, 2));
        if (dist < HIT_RADIUS) return orb.id;
    }
    return null;
}

// ==========================================
// ShootQuizPlugin class
// ==========================================

export class ShootQuizPlugin {
    /** Per-room quiz state, keyed by roomId */
    private quizState = new Map<string, QuizRoomState>();

    constructor(private roomManager: RoomManager) {
        // Clean up quiz state when a room is deleted
        roomManager.setOnRoomDeleted((roomId) => {
            this.cleanupRoom(roomId);
        });
    }

    // ---- State lifecycle ----

    initRoom(roomId: string): void {
        if (this.quizState.has(roomId)) return;
        this.quizState.set(roomId, {
            topicVotes: new Map(),
            topicSelectionTimer: null,
            topicSelectionStarted: false,
            topicSelectionStartedAt: null,
            selectedDifficulty: DEFAULT_DIFFICULTY,
            finalVoteCount: 0,
        });
    }

    cleanupRoom(roomId: string): void {
        const state = this.quizState.get(roomId);
        if (!state) return;
        if (state.topicSelectionTimer) clearTimeout(state.topicSelectionTimer);
        if (state.topicCountdownInterval) clearInterval(state.topicCountdownInterval);
        this.quizState.delete(roomId);
    }

    getState(roomId: string): QuizRoomState | null {
        return this.quizState.get(roomId) ?? null;
    }

    // ---- Topic selection ----

    startTopicSelection(roomId: string): TopicVoteUpdatePayload | null {
        const state = this.quizState.get(roomId);
        if (!state || state.topicSelectionStarted) return null;

        state.topicVotes.clear();
        state.topicSelectionStarted = true;
        state.topicSelectionStartedAt = Date.now();

        state.topicSelectionTimer = setTimeout(() => {
            console.log(`[ShootQuiz] Topic selection timeout in ${roomId}`);
        }, TOPIC_SELECTION_TIMEOUT_MS);

        console.log(`[ShootQuiz] Topic selection started in ${roomId}`);
        return this.getTopicVoteUpdate(roomId);
    }

    castTopicVote(
        roomId: string,
        clientId: string,
        topicId: QuizTopicId,
    ): { accepted: boolean; update: TopicVoteUpdatePayload | null; resolved: TopicSelectedPayload | null } {
        const state = this.quizState.get(roomId);
        const room = this.roomManager.getRoom(roomId);
        if (!state || !room || !state.topicSelectionStarted) {
            return { accepted: false, update: null, resolved: null };
        }

        const validTopic = QUIZ_TOPICS.find(t => t.id === topicId);
        if (!validTopic) return { accepted: false, update: null, resolved: null };

        state.topicVotes.set(clientId, topicId);
        const update = this.getTopicVoteUpdate(roomId)!;

        const activePlayers = room.controllers.filter(c => !c.disconnected);
        const allVoted = state.topicVotes.size >= activePlayers.length;

        if (allVoted || room.controllers.length === 1) {
            if (state.topicSelectionTimer) {
                clearTimeout(state.topicSelectionTimer);
                state.topicSelectionTimer = null;
            }
            const resolved = this.resolveTopicVote(roomId);
            return { accepted: true, update, resolved };
        }

        return { accepted: true, update, resolved: null };
    }

    resolveTopicVote(roomId: string): TopicSelectedPayload {
        const state = this.quizState.get(roomId);
        const room = this.roomManager.getRoom(roomId);
        const fallback: TopicSelectedPayload = {
            topicId: DEFAULT_TOPIC,
            topicLabel: QUIZ_TOPICS.find(t => t.id === DEFAULT_TOPIC)!.label,
            difficulty: DEFAULT_DIFFICULTY,
        };
        if (!state || !room) return fallback;

        const voteCounts = new Map<QuizTopicId, number>();
        for (const [, topicId] of state.topicVotes) {
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

        if (tiedTopics.length === 0 || state.topicVotes.size === 0) {
            selectedTopic = DEFAULT_TOPIC;
            console.log(`[ShootQuiz] No votes in ${roomId}, defaulting to ${DEFAULT_TOPIC}`);
        } else if (tiedTopics.length === 1) {
            selectedTopic = tiedTopics[0];
        } else {
            selectedTopic = tiedTopics[Math.floor(Math.random() * tiedTopics.length)];
            console.log(`[ShootQuiz] Tie in ${roomId} between [${tiedTopics.join(', ')}], selected: ${selectedTopic}`);
        }

        const topicLabel = QUIZ_TOPICS.find(t => t.id === selectedTopic)?.label || selectedTopic;
        state.finalVoteCount = state.topicVotes.size;
        state.topicSelectionStarted = false;
        state.topicSelectionTimer = null;

        const quizEngine = asQuizEngine(room);
        if (quizEngine) quizEngine.setTopic(selectedTopic);

        console.log(`[ShootQuiz] Topic selected in ${roomId}: ${selectedTopic} (${topicLabel})`);
        return { topicId: selectedTopic, topicLabel, difficulty: state.selectedDifficulty };
    }

    getTopicVoteUpdate(roomId: string): TopicVoteUpdatePayload | null {
        const state = this.quizState.get(roomId);
        const room = this.roomManager.getRoom(roomId);
        if (!state || !room) return null;

        const votes: Record<string, number> = {};
        const playerVotes: Record<string, string> = {};
        for (const [clientId, topicId] of state.topicVotes) {
            votes[clientId] = 1;
            playerVotes[clientId] = topicId;
        }

        const votedControllerIds = Array.from(state.topicVotes.keys());
        const activePlayers = room.controllers.filter(c => !c.disconnected);
        const totalVoters = activePlayers.length;

        const elapsedMs = state.topicSelectionStartedAt ? Date.now() - state.topicSelectionStartedAt : 0;
        const timeLeft = state.topicSelectionTimer == null
            ? 0
            : Math.max(0, Math.ceil((TOPIC_SELECTION_TIMEOUT_MS - elapsedMs) / 1000));

        return { votes, votedControllerIds, playerVotes, totalVoters, timeLeft, difficulty: state.selectedDifficulty };
    }

    isTopicSelectionStarted(roomId: string): boolean {
        return this.quizState.get(roomId)?.topicSelectionStarted ?? false;
    }

    setDifficulty(roomId: string, clientId: string, difficulty: QuizDifficulty): boolean {
        const state = this.quizState.get(roomId);
        const room = this.roomManager.getRoom(roomId);
        if (!state || !room) return false;

        const controller = room.controllers.find(c => c.clientId === clientId);
        if (!controller || controller.role !== 'leader') return false;

        state.selectedDifficulty = difficulty;
        console.log(`[ShootQuiz] Difficulty set to "${difficulty}" in ${roomId}`);
        return true;
    }

    // ---- Game start (after topic selected) ----

    async finalizeTopicSelection(roomId: string, topicId: QuizTopicId, difficulty: QuizDifficulty = 'medium'): Promise<void> {
        const room = this.roomManager.getRoom(roomId);
        if (!room) return;

        const topicLabel = QUIZ_TOPICS.find(t => t.id === topicId)?.label || topicId;
        console.log(`[ShootQuiz] Topic selected in ${roomId}: ${topicId} (${topicLabel}), difficulty: ${difficulty}`);

        const topicSelectedPayload = { topicId, topicLabel, difficulty };
        broadcastAll(room, EVENTS.TOPIC_SELECTED, topicSelectedPayload);

        await this.startGameAfterTopicSelection(roomId, topicId, difficulty);
    }

    private async startGameAfterTopicSelection(roomId: string, topicId: QuizTopicId, difficulty: QuizDifficulty = 'medium'): Promise<void> {
        const room = this.roomManager.getRoom(roomId);
        if (!room) return;

        // Track live topic/difficulty for admin monitoring
        room.currentTopic = topicId;
        room.currentDifficulty = difficulty;

        const quizEngine = asQuizEngine(room);
        if (!quizEngine) {
            console.error(`[ShootQuiz] Room ${roomId} is not running a quiz game`);
            return;
        }

        const playerCount = room.controllers.filter(c => !c.disconnected).length;

        broadcastAll(room, EVENTS.LOADING_START, { playerCount });

        try {
            quizEngine.reset(true);
            await quizEngine.initialize(topicId, difficulty);
            console.log(`[ShootQuiz] Quiz engine initialized with ${quizEngine.getTotalQuestions()} questions for room ${roomId}`);
        } catch (error) {
            console.error(`[ShootQuiz] Failed to initialize quiz engine:`, error);
        }

        broadcastAll(room, EVENTS.LOADING_COUNTDOWN, { duration: 3 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const modeChanged = quizEngine.setPlayerCount(playerCount);
        if (modeChanged) {
            console.log(`[ShootQuiz] Game mode changed — resetting player scores`);
            this.roomManager.resetPlayerScores(roomId);
        }

        const question = quizEngine.getCurrentQuestion();

        if (playerCount >= 2) {
            quizEngine.setPhaseCallbacks(
                (phase, timeLeft, questionNumber) => {
                    const phasePayload = { phase, timeLeft, questionNumber };
                    broadcastAll(room, EVENTS.PHASE_CHANGE, phasePayload);

                    if (phase === 'analysis' && timeLeft === PHASE_DURATIONS.analysis && questionNumber > 1) {
                        const nextQ = quizEngine.getBufferedQuestion();
                        if (nextQ) broadcastAll(room, EVENTS.QUESTION, nextQ);
                    }
                },
                (result: RevealResultPayload) => {
                    if (result.playerScores) {
                        for (const ps of result.playerScores) {
                            if (ps.correct && ps.score > 0) {
                                this.roomManager.addPlayerScore(roomId, ps.controllerId, ps.score);
                            }
                        }
                    }
                    broadcastAll(room, EVENTS.REVEAL_RESULT, result);
                    broadcastAll(room, EVENTS.SCORE_UPDATE, { playerScores: this.roomManager.getPlayerScores(roomId) });
                },
                () => {
                    const questionsAnswered = quizEngine.getSessionQuestionsAnswered();
                    const playerScores = this.roomManager.getPlayerScores(roomId);
                    PlayerManager.saveTopPlayer(roomId, playerScores);
                    const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                    const reason = quizEngine.getLastGameOverReason();
                    broadcastAll(room, EVENTS.GAME_OVER, { leaderboard, reason, questionsAnswered, playerScores });
                    this.roomManager.clearDisconnectedScores(roomId);
                    // Mark that game-over has been broadcast — used by LEAVE_GAME
                    // and disconnect to destroy the room when all players leave the winner screen.
                    room.gameOverBroadcasted = true;
                    // Record game session for analytics
                    for (const ps of playerScores) {
                        teamRepo.saveGameSession(roomId, 0, ps.score, questionsAnswered,
                            quizEngine.getTopic() ?? '', quizEngine.getDifficulty());
                    }
                },
            );

            broadcastAll(room, EVENTS.GAME_STARTED, { question, timeLeft: 20 });
            quizEngine.startPhaseTimer();
        } else {
            quizEngine.setCallbacks(
                (timeLeft: number) => {
                    broadcastAll(room, EVENTS.TIMER_SYNC, { timeLeft });
                },
                () => {
                    const questionsAnswered = quizEngine.getSessionQuestionsAnswered();
                    const playerScores = this.roomManager.getPlayerScores(roomId);
                    PlayerManager.saveTopPlayer(roomId, playerScores);
                    const leaderboard = PlayerManager.getPlayerLeaderboard(5);
                    broadcastAll(room, EVENTS.GAME_OVER, {
                        leaderboard,
                        reason: quizEngine.getLastGameOverReason(),
                        questionsAnswered,
                        playerScores,
                    });
                    this.roomManager.clearDisconnectedScores(roomId);
                    room.gameOverBroadcasted = true;
                    for (const ps of playerScores) {
                        teamRepo.saveGameSession(roomId, 0, ps.score, questionsAnswered,
                            quizEngine.getTopic() ?? '', quizEngine.getDifficulty());
                    }
                },
            );

            quizEngine.startTimer();
            broadcastAll(room, EVENTS.GAME_STARTED, { question, timeLeft: quizEngine.getTimeLeft() });
        }
    }

    // ---- Register Geckos.io event handlers ----

    registerHandlers(io: GeckosServer): void {
        io.onConnection((channel: ServerChannel) => {
            // ---- START_GAME → topic selection ----
            channel.on(EVENTS.START_GAME, async () => {
                const { roomId, clientId } = channel.userData || {};
                if (!roomId || !clientId) return;

                const started = this.roomManager.startGame(roomId, clientId);
                if (!started) return;

                const room = this.roomManager.getRoom(roomId);
                if (!room) return;

                // Ensure quiz state exists for this room
                this.initRoom(roomId);

                const topicUpdate = this.startTopicSelection(roomId);
                if (!topicUpdate) return;

                const state = this.getState(roomId)!;

                const topicOrbs = QUIZ_TOPICS.map((t, i) => ({
                    id: t.id,
                    label: t.label,
                    emoji: t.emoji,
                    x: 10 + i * 20,
                    y: 50,
                }));

                const votePayload = {
                    ...topicUpdate,
                    topics: topicOrbs,
                };

                broadcastAll(room, EVENTS.TOPIC_VOTE_UPDATE, votePayload);

                // Countdown broadcast every second
                state.topicCountdownInterval = setInterval(() => {
                    const currentRoom = this.roomManager.getRoom(roomId);
                    const currentUpdate = currentRoom ? this.getTopicVoteUpdate(roomId) : null;
                    if (!currentUpdate || currentUpdate.timeLeft <= 0) {
                        const s = this.quizState.get(roomId);
                        if (s?.topicCountdownInterval) {
                            clearInterval(s.topicCountdownInterval);
                            s.topicCountdownInterval = undefined;
                        }
                        return;
                    }
                    if (!currentRoom?.screenDisconnected) {
                        currentRoom?.screenChannel.emit(EVENTS.TOPIC_VOTE_UPDATE, {
                            ...currentUpdate,
                            topics: topicOrbs,
                        });
                    }
                }, 1000);

                // Override the timeout to finalize
                if (state.topicSelectionTimer) clearTimeout(state.topicSelectionTimer);
                state.topicSelectionTimer = setTimeout(() => {
                    const result = this.resolveTopicVote(roomId);
                    this.finalizeTopicSelection(roomId, result.topicId, result.difficulty);
                }, TOPIC_SELECTION_TIMEOUT_MS);
            });

            // ---- TOPIC_VOTE ----
            channel.on(EVENTS.TOPIC_VOTE, (data: { topicId: QuizTopicId }) => {
                const { roomId, clientId } = channel.userData || {};
                if (!roomId || !clientId) return;

                const result = this.castTopicVote(roomId, clientId, data.topicId);
                const room = this.roomManager.getRoom(roomId);
                if (!room) return;

                if (result.update) {
                    const topicOrbs = QUIZ_TOPICS.map((t, i) => ({
                        id: t.id, label: t.label, emoji: t.emoji, x: 10 + i * 20, y: 50,
                    }));
                    broadcastAll(room, EVENTS.TOPIC_VOTE_UPDATE, { ...result.update, topics: topicOrbs });
                }

                if (result.resolved) {
                    this.finalizeTopicSelection(roomId, result.resolved.topicId, result.resolved.difficulty);
                }
            });

            // ---- SET_DIFFICULTY ----
            channel.on(EVENTS.SET_DIFFICULTY, (data: { difficulty: QuizDifficulty }) => {
                const { roomId, clientId } = channel.userData || {};
                if (!roomId || !clientId) return;

                const accepted = this.setDifficulty(roomId, clientId, data.difficulty);
                if (!accepted) return;

                const update = this.getTopicVoteUpdate(roomId);
                const room = this.roomManager.getRoom(roomId);
                if (update && room) {
                    const topicOrbs = QUIZ_TOPICS.map((t, i) => ({
                        id: t.id, label: t.label, emoji: t.emoji, x: 10 + i * 20, y: 50,
                    }));
                    broadcastAll(room, EVENTS.TOPIC_VOTE_UPDATE, { ...update, topics: topicOrbs });
                }
            });

            // ---- SHOOT ----
            channel.on(EVENTS.SHOOT, (data: { targetXPercent: number; targetYPercent: number; power: number }) => {
                const { roomId, clientId } = channel.userData || {};
                const room = this.roomManager.getRoom(roomId);
                if (!room || !room.gameStarted) return;

                const controller = room.controllers.find(c => c.clientId === clientId);
                if (controller?.isSpectating) return;

                if (
                    !isFinite(data.targetXPercent) || !isFinite(data.targetYPercent) ||
                    data.targetXPercent < 0 || data.targetXPercent > 100 ||
                    data.targetYPercent < 0 || data.targetYPercent > 100
                ) {
                    console.warn(`[ShootQuiz] Invalid SHOOT coords from ${clientId?.substring(0, 8)}:`, data);
                    return;
                }

                const hitOrb = detectOrbHit(data.targetXPercent, data.targetYPercent);
                room.lastActivity = Date.now();

                const quizEngine = asQuizEngine(room);
                if (!quizEngine) return;

                if (quizEngine.isMultiplayer()) {
                    if (quizEngine.getCurrentPhase() !== 'selection') return;
                    if (!hitOrb) return;

                    const ctrl = room.controllers.find(c => c.clientId === clientId);
                    if (!ctrl) return;

                    const accepted = quizEngine.recordSelection(clientId!, hitOrb, ctrl.colorIndex);
                    if (!accepted) return;

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
                        colorIndex: ctrl.colorIndex,
                    };
                    broadcastAll(room, EVENTS.PLAYER_SELECTION, selectionPayload);
                } else {
                    room.screenChannel.emit(EVENTS.PROJECTILE, {
                        controllerId: channel.id,
                        targetXPercent: data.targetXPercent,
                        targetYPercent: data.targetYPercent,
                    });

                    if (hitOrb) {
                        const result = quizEngine.validateAnswer(hitOrb);

                        if (result.correct && clientId) {
                            this.roomManager.addPlayerScore(roomId, clientId, result.points);
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

                        broadcastAll(room, EVENTS.SCORE_UPDATE, { playerScores: this.roomManager.getPlayerScores(roomId) });

                        quizEngine.resetTimer();

                        setTimeout(async () => {
                            const nextQ = await quizEngine.nextQuestion();
                            if (nextQ) broadcastAll(room, EVENTS.QUESTION, nextQ);
                        }, 800);
                    }
                }
            });

            // ---- LEAVE_GAME ----
            channel.on(EVENTS.LEAVE_GAME, () => {
                const { roomId, clientId } = channel.userData || {};
                if (!roomId || !clientId) return;

                const room = this.roomManager.getRoom(roomId);
                if (!room) return;

                this.roomManager.leaveGame(roomId, clientId);
                room.screenChannel.emit(EVENTS.CONTROLLER_LEFT, { controllerId: clientId });

                if (!this.roomManager.hasActivePlayers(roomId)) {
                    // If game-over was already broadcast (winner screen), destroy the room
                    // immediately instead of returning to lobby.
                    if (room.gameOverBroadcasted) {
                        console.log(`[ShootQuiz] No active players on winner screen in ${roomId} — destroying room`);
                        room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' });
                        this.roomManager.deleteRoomById(roomId);
                        return;
                    }
                    console.log(`[ShootQuiz] No active players left in ${roomId}, returning to lobby`);
                    this.roomManager.forceEndGame(roomId);

                    // After forceEndGame, if nobody is still connected, destroy the
                    // room so the screen refreshes to a fresh landing page.
                    const anyoneConnected = room.controllers.some(c => c.channel);
                    if (!anyoneConnected) {
                        console.log(`[ShootQuiz] No connected controllers after force-end in ${roomId} — destroying room`);
                        try { room.screenChannel.emit(EVENTS.ROOM_EXPIRED, { reason: 'empty_lobby' }); } catch { /* ignore */ }
                        this.roomManager.deleteRoomById(roomId);
                        return;
                    }

                    broadcastAll(room, EVENTS.GAME_RESTARTED, {});
                } else {
                    const quizEngine = asQuizEngine(room);
                    if (quizEngine?.isMultiplayer()) {
                        const activePlayers = room.controllers.filter(c => !c.isSpectating && !c.disconnected);
                        quizEngine.updateActivePlayerCount(activePlayers.length);
                    }
                }

                this.roomManager.broadcastLobbyUpdate(roomId);
            });

            // ---- RESTART_GAME ----
            channel.on(EVENTS.RESTART_GAME, () => {
                const { roomId, clientId } = channel.userData || {};
                const room = this.roomManager.getRoom(roomId);
                if (!room) return;

                const ctrl = room.controllers.find(c => c.clientId === clientId);
                if (!ctrl || ctrl.role !== 'leader') return;

                room.engine.reset();
                room.gameStarted = false;
                room.gameOverBroadcasted = false;
                room.lastActivity = Date.now();
                this.roomManager.resetSpectatingStatus(roomId);

                for (const c of room.controllers) c.isReady = true;
                this.roomManager.clearDisconnectedScores(roomId);

                broadcastAll(room, EVENTS.GAME_RESTARTED, {});
                this.roomManager.broadcastLobbyUpdate(roomId);
            });

            // ---- Crosshair / aiming relay ----

            channel.on(EVENTS.CROSSHAIR, (data: { x: number; y: number }) => {
                const { roomId, clientId } = channel.userData || {};
                const room = this.roomManager.getRoom(roomId);
                if (!room?.screenChannel || !clientId) return;

                if (!this.isTopicSelectionStarted(roomId)) {
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
                const room = this.roomManager.getRoom(roomId);
                if (!room?.screenChannel || !clientId) return;

                if (!this.isTopicSelectionStarted(roomId)) {
                    const qe = asQuizEngine(room);
                    if (qe?.isMultiplayer() && qe.getCurrentPhase() !== 'selection') return;
                }

                room.screenChannel.emit(EVENTS.START_AIMING, { controllerId: clientId, gyroEnabled: false });
            });

            channel.on(EVENTS.CANCEL_AIMING, () => {
                const { roomId, clientId } = channel.userData || {};
                const room = this.roomManager.getRoom(roomId);
                if (room?.screenChannel && clientId) {
                    room.screenChannel.emit(EVENTS.CANCEL_AIMING, { controllerId: clientId });
                }
            });

            channel.on(EVENTS.TARGETING, (data: { orbId: string | null }) => {
                const { roomId, clientId } = channel.userData || {};
                const room = this.roomManager.getRoom(roomId);
                if (room?.screenChannel && clientId) {
                    room.screenChannel.emit(EVENTS.TARGETING, { controllerId: clientId, ...data });
                }
            });
        });
    }
}


