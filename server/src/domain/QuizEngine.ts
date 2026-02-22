// ==========================================
// Quiz Engine — Domain Layer
// Server-authoritative game logic
// Supports Gemini AI + JSON fallback
// Phase-based multiplayer timer system
// ==========================================

import { getSessionQuestions, clearSessionQuestions, getAllQuestions } from '../data/questionRepository.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion, ClientQuestion, QuestionPhase, PlayerSelectionPayload, RevealResultPayload } from '../shared/types.ts';

// Phase durations in seconds
const PHASE_DURATIONS: Record<QuestionPhase, number> = {
    analysis: 10,
    selection: 7,
    reveal: 3,
};

export class QuizEngine {
    private sessionId: string;
    private questions: ServerQuestion[] = [];
    private currentIndex: number = 0;
    private timeLeft: number = CONFIG.TIMER_DURATION;
    private timerInterval: ReturnType<typeof setInterval> | null = null;
    private questionsAnswered: number = 0; // Questions answered in current round
    private sessionQuestionsAnswered: number = 0; // Accumulated across restarts
    private initialized: boolean = false;
    private playerCount: number = 1; // Track number of players for timer logic
    private usedQuestionTexts: Set<string> = new Set(); // Track used question TEXTS to avoid repetition
    private sessionQuestionLimit: number; // Fixed limit of 10 questions per session
    private readonly MAX_QUESTIONS = 10; // Maximum questions per session
    private allQuestionsCompleted: boolean = false; // Track if all questions have been answered
    private lastGameOverReason: 'time' | 'completed' | 'all_wrong' = 'time'; // Reason for game over

