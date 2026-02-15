// ==========================================
// Team Manager — Domain Layer
// ==========================================

import * as teamRepo from '../data/teamRepository.ts';
import type { LeaderboardEntry } from '../shared/types.ts';

export class TeamManager {
    private teamName: string = '';
    private teamDbId: number | null = null;
    private liveScore: number = 0;

    /** Set team name and persist to DB */
    setTeamName(name: string): void {
        this.teamName = name;
        this.teamDbId = teamRepo.getOrCreateTeam(name);
        console.log(`[Team] Set team name: "${name}" (DB id: ${this.teamDbId})`);
    }

    getTeamName(): string {
        return this.teamName;
    }

    getTeamDbId(): number | null {
        return this.teamDbId;
    }

    /** Add points to live score */
    addScore(points: number): void {
        this.liveScore += points;
    }

    getLiveScore(): number {
        return this.liveScore;
    }

    /** Persist the final game score to DB */
    saveGameResult(roomId: string, questionsAnswered: number): void {
        if (this.teamDbId === null) {
            console.warn('[Team] Cannot save: no team DB id');
            return;
        }
        teamRepo.updateTeamScore(this.teamDbId, this.liveScore);
        teamRepo.saveGameSession(roomId, this.teamDbId, this.liveScore, questionsAnswered);
        console.log(`[Team] Saved result: "${this.teamName}" scored ${this.liveScore}`);
    }

    /** Reset live score for a new game (team name persists) */
    resetScore(): void {
        this.liveScore = 0;
    }

    /** Get leaderboard from DB */
    static getLeaderboard(limit: number = 10): LeaderboardEntry[] {
        return teamRepo.getLeaderboard(limit);
    }
}
