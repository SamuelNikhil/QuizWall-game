// ==========================================
// Team Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import type { LeaderboardEntry } from '../shared/types.ts';

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

/** Update a team's cumulative score and games played */
export function updateTeamScore(teamId: number, scoreToAdd: number): void {
    const db = getDatabase();
    db.run(
        "UPDATE teams SET total_score = total_score + ?, games_played = games_played + 1, updated_at = datetime('now') WHERE id = ?",
        [scoreToAdd, teamId]
    );
    saveDatabase();
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
