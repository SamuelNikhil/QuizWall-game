// ==========================================
// Quiz Engine — Domain Layer
// Server-authoritative game logic
// Supports Groq AI + JSON fallback
// Phase-based multiplayer timer system
// Implements GameEngine interface
// ==========================================

import { getSessionQuestions, clearSessionQuestions, generateSessionQuestions, getAllQuestions } from '../data/questionRepository.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion, ClientQuestion, QuestionPhase, PlayerSelectionPayload, RevealResultPayload, QuizTopicId, QuizDifficulty } from '../shared/types.ts';
import type { GameEngine } from './GameEngine.ts';

// Phase durations in seconds
const PHASE_DURATIONS: Record<QuestionPhase, number> = {
    analysis: 1,
    selection: 16,
    reveal: 3,
};

export class QuizEngine implements GameEngine {
    private sessionId: string;
    private questions: ServerQuestion[] = [];
    private currentIndex: number = 0;
    private timeLeft: number = CONFIG.TIMER_DURATION;
    private timerInterval: ReturnType<typeof setInterval> | null = null;
    private questionsAnswered: number = 0;
    private sessionQuestionsAnswered: number = 0;
    private initialized: boolean = false;
    private playerCount: number = 1;
    private usedQuestionTexts: Set<string> = new Set();
    private sessionQuestionLimit: number;
    private readonly MAX_QUESTIONS = 10;
    private allQuestionsCompleted: boolean = false;
    private lastGameOverReason: 'time' | 'completed' | 'all_wrong' = 'time';
    private totalQuestionsAttempted: number = 0;
    private destroyed: boolean = false;
    private selectedTopic: QuizTopicId | null = null;
    private selectedDifficulty: QuizDifficulty = 'easy';
    private isReset: boolean = false; // Guard against async callbacks after reset

    // Phase-based multiplayer fields
    private currentPhase: QuestionPhase = 'analysis';
    private phaseTimeLeft: number = 0;
    private phaseInterval: ReturnType<typeof setInterval> | null = null;
    private playerSelections: Map<string, PlayerSelectionPayload> = new Map(); // controllerId -> selection
    private questionNumberForUI: number = 0; // 1-indexed question counter for UI
    private selectionPhaseStartTime: number = 0; // Timestamp when selection phase started (for bonus scoring)

    // Singleplayer time-based scoring
    private questionStartTime: number = 0; // Timestamp when current question started (for bonus scoring)

    // Callbacks
    private onTimerTick?: (timeLeft: number) => void;
    private onGameOver?: () => void;
    // Phase-based callbacks
    private onPhaseChange?: (phase: QuestionPhase, timeLeft: number, questionNumber: number) => void;
    private onReveal?: (result: RevealResultPayload) => void;

    constructor(sessionId?: string) {
        // Generate unique session ID if not provided
        this.sessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        // Initialize session limit - capped at 10 questions
        this.sessionQuestionLimit = Math.min(CONFIG.QUESTIONS_PER_SESSION || 10, this.MAX_QUESTIONS);
        console.log(`[QuizEngine] Created with sessionId: ${this.sessionId}, limit: ${this.sessionQuestionLimit} (capped at ${this.MAX_QUESTIONS})`);
    }

