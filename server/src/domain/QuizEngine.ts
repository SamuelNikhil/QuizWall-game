// ==========================================
// Quiz Engine — Domain Layer
// Server-authoritative game logic
// Supports Gemini AI + JSON fallback
// ==========================================

import { getSessionQuestions, clearSessionQuestions, getAllQuestions } from '../data/questionRepository.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion, ClientQuestion } from '../shared/types.ts';

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
    private usedQuestionTexts: Set<string> = new Set(); // Track used question TEXTS to avoid repetition (more reliable than IDs)
    private sessionQuestionLimit: number; // Fixed limit of 10 questions per session
    private readonly MAX_QUESTIONS = 10; // Maximum questions per session
    private allQuestionsCompleted: boolean = false; // Track if all questions have been answered

    // Callbacks
    private onTimerTick?: (timeLeft: number) => void;
    private onGameOver?: () => void;

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

    /** Set callbacks for timer events */
    setCallbacks(onTimerTick: (timeLeft: number) => void, onGameOver: () => void): void {
        this.onTimerTick = onTimerTick;
        this.onGameOver = onGameOver;
    }

    /**
     * Set the number of players to adjust timer duration
     * 1 player = 30 seconds, 2-3 players = 15 seconds
     */
    setPlayerCount(count: number): void {
        this.playerCount = Math.max(1, Math.min(3, count));
        console.log(`[QuizEngine] Player count set to ${this.playerCount}, timer will be ${this.getTimerDuration()}s`);
    }

    /**
     * Get timer duration based on player count
     * 1 player = 30 seconds, 2-3 players = 15 seconds
     */
    private getTimerDuration(): number {
        return this.playerCount === 1 ? 30 : 15;
    }

    /** Start the game timer */
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

    /** Reset the timer for the next question (called on correct answer) */
    resetTimer(): void {
        this.timeLeft = this.getTimerDuration();
        console.log(`[QuizEngine] Timer reset to ${this.timeLeft}s for next question`);
    }

    /** Stop the timer */
    stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /** Reset for a new game (keeps same questions, reshuffles, clears used, preserves session totals) */
    reset(): void {
        this.stopTimer();
        this.timeLeft = CONFIG.TIMER_DURATION;
        this.currentIndex = 0;
        this.questionsAnswered = 0; // Reset round counter only
        // NOTE: sessionQuestionsAnswered is NOT reset - it accumulates across restarts
        this.allQuestionsCompleted = false; // Reset completion flag for new game
        this.usedQuestionTexts.clear(); // Clear used questions for new game
        this.shuffleQuestions();
    }

    /** Get current question for client (without correct answer) */
    getCurrentQuestion(): ClientQuestion | null {
        // Filter out used questions by TEXT (not ID, since AI might generate similar questions)
        const availableQuestions = this.questions.filter(q => !this.usedQuestionTexts.has(q.text.trim().toLowerCase()));
        
        // If no available questions, we need to generate more or reset
        if (availableQuestions.length === 0) {
            console.log('[QuizEngine] All questions used! Triggering background generation...');
            // Don't reset - this means we truly ran out and need more AI questions
            // Return null to signal we need more questions
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

    /** Validate an answer. Returns { correct, points, orbId } */
    validateAnswer(orbId: string): { correct: boolean; points: number } {
        // Find the most recently used question (current question being asked)
        // We track by the last added text in usedQuestionTexts
        let currentQuestion: ServerQuestion | undefined;
        
        if (this.usedQuestionTexts.size > 0) {
            // Get all used texts and find the last one added
            const usedTextsArray = Array.from(this.usedQuestionTexts);
            const lastUsedText = usedTextsArray[usedTextsArray.length - 1];
            
            // Find the question with this text
            currentQuestion = this.questions.find(q => 
                q.text.trim().toLowerCase() === lastUsedText
            );
        }
        
        // If no current question found, try to find one that hasn't been used
        if (!currentQuestion) {
            const availableQuestions = this.questions.filter(q => 
                !this.usedQuestionTexts.has(q.text.trim().toLowerCase())
            );
            if (availableQuestions.length > 0) {
                currentQuestion = availableQuestions[0];
            }
        }
        
        if (!currentQuestion) return { correct: false, points: 0 };

        const isCorrect = orbId === currentQuestion.correct;
        const points = isCorrect ? 100 : 0;

        if (isCorrect) {
            this.questionsAnswered++;
            this.sessionQuestionsAnswered++; // Track total across restarts
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

    /** Get current time left */
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
        // Clear session questions to free memory
        clearSessionQuestions(this.sessionId);
        console.log(`[QuizEngine] Destroyed and cleared session: ${this.sessionId}`);
    }
}
