// ==========================================
// Player Manager — Domain Layer
// Handles player persistence and leaderboard
// ==========================================

import * as playerRepo from '../data/playerRepository.ts';
import type { LeaderboardEntry, PlayerScoreEntry } from '../shared/types.ts';

export class PlayerManager {
    /**
     * Save the top player from a game session to the database.
     * Only saves if the player has a score > 0.
     */
    static saveTopPlayer(roomId: string, playerScores: PlayerScoreEntry[]): void {
        if (!playerScores || playerScores.length === 0) {
            console.log(`[PlayerManager] No player scores to save for room ${roomId}`);
            return;
        }

        // Find the player with the highest score
        const topPlayer = playerScores.reduce((top, current) => 
            current.score > top.score ? current : top
        );

        if (topPlayer.score <= 0) {
            console.log(`[PlayerManager] Top player score is 0, not saving`);
            return;
        }

        // Save to database (will only update if score is higher than existing)
        playerRepo.updatePlayerScore(topPlayer.controllerId, topPlayer.name, topPlayer.score);
        console.log(`[PlayerManager] Saved top player: ${topPlayer.name} with score ${topPlayer.score}`);
    }

    /**
     * Get the leaderboard - top players by highest score.
     */
    static getPlayerLeaderboard(limit: number = 5): LeaderboardEntry[] {
        return playerRepo.getPlayerLeaderboard(limit);
    }

    /**
     * Get an existing player by client ID.
     * Returns null if player doesn't exist in database.
     */
    static getExistingPlayerName(clientId: string): string | null {
        const player = playerRepo.getPlayerByClientId(clientId);
        return player?.name ?? null;
    }
}