    /**
     * Initialize questions for this session
     * Must be called before the game starts
     * Uses Gemini if available, falls back to static JSON
     */
    async initialize(topic?: QuizTopicId, difficulty?: QuizDifficulty): Promise<void> {
        if (topic) {
            this.selectedTopic = topic;
        }
        if (difficulty) {
            this.selectedDifficulty = difficulty;
        }

        if (this.initialized) {
            // Defensive guard: if initialized but no questions loaded, treat as uninitialized
            if (this.questions.length === 0) {
                console.log(`[QuizEngine] initialized=true but no questions loaded — clearing flag and re-initializing`);
                this.initialized = false;
            } else {
                console.log(`[QuizEngine] Already initialized for session: ${this.sessionId} with topic: ${this.selectedTopic}, skipping re-init`);
                return;
            }
        }

        this.isReset = false;

        try {
            console.log(`[QuizEngine] Initializing session: ${this.sessionId}, topic: ${this.selectedTopic}, difficulty: ${this.selectedDifficulty}`);
            this.questions = await getSessionQuestions(this.sessionId, undefined, this.selectedTopic ?? undefined, this.selectedDifficulty);
            this.shuffleQuestions();
            this.initialized = true;
            console.log(`[QuizEngine] Initialized with ${this.questions.length} questions for session: ${this.sessionId}, topic: ${this.selectedTopic}`);
        } catch (error) {
            console.error(`[QuizEngine] Failed to load questions, using fallback:`, error);
            this.questions = getAllQuestions();
            this.shuffleQuestions();
            this.initialized = true;
        }
    }

    /**
     * Get the session ID for this quiz engine
     */
    getSessionId(): string {
        return this.sessionId;
    }

    setTopic(topic: QuizTopicId): void {
        this.selectedTopic = topic;
    }

    getTopic(): QuizTopicId | null {
        return this.selectedTopic;
    }

    setDifficulty(difficulty: QuizDifficulty): void {
        this.selectedDifficulty = difficulty;
    }

    getDifficulty(): QuizDifficulty {
        return this.selectedDifficulty;
    }

    /**
     * Check if questions are loaded and ready
     */
    isReady(): boolean {
        return this.initialized && this.questions.length > 0;
    }

    private shuffleQuestions(): void {
        for (let i = this.questions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
        }
    }

    /** Set callbacks for timer events (singleplayer) */
    setCallbacks(onTimerTick: (timeLeft: number) => void, onGameOver: () => void): void {
        this.onTimerTick = onTimerTick;
        this.onGameOver = onGameOver;
    }

    /** Set callbacks for phase-based events (multiplayer) */
    setPhaseCallbacks(
        onPhaseChange: (phase: QuestionPhase, timeLeft: number, questionNumber: number) => void,
        onReveal: (result: RevealResultPayload) => void,
        onGameOver: () => void,
    ): void {
        this.onPhaseChange = onPhaseChange;
        this.onReveal = onReveal;
        this.onGameOver = onGameOver;
    }

    /**
     * Set the number of players to adjust timer duration
     * 1 player = 20 seconds, 2-4 players = phase-based (20s total per question)
     */
    setPlayerCount(count: number): boolean {
        const previousCount = this.playerCount;
        this.playerCount = Math.max(1, Math.min(4, count));

        const modeChanged = (previousCount >= 2) !== (this.playerCount >= 2);

        if (this.isMultiplayer()) {
            console.log(`[QuizEngine] Player count set to ${this.playerCount}, using phase-based timer (20s/question)`);
        } else {
            console.log(`[QuizEngine] Player count set to ${this.playerCount}, timer will be 20s`);
        }

        return modeChanged;
    }

    /**
     * Update the active player count mid-game (e.g. when a player disconnects or
     * leaves during the selection phase). If all remaining active players have
     * already selected, this triggers an immediate early transition to reveal.
     */
    updateActivePlayerCount(count: number): void {
        const newCount = Math.max(1, count);
        if (newCount === this.playerCount) return;
        this.playerCount = newCount;
        console.log(`[QuizEngine] Active player count updated to ${this.playerCount}`);

        // If we're in the selection phase and everyone remaining has already selected,
        // advance immediately rather than waiting for the timer.
        if (this.currentPhase === 'selection' && this.playerSelections.size >= this.playerCount) {
            console.log(`[QuizEngine] All remaining ${this.playerCount} active players already selected — advancing to reveal early`);
            this.stopPhaseTimer();
            this.advancePhase();
        }
    }

    /** Check if game is in multiplayer mode */
    isMultiplayer(): boolean {
        return this.playerCount >= 2;
    }

    /** Get current phase (multiplayer only) */
    getCurrentPhase(): QuestionPhase {
        return this.currentPhase;
    }

