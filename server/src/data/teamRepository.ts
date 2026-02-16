// ==========================================
// Team Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { LeaderboardEntry } from '../shared/types.ts';
import { existsSync } from 'fs';

/** Create a new team and return its id */
export function createTeam(name: string): number {
    const db = getDatabase();
    db.run('INSERT INTO teams (name) VALUES (?)', [name]);

    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0] as number;

    saveDatabase();
    console.log(`[DB] Created team "${name}" with id ${id}`);
    return id;
}

/** Find a team by name, returns id or null */
export function findTeamByName(name: string): number | null {
    const db = getDatabase();
    const result = db.exec('SELECT id FROM teams WHERE name = ?', [name]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0] as number;
}

/** Get or create a team by name */
export function getOrCreateTeam(name: string): number {
    const existing = findTeamByName(name);
    if (existing !== null) return existing;
    return createTeam(name);
}

/** Update a team's score - keeps the highest score (replaces if new score is higher) */
export function updateTeamScore(teamId: number, newScore: number): void {
    const db = getDatabase();

    // Ensure newScore is a number
    const numericNewScore = Number(newScore);

    // Get current score
    const result = db.exec('SELECT total_score FROM teams WHERE id = ?', [teamId]);
    const currentScore = result.length > 0 && result[0].values.length > 0
        ? Number(result[0].values[0][0])
        : 0;

    console.log(`[DB] updateTeamScore called: teamId=${teamId}, newScore=${numericNewScore}, currentScore=${currentScore}`);
    console.log(`[DB] Comparison: ${numericNewScore} > ${currentScore} = ${numericNewScore > currentScore}`);

    // Only update if new score is higher than current score
    if (numericNewScore > currentScore) {
        console.log(`[DB] Executing UPDATE for team ${teamId} with score ${numericNewScore}`);
        const updateResult = db.run(
            "UPDATE teams SET total_score = ?, games_played = games_played + 1, updated_at = datetime('now') WHERE id = ?",
            [numericNewScore, teamId]
        );
        console.log(`[DB] UPDATE result:`, updateResult);
        saveDatabase();

        // Verify the update
        const verifyResult = db.exec('SELECT total_score FROM teams WHERE id = ?', [teamId]);
        const verifiedScore = verifyResult.length > 0 && verifyResult[0].values.length > 0
            ? Number(verifyResult[0].values[0][0])
            : 'N/A';
        console.log(`[DB] Verified score after update: ${verifiedScore}`);
    } else {
        // Just increment games played, keep existing score
        console.log(`[DB] Score not higher, incrementing games_played only`);
        db.run(
            "UPDATE teams SET games_played = games_played + 1, updated_at = datetime('now') WHERE id = ?",
            [teamId]
        );
        saveDatabase();
        console.log(`[DB] Team ${teamId} score ${currentScore} kept (new score ${numericNewScore} not higher)`);
    }
}

/** Save a game session record */
export function saveGameSession(
    roomId: string,
    teamId: number,
    score: number,
    questionsAnswered: number
): void {
    const db = getDatabase();
    db.run(
        'INSERT INTO game_sessions (room_id, team_id, score, questions_answered) VALUES (?, ?, ?, ?)',
        [roomId, teamId, score, questionsAnswered]
    );
    saveDatabase();
    console.log(`[DB] Saved session: room=${roomId}, team=${teamId}, score=${score}`);
}

/** Debug: Get all teams with their scores */
export function getAllTeamsDebug(): { id: number; name: string; total_score: number }[] {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, total_score FROM teams ORDER BY id');
    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
        id: row[0] as number,
        name: row[1] as string,
        total_score: Number(row[2]),
    }));
}

/** Debug: Check if DB file exists and log path */
export function debugDbPath(): void {
    console.log(`[DB] Database path: ${CONFIG.DB_PATH}`);
    console.log(`[DB] File exists: ${existsSync(CONFIG.DB_PATH)}`);
}

/** Get leaderboard: top teams by total score */
export function getLeaderboard(limit: number = 10): LeaderboardEntry[] {
    const db = getDatabase();
    const result = db.exec(
        'SELECT name, total_score, games_played FROM teams ORDER BY total_score DESC LIMIT ?',
        [limit]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row, index) => ({
        rank: index + 1,
        teamName: row[0] as string,
        totalScore: row[1] as number,
        gamesPlayed: row[2] as number,
    }));
}
