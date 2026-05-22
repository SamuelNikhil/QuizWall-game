// ==========================================
// Team Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import { CONFIG } from '../infrastructure/config.ts';
import type { LeaderboardEntry } from '../shared/types.ts';

/** Create a new team and return its id */
export function createTeam(name: string): number {
    const db = getDatabase();
    db.run('INSERT INTO teams (name) VALUES (?)', [name]);

    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0] as number;

    saveDatabase();

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



    // Only update if new score is higher than current score
    if (numericNewScore > currentScore) {

        const updateResult = db.run(
            "UPDATE teams SET total_score = ?, games_played = games_played + 1, updated_at = datetime('now') WHERE id = ?",
            [numericNewScore, teamId]
        );

        saveDatabase();

        // Verify the update
        const verifyResult = db.exec('SELECT total_score FROM teams WHERE id = ?', [teamId]);
        const verifiedScore = verifyResult.length > 0 && verifyResult[0].values.length > 0
            ? Number(verifyResult[0].values[0][0])
            : 'N/A';

    } else {
        // Just increment games played, keep existing score

        db.run(
            "UPDATE teams SET games_played = games_played + 1, updated_at = datetime('now') WHERE id = ?",
            [teamId]
        );
        saveDatabase();

    }
}

/** Save a game session record */
export function saveGameSession(
    roomId: string,
    teamId: number,
    score: number,
    questionsAnswered: number,
    topic: string = '',
    difficulty: string = 'easy'
): void {
    const db = getDatabase();
    db.run(
        'INSERT INTO game_sessions (room_id, team_id, score, questions_answered, topic, difficulty) VALUES (?, ?, ?, ?, ?, ?)',
        [roomId, teamId, score, questionsAnswered, topic, difficulty]
    );
    saveDatabase();
    console.log(`[DB] Score updated: team=${teamId}, score=${score}, topic=${topic}, difficulty=${difficulty}`);
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
        playerName: row[0] as string,
        totalScore: row[1] as number,
        gamesPlayed: row[2] as number,
    }));
}

/** Get topic popularity: how many game_sessions per topic, with avg score */
export function getTopicPopularity(): Array<{ topicId: string; selectionCount: number; avgScore: number }> {
    const db = getDatabase();
    const result = db.exec(
        `SELECT topic, COUNT(*) as cnt, AVG(score) as avg FROM game_sessions WHERE topic != '' GROUP BY topic ORDER BY cnt DESC`
    );
    if (result.length === 0 || result[0].values.length === 0) return [];
    return result[0].values.map(row => ({
        topicId: row[0] as string,
        selectionCount: row[1] as number,
        avgScore: Math.round((row[2] as number) * 10) / 10,
    }));
}

/** Get difficulty stats: games played, avg correct %, avg score per difficulty */
export function getDifficultyStats(): Array<{ difficulty: string; gamesPlayed: number; avgCorrectPct: number; avgScore: number }> {
    const db = getDatabase();
    const result = db.exec(
        `SELECT difficulty, COUNT(*) as cnt, AVG(questions_answered) as avg_q, AVG(score) as avg_s FROM game_sessions WHERE difficulty != '' GROUP BY difficulty`
    );
    if (result.length === 0) return [];
    return result[0].values.map(row => ({
        difficulty: row[0] as string,
        gamesPlayed: row[1] as number,
        avgCorrectPct: Math.round((row[2] as number) * 10) / 10,
        avgScore: Math.round((row[3] as number) * 10) / 10,
    }));
}

/** Get recent game sessions for activity timeline (last 60 min) */
export function getRecentActivity(minutes: number = 60): Array<{ timestamp: string; activeRooms: number; activePlayers: number }> {
    const db = getDatabase();
    const result = db.exec(
        `SELECT strftime('%Y-%m-%dT%H:%M:00', created_at) as slot, COUNT(DISTINCT room_id) as rooms, COUNT(*) as players FROM game_sessions WHERE created_at >= datetime('now', '-${minutes} minutes') GROUP BY slot ORDER BY slot`
    );
    if (result.length === 0) return [];
    return result[0].values.map(row => ({
        timestamp: row[0] as string,
        activeRooms: row[1] as number,
        activePlayers: row[2] as number,
    }));
}