    /**
     * Get timer duration based on player count (singleplayer only)
     */
    private getTimerDuration(): number {
        return 20; // Singleplayer 20 seconds
    }

    // ==========================================
    // SINGLEPLAYER TIMER (unchanged)
    // ==========================================

    /** Start the game timer (singleplayer) */
    startTimer(): void {
        this.isReset = false; // Clear reset flag when starting a new game
        if (!this.initialized) {
            console.error('[QuizEngine] Cannot start timer - not initialized');
            return;
        }

        // Set timer based on player count
        this.timeLeft = this.getTimerDuration();
        this.questionsAnswered = 0;
        this.totalQuestionsAttempted = 0;
        this.currentIndex = 0;
        this.shuffleQuestions();

        // Initialize question start time for bonus scoring
        this.questionStartTime = Date.now();

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        this.timerInterval = setInterval(() => {
            if (this.destroyed) return;
            this.timeLeft--;
            this.onTimerTick?.(this.timeLeft);

            if (this.timeLeft <= 0) {
                this.stopTimer();
                this.onGameOver?.();
            }
        }, CONFIG.TIMER_SYNC_INTERVAL);
    }

    /** Reset the timer for the next question (singleplayer, called on correct answer) */
    resetTimer(): void {
        this.timeLeft = this.getTimerDuration();
        this.questionStartTime = Date.now(); // Reset start time for bonus scoring
        console.log(`[QuizEngine] Timer reset to ${this.timeLeft}s for next question`);
    }

    /** Stop the timer (singleplayer) */
    stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // ==========================================
    // MULTIPLAYER PHASE TIMER
    // ==========================================

    /** Start the phase-based timer for multiplayer */
    startPhaseTimer(): void {
        this.isReset = false; // Clear reset flag when starting a new game
        if (!this.initialized) {
            console.error('[QuizEngine] Cannot start phase timer - not initialized');
            return;
        }

        this.questionsAnswered = 0;
        this.totalQuestionsAttempted = 0;
        this.currentIndex = 0;
        this.questionNumberForUI = 1;
        this.shuffleQuestions();

        // Start the first question's analysis phase
        this.beginPhase('analysis');
    }

    /** Begin a specific phase */
    private beginPhase(phase: QuestionPhase): void {
        this.currentPhase = phase;
        this.phaseTimeLeft = PHASE_DURATIONS[phase];

        // Only clear selections when starting a new question (analysis phase)
        if (phase === 'analysis') {
            this.playerSelections.clear();
        }

        // Track when selection phase starts for bonus scoring
        if (phase === 'selection') {
            this.selectionPhaseStartTime = Date.now();
        }

        console.log(`[QuizEngine] Phase: ${phase}, Time: ${this.phaseTimeLeft}s, Question: ${this.questionNumberForUI}`);

        // Notify clients of phase change
        this.onPhaseChange?.(phase, this.phaseTimeLeft, this.questionNumberForUI);

        // Clear any existing phase interval
        this.stopPhaseTimer();

        // Start the phase countdown
        this.phaseInterval = setInterval(() => {
            if (this.destroyed) { this.stopPhaseTimer(); return; }
            this.phaseTimeLeft--;

            // Send phase timer sync
            this.onPhaseChange?.(this.currentPhase, this.phaseTimeLeft, this.questionNumberForUI);

            if (this.phaseTimeLeft <= 0) {
                this.stopPhaseTimer();
                this.advancePhase();
            }
        }, 1000);
    }

    /** Advance to the next phase in the cycle */
    private advancePhase(): void {
        switch (this.currentPhase) {
            case 'analysis':
                this.beginPhase('selection');
                break;
            case 'selection':
                this.beginPhase('reveal');
                // Evaluate selections at the start of the reveal phase
                this.evaluateSelections();
                break;
            case 'reveal':
                // Reveal phase ended — handled by evaluateSelections callback
                // (next question or game over is triggered from there)
                break;
        }
    }

