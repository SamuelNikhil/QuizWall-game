// ==========================================
// GameEngine Interface — Domain Layer
// Base interface that all game engines must implement.
// Allows RoomManager to be fully game-agnostic.
// ==========================================

export interface GameEngine {
    /** Unique session ID for this game instance */
    getSessionId(): string;

    /** Initialize the game (load questions, setup state, etc.) */
    initialize(options?: unknown): Promise<void>;

    /** Check if the game is ready to start */
    isReady(): boolean;

    /** Reset the game state for a new round */
    reset(silent?: boolean): void;

    /** Clean up resources and timers */
    destroy(): void;

    /** Rounds/questions completed in the current game */
    getQuestionsAnswered(): number;

    /** Rounds/questions completed across all restarts in this session */
    getSessionQuestionsAnswered(): number;

    /** Total questions attempted (correct + wrong) across all restarts in this session */
    getTotalQuestionsAttempted(): number;

    /**
     * Optional: return game-specific state needed to resync a reconnecting client.
     * The returned object is spread into the RECONNECTED event payload.
     */
    getResyncState?(): Record<string, unknown> | undefined;
}

// ---- Game type registry ----

/** Union of all registered game type identifiers. Add new games here. */
export type GameType = 'shootquiz';

export interface GameEngineConstructor {
    new (sessionId?: string): GameEngine;
}
