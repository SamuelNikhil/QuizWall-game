// ==========================================
// Question Repository — JSON Layer
// ==========================================

import { readFileSync, existsSync } from 'fs';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion } from '../shared/types.ts';

let cachedQuestions: ServerQuestion[] | null = null;

/** Load questions from JSON file */
export function loadQuestions(): ServerQuestion[] {
    if (cachedQuestions) return cachedQuestions;

    if (!existsSync(CONFIG.QUESTIONS_PATH)) {
        console.error(`[QuestionRepo] Questions file not found at: ${CONFIG.QUESTIONS_PATH}`);
        return [];
    }

    try {
        const fileContent = readFileSync(CONFIG.QUESTIONS_PATH, 'utf-8');
        cachedQuestions = JSON.parse(fileContent) as ServerQuestion[];
        console.log(`[QuestionRepo] Loaded ${cachedQuestions.length} questions from JSON`);
        return cachedQuestions;
    } catch (err) {
        console.error('[QuestionRepo] Error parsing questions.json:', err);
        return [];
    }
}

/** Get all questions */
export function getAllQuestions(): ServerQuestion[] {
    return loadQuestions();
}

/** Get a random subset of questions */
export function getRandomQuestions(count: number): ServerQuestion[] {
    const all = [...getAllQuestions()];
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length));
}
