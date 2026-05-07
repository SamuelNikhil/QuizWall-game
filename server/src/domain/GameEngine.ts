// ==========================================
// GameEngine Interface — Domain Layer
// Base interface that all game engines must implement
// Allows RoomManager to be game-agnostic
// ==========================================

export interface GameEngine {
    /** Get the unique session ID for this game instance */
    getSessionId(): string;

    /** Initialize the game (load questions, setup state, etc.) */
    initialize(options?: unknown): Promise<void>;

    /** Check if the game is ready to start */
    isReady(): boolean;

    /** Reset the game state for a new round */
    reset(silent?: boolean): void;

    /** Clean up resources and timers */
    destroy(): void;

    /** Get the number of questions/rounds completed in current game */
    getQuestionsAnswered(): number;

    /** Get total questions/rounds completed across all restarts in this session */
    getSessionQuestionsAnswered(): number;

    /**
     * Optional: return game-specific state needed to resync a reconnecting client.
     * The returned object is passed through to the client as-is.
     * Games that don't need resync can omit this.
     */
    getResyncState?(): Record<string, unknown> | undefined;
}

export type GameType = 'shootquiz';

export interface GameEngineConstructor {
    new (sessionId?: string): GameEngine;
}