    /** Stop the phase timer */
    private stopPhaseTimer(): void {
        if (this.phaseInterval) {
            clearInterval(this.phaseInterval);
            this.phaseInterval = null;
        }
    }

    /** Record a player's selection during the Selection phase */
    recordSelection(controllerId: string, orbId: string, colorIndex: number): boolean {
        if (this.currentPhase !== 'selection') {
            console.log(`[QuizEngine] Rejected selection from ${controllerId} - not in selection phase (current: ${this.currentPhase})`);
            return false;
        }

        if (this.playerSelections.has(controllerId)) {
            console.log(`[QuizEngine] Rejected selection from ${controllerId} - already selected`);
            return false;
        }

        // Calculate time elapsed since selection phase started (in seconds)
        const selectionTime = (Date.now() - this.selectionPhaseStartTime) / 1000;
        this.playerSelections.set(controllerId, { controllerId, orbId, colorIndex, selectionTime });
        console.log(`[QuizEngine] Player ${controllerId.substring(0, 8)}... selected orb ${orbId} at ${selectionTime.toFixed(2)}s`);

        // Early phase transition: if all active players have now selected, skip the
        // remaining selection timer and move straight to the reveal phase.
        if (this.playerSelections.size >= this.playerCount) {
            console.log(`[QuizEngine] All ${this.playerCount} players selected — advancing to reveal early`);
            this.stopPhaseTimer();
            this.advancePhase();
        }

        return true;
    }

    /** Check if a player already selected this round */
    hasSelected(controllerId: string): boolean {
        return this.playerSelections.has(controllerId);
    }

    /** Evaluate all selections during the Reveal phase */
    private evaluateSelections(): void {
        // Find the current question's correct answer
        const currentQuestion = this.findCurrentQuestion();
        if (!currentQuestion) {
            console.error('[QuizEngine] No current question found during evaluate');
            return;
        }

        const correctOrbId = currentQuestion.correct;
        const selections = Array.from(this.playerSelections.values());
        const anyCorrect = selections.some(s => s.orbId === correctOrbId);
        const points = anyCorrect ? 50 : 0; // Base team score for correct answer

        // Track all questions attempted (correct + wrong)
        this.totalQuestionsAttempted++;

        if (anyCorrect) {
            this.questionsAnswered++;
            this.sessionQuestionsAnswered++;
        }

        // Calculate individual player scores for this round
        const playerScores = selections.map(s => {
            const isCorrect = s.orbId === correctOrbId;
            const baseScore = isCorrect ? 50 : 0;
            // Time bonus: faster answers get more points (+20 for <= 5s, +10 for <= 10s)
            const selectionTime = s.selectionTime ?? 16;
            const bonus = isCorrect ? (selectionTime <= 5 ? 20 : selectionTime <= 10 ? 10 : 0) : 0;
            return {
                controllerId: s.controllerId,
                colorIndex: s.colorIndex,
                score: baseScore + bonus,
                baseScore,
                bonus,
                correct: isCorrect,
            };
        });

        const result: RevealResultPayload = {
            correctOrbId,
            selections,
            anyCorrect,
            points,
            noSelection: selections.length === 0,
            playerScores,
        };

        console.log(`[QuizEngine] Reveal: correct=${correctOrbId}, selections=${selections.length}, anyCorrect=${anyCorrect}, attempted=${this.totalQuestionsAttempted}/${this.sessionQuestionLimit}`);

        // Notify clients of the reveal result
        this.onReveal?.(result);

        // If NO player selected anything, end the game immediately (Time's Up)
        if (selections.length === 0) {
            console.log('[QuizEngine] No selections made — triggering Time\'s Up game over');
            this.lastGameOverReason = 'time';
            this.stopPhaseTimer();
            // Small delay so clients see the reveal before game-over
            setTimeout(() => {
                if (this.destroyed || this.isReset) return;
                this.onGameOver?.();
            }, 1500);
            return;
        }

        // After reveal, decide next action
        // Always advance to next question regardless of correctness, until all 10 are done
        setTimeout(async () => {
            if (this.destroyed || this.isReset) return; // Guard against post-destroy execution

            // Check if all questions have been attempted (correct or wrong)
            if (this.totalQuestionsAttempted >= this.sessionQuestionLimit) {
                console.log(`[QuizEngine] All ${this.sessionQuestionLimit} questions attempted! (${this.questionsAnswered} correct)`);
                this.allQuestionsCompleted = true;
                this.lastGameOverReason = 'completed';
                this.stopPhaseTimer();
                this.onGameOver?.();
                return;
            }

            // Advance to next question
            this.questionNumberForUI++;
            const nextQ = await this.nextQuestion();
            if (this.isReset) return;
            if (!nextQ) {
                console.log('[QuizEngine] No more questions available');
                this.allQuestionsCompleted = true;
                this.lastGameOverReason = 'completed';
                this.stopPhaseTimer();
                if (!this.isReset) this.onGameOver?.();
                return;
            }

            // Start the analysis phase for the next question
            this.beginPhase('analysis');
        }, PHASE_DURATIONS.reveal * 1000); // Wait for reveal phase to finish
    }

