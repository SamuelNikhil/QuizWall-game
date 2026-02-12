// ==========================================
// Quiz Engine — Domain Layer
// Server-authoritative game logic
// ==========================================

import { getAllQuestions } from '../data/questionRepository.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion, ClientQuestion } from '../shared/types.ts';

export class QuizEngine {
    private questions: ServerQuestion[] = [];
    private currentIndex: number = 0;
    private timeLeft: number = CONFIG.TIMER_DURATION;
    private timerInterval: ReturnType<typeof setInterval> | null = null;
    private questionsAnswered: number = 0;

    // Callbacks
    private onTimerTick?: (timeLeft: number) => void;
    private onGameOver?: () => void;

    constructor() {
        this.questions = getAllQuestions();
        console.log(`[QuizEngine] Loaded ${this.questions.length} questions`);
        // Shuffle questions for each game
        this.shuffleQuestions();
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

    /** Start the game timer */
    startTimer(): void {
        this.timeLeft = CONFIG.TIMER_DURATION;
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

    /** Stop the timer */
    stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /** Reset for a new game */
    reset(): void {
        this.stopTimer();
        this.timeLeft = CONFIG.TIMER_DURATION;
        this.currentIndex = 0;
        this.questionsAnswered = 0;
        this.shuffleQuestions();
    }

    /** Get current question for client (without correct answer) */
    getCurrentQuestion(): ClientQuestion | null {
        const q = this.questions[this.currentIndex % this.questions.length];
        if (!q) return null;

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
        const q = this.questions[this.currentIndex % this.questions.length];
        if (!q) return { correct: false, points: 0 };

        const isCorrect = orbId === q.correct;
        const points = isCorrect ? 100 : 0;

        if (isCorrect) {
            this.questionsAnswered++;
        }

        return { correct: isCorrect, points };
    }

    /** Advance to the next question. Returns the new question for client. */
    nextQuestion(): ClientQuestion | null {
        this.currentIndex++;
        return this.getCurrentQuestion();
    }

    /** Get the number of questions answered correctly */
    getQuestionsAnswered(): number {
        return this.questionsAnswered;
    }

    /** Get current time left */
    getTimeLeft(): number {
        return this.timeLeft;
    }

    /** Clean up */
    destroy(): void {
        this.stopTimer();
    }
}
