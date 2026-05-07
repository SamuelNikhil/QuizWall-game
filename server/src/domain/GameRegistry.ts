// ==========================================
// Game Registry — Domain Layer
// Maps gameType strings to their engine constructors
// Add new games here as plugins
// ==========================================

import type { GameEngine, GameType, GameEngineConstructor } from './GameEngine.ts';
import { QuizEngine } from './QuizEngine.ts';

const registry = new Map<GameType, GameEngineConstructor>();

// Register built-in games
registry.set('shootquiz', QuizEngine);

/**
 * Register a new game engine.
 * Call this from your game plugin before creating any rooms.
 *
 * @example
 * registerGame('wordrace', WordRaceEngine);
 */
export function registerGame(type: GameType, ctor: GameEngineConstructor): void {
    registry.set(type, ctor);
    console.log(`[GameRegistry] Registered game: ${type}`);
}

/**
 * Create a new game engine instance for the given type.
 * Throws if the game type is not registered.
 */
export function createGameEngine(type: GameType, sessionId: string): GameEngine {
    const Ctor = registry.get(type);
    if (!Ctor) {
        throw new Error(`[GameRegistry] Unknown game type: "${type}". Did you forget to call registerGame()?`);
    }
    return new Ctor(sessionId);
}

/** Check if a game type is registered */
export function isGameRegistered(type: string): type is GameType {
    return registry.has(type as GameType);
}

/** Get all registered game types */
export function getRegisteredGames(): GameType[] {
    return Array.from(registry.keys());
}