    /** Find the current question (most recently used) */
    private findCurrentQuestion(): ServerQuestion | undefined {
        if (this.usedQuestionTexts.size > 0) {
            const usedTextsArray = Array.from(this.usedQuestionTexts);
            const lastUsedText = usedTextsArray[usedTextsArray.length - 1];
            return this.questions.find(q => q.text.trim().toLowerCase() === lastUsedText);
        }
        return undefined;
    }

    // ==========================================
    // SHARED METHODS (both modes)
    // ==========================================

    /** Get the last selected question as a ClientQuestion (no correct answer) */
    getLastSelectedQuestion(): ClientQuestion | null {
        const q = this.findCurrentQuestion();
        if (!q) return null;
        return { id: q.id, text: q.text, code: q.code, options: q.options };
    }

    /** Reset for a new game (keeps same questions, reshuffles, clears used, preserves session totals) */
    reset(silent: boolean = false): void {
        this.isReset = true; // Guard against pending timeouts

        if (silent) {
            // Drop callbacks to suppress GAME OVER broadcasts
            this.onGameOver = undefined;
            this.onPhaseChange = undefined;
            this.onReveal = undefined;
            this.onTimerTick = undefined;
        }

        this.stopTimer();
        this.stopPhaseTimer();
        this.timeLeft = CONFIG.TIMER_DURATION;
        this.currentIndex = 0;
        this.questionsAnswered = 0; // Reset round counter only
        this.totalQuestionsAttempted = 0; // Reset total attempted for new game
        // NOTE: sessionQuestionsAnswered is NOT reset - it accumulates across restarts
        this.allQuestionsCompleted = false; // Reset completion flag for new game
        this.usedQuestionTexts.clear(); // Clear used questions for new game
        this.playerSelections.clear();
        this.questionNumberForUI = 0;
        this.currentPhase = 'analysis';
        this.initialized = false;
        this.selectedTopic = null;
        this.selectedDifficulty = 'easy';
        this.shuffleQuestions();
    }