    // Phase-based multiplayer fields
    private currentPhase: QuestionPhase = 'analysis';
    private phaseTimeLeft: number = 0;
    private phaseInterval: ReturnType<typeof setInterval> | null = null;
    private playerSelections: Map<string, PlayerSelectionPayload> = new Map(); // controllerId -> selection
    private questionNumberForUI: number = 0; // 1-indexed question counter for UI

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
    async initialize(): Promise<void> {
        if (this.initialized) {
            console.log(`[QuizEngine] Already initialized for session: ${this.sessionId}`);
            return;
        }

        try {
            this.questions = await getSessionQuestions(this.sessionId);
            this.shuffleQuestions();
            this.initialized = true;
            console.log(`[QuizEngine] Initialized with ${this.questions.length} questions for session: ${this.sessionId}`);
        } catch (error) {
            console.error(`[QuizEngine] Failed to load questions, using fallback:`, error);
            // Emergency fallback to static questions
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
     * 1 player = 30 seconds, 2-3 players = phase-based (20s total per question)
     */
    setPlayerCount(count: number): void {
        this.playerCount = Math.max(1, Math.min(3, count));
        if (this.isMultiplayer()) {
            console.log(`[QuizEngine] Player count set to ${this.playerCount}, using phase-based timer (20s/question)`);
        } else {
            console.log(`[QuizEngine] Player count set to ${this.playerCount}, timer will be 30s`);
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
        return 30; // Singleplayer always 30s
    }

    // ==========================================
    // SINGLEPLAYER TIMER (unchanged)
    // ==========================================

    /** Start the game timer (singleplayer) */
    startTimer(): void {
        if (!this.initialized) {
            console.error('[QuizEngine] Cannot start timer - not initialized');
            return;
        }

        // Set timer based on player count
        this.timeLeft = this.getTimerDuration();
        this.questionsAnswered = 0;
        this.currentIndex = 0;
        this.shuffleQuestions();

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        this.timerInterval = setInterval(() => {
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
        if (!this.initialized) {
            console.error('[QuizEngine] Cannot start phase timer - not initialized');
            return;
        }

        this.questionsAnswered = 0;
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

        console.log(`[QuizEngine] Phase: ${phase}, Time: ${this.phaseTimeLeft}s, Question: ${this.questionNumberForUI}`);

        // Notify clients of phase change
        this.onPhaseChange?.(phase, this.phaseTimeLeft, this.questionNumberForUI);

        // Clear any existing phase interval
        this.stopPhaseTimer();

        // Start the phase countdown
        this.phaseInterval = setInterval(() => {
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

        this.playerSelections.set(controllerId, { controllerId, orbId, colorIndex });
        console.log(`[QuizEngine] Player ${controllerId.substring(0, 8)}... selected orb ${orbId}`);
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
        const points = anyCorrect ? 100 : 0;

        if (anyCorrect) {
            this.questionsAnswered++;
            this.sessionQuestionsAnswered++;
        }

        const result: RevealResultPayload = {
            correctOrbId,
            selections,
            anyCorrect,
            points,
        };

        console.log(`[QuizEngine] Reveal: correct=${correctOrbId}, selections=${selections.length}, anyCorrect=${anyCorrect}`);

        // Notify clients of the reveal result
        this.onReveal?.(result);

        // After reveal (1 second), decide next action
        // The reveal timer is already running. When it ends (advancePhase 'reveal' case),
        // we need to transition. So we schedule the next action for after the reveal phase.
        setTimeout(async () => {
            if (!anyCorrect) {
                // All wrong — game over
                console.log('[QuizEngine] All answers wrong — game over');
                this.allQuestionsCompleted = false;
                this.lastGameOverReason = 'all_wrong';
                this.stopPhaseTimer();
                this.onGameOver?.();
                return;
            }

            // Check if all questions completed
            if (this.questionsAnswered >= this.sessionQuestionLimit) {
                console.log(`[QuizEngine] All ${this.sessionQuestionLimit} questions completed!`);
                this.allQuestionsCompleted = true;
                this.lastGameOverReason = 'completed';
                this.stopPhaseTimer();
                this.onGameOver?.();
                return;
            }

            // Advance to next question
            this.questionNumberForUI++;
            const nextQ = await this.nextQuestion();
            if (!nextQ) {
                console.log('[QuizEngine] No more questions available');
                this.allQuestionsCompleted = true;
                this.lastGameOverReason = 'completed';
                this.stopPhaseTimer();
                this.onGameOver?.();
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
    reset(): void {
        this.stopTimer();
        this.stopPhaseTimer();
        this.timeLeft = CONFIG.TIMER_DURATION;
        this.currentIndex = 0;
        this.questionsAnswered = 0; // Reset round counter only
        // NOTE: sessionQuestionsAnswered is NOT reset - it accumulates across restarts
        this.allQuestionsCompleted = false; // Reset completion flag for new game
        this.usedQuestionTexts.clear(); // Clear used questions for new game
        this.playerSelections.clear();
        this.questionNumberForUI = 0;
        this.currentPhase = 'analysis';
        this.shuffleQuestions();
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

    /** Validate an answer (singleplayer). Returns { correct, points } */
    validateAnswer(orbId: string): { correct: boolean; points: number } {
        const currentQuestion = this.findCurrentQuestion();

        if (!currentQuestion) {
            // Fallback: try to find an unused question
            const availableQuestions = this.questions.filter(q =>
                !this.usedQuestionTexts.has(q.text.trim().toLowerCase())
            );
            if (availableQuestions.length > 0) {
                const q = availableQuestions[0];
                const isCorrect = orbId === q.correct;
                const points = isCorrect ? 100 : 0;
                if (isCorrect) {
                    this.questionsAnswered++;
                    this.sessionQuestionsAnswered++;
                }
                return { correct: isCorrect, points };
            }
            return { correct: false, points: 0 };
        }

        const isCorrect = orbId === currentQuestion.correct;
        const points = isCorrect ? 100 : 0;

        if (isCorrect) {
            this.questionsAnswered++;
            this.sessionQuestionsAnswered++;
        }

        return { correct: isCorrect, points };
    }

    /** Advance to the next question. Returns the new question for client. */
    async nextQuestion(): Promise<ClientQuestion | null> {
        this.currentIndex++;

        // Check if all questions have been answered
        if (this.questionsAnswered >= this.sessionQuestionLimit) {
            console.log(`[QuizEngine] All ${this.sessionQuestionLimit} questions completed! Triggering game over.`);
            this.allQuestionsCompleted = true;
            this.stopTimer();
            this.stopPhaseTimer();
            this.onGameOver?.();
            return null;
        }

        // Check if we need more questions (less than 3 remaining)
        const availableCount = this.questions.filter(q => !this.usedQuestionTexts.has(q.text.trim().toLowerCase())).length;
        if (availableCount < 3) {
            console.log(`[QuizEngine] Running low on available questions (${availableCount} left), fetching more...`);

            // Refresh questions from session cache to get any newly generated ones
            try {
                const updatedQuestions = await getSessionQuestions(this.sessionId);
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

    /** Get total questions available */
    getTotalQuestions(): number {
        return this.questions.length;
    }

    /** Clean up and clear session questions */
    destroy(): void {
        this.stopTimer();
        this.stopPhaseTimer();
        // Clear session questions to free memory
        clearSessionQuestions(this.sessionId);
        console.log(`[QuizEngine] Destroyed and cleared session: ${this.sessionId}`);
    }
}
