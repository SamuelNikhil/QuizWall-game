// ==========================================
// Player Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import type { LeaderboardEntry } from '../shared/types.ts';

/** Get or create a player by client_id, returns player data */
export function getOrCreatePlayer(clientId: string, name: string): { id: number; clientId: string; name: string; highestScore: number; gamesPlayed: number } {
    const db = getDatabase();
    
    // 1. Try to find player by clientId (Device identity)
    let result = db.exec('SELECT id, client_id, name, highest_score, games_played FROM players WHERE client_id = ?', [clientId]);
    
    if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        return {
            id: row[0] as number,
            clientId: row[1] as string,
            name: row[2] as string,
            highestScore: row[3] as number,
            gamesPlayed: row[4] as number,
        };
    }
    
    // 2. Try to find by name (Name identity - prevents duplicates across devices)
    result = db.exec('SELECT id, client_id, name, highest_score, games_played FROM players WHERE name = ?', [name]);
    
    if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        console.log(`[DB] Found existing player by name: ${name} (previously linked to ${row[1] as string})`);
        return {
            id: row[0] as number,
            clientId: row[1] as string,
            name: row[2] as string,
            highestScore: row[3] as number,
            gamesPlayed: row[4] as number,
        };
    }
    
    // 3. Create new player
    db.run('INSERT INTO players (client_id, name) VALUES (?, ?)', [clientId, name]);
    
    const insertResult = db.exec('SELECT last_insert_rowid() as id');
    const id = insertResult[0].values[0][0] as number;
    
    saveDatabase();
    console.log(`[DB] Created new player record: ${name} (${clientId.substring(0, 8)}...)`);
    
    return {
        id,
        clientId,
        name,
        highestScore: 0,
        gamesPlayed: 0,
    };
}

/** Get player by client_id, returns null if not found */
export function getPlayerByClientId(clientId: string): { id: number; clientId: string; name: string; highestScore: number; gamesPlayed: number } | null {
    const db = getDatabase();
    const result = db.exec('SELECT id, client_id, name, highest_score, games_played FROM players WHERE client_id = ?', [clientId]);
    
    if (result.length === 0 || result[0].values.length === 0) return null;
    
    const row = result[0].values[0];
    return {
        id: row[0] as number,
        clientId: row[1] as string,
        name: row[2] as string,
        highestScore: row[3] as number,
        gamesPlayed: row[4] as number,
    };
}

/** Update player's highest score - only updates if new score is higher */
export function updatePlayerScore(clientId: string, name: string, score: number): void {
    const db = getDatabase();
    
    // Get or create player (handles name-based deduplication)
    const player = getOrCreatePlayer(clientId, name);
    
    // Only update if new score is higher
    if (score > player.highestScore) {
        db.run(
            "UPDATE players SET highest_score = ?, games_played = games_played + 1, name = ?, updated_at = datetime('now') WHERE id = ?",
            [score, name, player.id]
        );
        console.log(`[DB] Updated player ${name} (ID: ${player.id}) score: ${player.highestScore} → ${score}`);
    } else {
        // Just increment games played
        db.run(
            "UPDATE players SET games_played = games_played + 1, name = ?, updated_at = datetime('now') WHERE id = ?",
            [name, player.id]
        );
        console.log(`[DB] Player ${name} played game, score unchanged (${player.highestScore})`);
    }
    
    saveDatabase();
}

/** Get leaderboard - top players by highest score */
export function getPlayerLeaderboard(limit: number = 5): LeaderboardEntry[] {
    const db = getDatabase();
    // Group by name to handle legacy duplicates and ensure one entry per player name
    const result = db.exec(
        'SELECT name, MAX(highest_score) as max_score, SUM(games_played) as total_games FROM players GROUP BY name ORDER BY max_score DESC LIMIT ?',
        [limit]
    );
    
    if (result.length === 0 || result[0].values.length === 0) return [];
    
    return result[0].values.map((row, index) => ({
        rank: index + 1,
        playerName: row[0] as string,
        totalScore: row[1] as number,
        gamesPlayed: row[2] as number,
    }));
}

/** Debug: Get all players */
export function getAllPlayersDebug(): { id: number; name: string; highest_score: number; games_played: number }[] {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, highest_score, games_played FROM players ORDER BY highest_score DESC');
    
    if (result.length === 0) return [];
    
    return result[0].values.map(row => ({
        id: row[0] as number,
        name: row[1] as string,
        highest_score: row[2] as number,
        games_played: row[3] as number,
    }));
}