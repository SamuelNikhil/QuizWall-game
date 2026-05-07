// ==========================================
// Player Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import type { LeaderboardEntry } from '../shared/types.ts';

/** Get or create a player by client_id, returns player data */
function getOrCreatePlayer(clientId: string, name: string): { id: number; highestScore: number } {
    const db = getDatabase();

    const result = db.exec('SELECT id, highest_score FROM players WHERE client_id = ?', [clientId]);

    if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        return { id: row[0] as number, highestScore: row[1] as number };
    }

    // Create new player
    db.run('INSERT INTO players (client_id, name) VALUES (?, ?)', [clientId, name]);
    const insertResult = db.exec('SELECT last_insert_rowid() as id');
    const id = insertResult[0].values[0][0] as number;
    saveDatabase();
    console.log(`[DB] Created new player record: ${name} (${clientId.substring(0, 8)}...)`);
    return { id, highestScore: 0 };
}

/** Update player's highest score - only updates if new score is higher */
export function updatePlayerScore(clientId: string, name: string, score: number): void {
    const db = getDatabase();
    const player = getOrCreatePlayer(clientId, name);

    if (score > player.highestScore) {
        db.run(
            "UPDATE players SET highest_score = ?, games_played = games_played + 1, name = ?, updated_at = datetime('now') WHERE id = ?",
            [score, name, player.id]
        );
        console.log(`[DB] Updated player ${name} score: ${player.highestScore} → ${score}`);
    } else {
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