    /**
     * Reset AND regenerate fresh AI questions (for "Play Again")
     * Clears old session cache and generates entirely new questions from Groq
     */
    async resetAndRegenerate(): Promise<void> {
        // Clear old session questions from the cache
        clearSessionQuestions(this.sessionId);

        // Generate a new session ID to avoid stale cache hits
        this.sessionId = `${this.sessionId.split('-')[0]}-${Date.now()}`;

        console.log(`[QuizEngine] Regenerating questions for new session: ${this.sessionId}`);

        // Reset all game state
        this.stopTimer();
        this.stopPhaseTimer();
        this.timeLeft = CONFIG.TIMER_DURATION;
        this.currentIndex = 0;
        this.questionsAnswered = 0;
        this.totalQuestionsAttempted = 0;
        this.allQuestionsCompleted = false;
        this.usedQuestionTexts.clear();
        this.playerSelections.clear();
        this.questionNumberForUI = 0;
        this.currentPhase = 'analysis';
        this.destroyed = false; // Allow reuse after reset
        this.isReset = false; // Clear reset guard for next game

        // Generate fresh questions from AI
        try {
        this.questions = await generateSessionQuestions(this.sessionId, this.selectedTopic ?? undefined);
        this.shuffleQuestions();
        console.log(`[QuizEngine] Fresh questions loaded: ${this.questions.length}`);
        } catch (err) {
            console.error('[QuizEngine] Failed to regenerate questions, falling back to existing:', err);
            this.questions = await getSessionQuestions(this.sessionId, undefined, this.selectedTopic ?? undefined, this.selectedDifficulty);
            this.shuffleQuestions();
        }
    }

    /** Get current question for client (without correct answer) */
    getCurrentQuestion(): ClientQuestion | null {
        // Filter out used questions by TEXT (not ID, since AI might generate similar questions)
        const availableQuestions = this.questions.filter(q => !this.usedQuestionTexts.has(q.text.trim().toLowerCase()));

        // If no available questions, we need to generate more or reset
        if (availableQuestions.length === 0) {
            console.log('[QuizEngine] All questions used! Triggering background generation...');
            return null;
        }

        // Get the current question from available ones (pick randomly to ensure variety)
        const randomIndex = Math.floor(Math.random() * availableQuestions.length);
        const q = availableQuestions[randomIndex];
        if (!q) return null;

        // Mark as used by TEXT
        this.usedQuestionTexts.add(q.text.trim().toLowerCase());
        console.log(`[QuizEngine] Selected question: "${q.text.substring(0, 50)}..." | Used: ${this.usedQuestionTexts.size}/${this.questions.length}`);

        // Strip the `correct` field — client never sees it
        return {
            id: q.id,
            text: q.text,
            code: q.code,
            options: q.options,
        };
    }

    /** Validate an answer (singleplayer). Returns { correct, points, baseScore, bonus } */
    validateAnswer(orbId: string): { correct: boolean; points: number; baseScore: number; bonus: number } {
        const currentQuestion = this.findCurrentQuestion();

        // Calculate time elapsed since question started (for bonus scoring)
        const elapsedTime = (Date.now() - this.questionStartTime) / 1000; // in seconds

        if (!currentQuestion) {
            // Fallback: try to find an unused question
            const availableQuestions = this.questions.filter(q =>
                !this.usedQuestionTexts.has(q.text.trim().toLowerCase())
            );
            if (availableQuestions.length > 0) {
                const q = availableQuestions[0];
                const isCorrect = orbId === q.correct;
                let baseScore = 0;
                let bonus = 0;
                let points = 0;

                if (isCorrect) {
                    baseScore = 50;
                    // Time bonus: first 5 seconds = +20, next 5 seconds (5-10s) = +10
                    if (elapsedTime <= 5) {
                        bonus = 20;
                    } else if (elapsedTime <= 10) {
                        bonus = 10;
                    }
                    points = baseScore + bonus;
                    this.questionsAnswered++;
                    this.sessionQuestionsAnswered++;
                }
                return { correct: isCorrect, points, baseScore, bonus };
            }
            return { correct: false, points: 0, baseScore: 0, bonus: 0 };
        }

        const isCorrect = orbId === currentQuestion.correct;
        let baseScore = 0;
        let bonus = 0;
        let points = 0;

        if (isCorrect) {
            baseScore = 50;
            // Time bonus: first 5 seconds = +20, next 5 seconds (5-10s) = +10
            if (elapsedTime <= 5) {
                bonus = 20;
            } else if (elapsedTime <= 10) {
                bonus = 10;
            }
            points = baseScore + bonus;
        }

        // Track all questions attempted (both correct and wrong)
        this.totalQuestionsAttempted++;

        // Only increment correct answer count for score
        if (isCorrect) {
            this.questionsAnswered++;
            this.sessionQuestionsAnswered++;
        }

        if (this.isReset) return { correct: isCorrect, points, baseScore, bonus };

        console.log(`[QuizEngine] Singleplayer answer: correct=${isCorrect}, time=${elapsedTime.toFixed(2)}s, baseScore=${baseScore}, bonus=${bonus}, points=${points}`);
        return { correct: isCorrect, points, baseScore, bonus };
    }

    /** Advance to the next question. Returns the new question for client. */
    async nextQuestion(): Promise<ClientQuestion | null> {
        if (this.isReset) return null;
        this.currentIndex++;

        // Check if all questions have been attempted (10 questions max, regardless of correct/wrong)
        if (this.totalQuestionsAttempted >= this.sessionQuestionLimit) {
            console.log(`[QuizEngine] All ${this.sessionQuestionLimit} questions attempted! Triggering game over.`);
            this.allQuestionsCompleted = true;
            this.lastGameOverReason = 'completed';
            this.stopTimer();
            this.stopPhaseTimer();
            if (!this.isReset) this.onGameOver?.();
            return null;
        }

        // Check if we need more questions (less than 3 remaining)
        const availableCount = this.questions.filter(q => !this.usedQuestionTexts.has(q.text.trim().toLowerCase())).length;
        if (availableCount < 3) {
            console.log(`[QuizEngine] Running low on available questions (${availableCount} left), fetching more...`);

            // Refresh questions from session cache to get any newly generated ones
            try {
                const updatedQuestions = await getSessionQuestions(this.sessionId, undefined, this.selectedTopic ?? undefined, this.selectedDifficulty);
                if (updatedQuestions.length > this.questions.length) {
                    console.log(`[QuizEngine] Refreshed questions: ${this.questions.length} -> ${updatedQuestions.length}`);
                    this.questions = updatedQuestions;
                }
            } catch (error) {
                console.error('[QuizEngine] Failed to refresh questions:', error);
            }
        }

        return this.getCurrentQuestion();
    }

    /** Get the number of questions answered correctly (current round only) */
    getQuestionsAnswered(): number {
        return this.questionsAnswered;
    }

    /** Get total questions answered across all restarts in this session */
    getSessionQuestionsAnswered(): number {
        return this.sessionQuestionsAnswered;
    }

    /** Check if all questions were completed (vs time ran out) */
    isAllQuestionsCompleted(): boolean {
        return this.allQuestionsCompleted;
    }

    /** Get the reason for the last game over (multiplayer) */
    getLastGameOverReason(): 'time' | 'completed' | 'all_wrong' {
        return this.lastGameOverReason;
    }

    /** Get current time left (singleplayer) */
    getTimeLeft(): number {
        return this.timeLeft;
    }

    /** Get current phase time left (multiplayer) */
    getPhaseTimeLeft(): number {
        return this.phaseTimeLeft;
    }

    /** Get total questions available */
    getTotalQuestions(): number {
        return this.questions.length;
    }

    /** Get game-specific state for reconnecting clients */
    getResyncState(): Record<string, unknown> | undefined {
        if (!this.initialized) return undefined;
        const currentQuestion = this.getCurrentQuestion() ?? undefined;
        const phaseTimeLeft = this.getPhaseTimeLeft?.() ?? this.getTimeLeft?.() ?? undefined;
        return { currentQuestion, phaseTimeLeft };
    }

    /** Clean up and clear session questions */
    destroy(): void {
        this.destroyed = true;
        this.stopTimer();
        this.stopPhaseTimer();
        // Clear all callbacks to prevent memory leaks via closures
        this.onTimerTick = undefined;
        this.onGameOver = undefined;
        this.onPhaseChange = undefined;
        this.onReveal = undefined;
        // Clear session questions to free memory
        clearSessionQuestions(this.sessionId);
        console.log(`[QuizEngine] Destroyed and cleared session: ${this.sessionId}`);
    }
}
