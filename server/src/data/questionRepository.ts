// ==========================================
// Question Repository — Hybrid Layer
// Groq AI + JSON Fallback with Persistent Cache
// Per-room file cache: Quizwall_<roomId>.json
// ==========================================

import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion, QuizTopicId, QuizDifficulty } from '../shared/types.ts';
import { DEFAULT_TOPIC, DEFAULT_DIFFICULTY } from '../shared/types.ts';
import { getGroqService, isGroqEnabled } from '../services/GroqService.ts';

// Get current directory for file paths
const __dirname = dirname(fileURLToPath(import.meta.url));

interface RoomQuestionsFile {
    roomId: string;
    topic: string;
    difficulty: string;
    generatedAt: string;
    questions: ServerQuestion[];
}

// ==========================================
// Per-room file helpers
// ==========================================

/** Resolve the file path for a room's question cache */
function getRoomFilePath(roomId: string): string {
    return join(__dirname, `Quizwall_${roomId}.json`);
}

/** Load questions from a room's cache file. Returns null if missing, stale topic/difficulty, or corrupt. */
function loadRoomFile(roomId: string, topic: string, difficulty: string): ServerQuestion[] | null {
    const filePath = getRoomFilePath(roomId);
    if (!existsSync(filePath)) return null;

    try {
        const raw = readFileSync(filePath, 'utf-8');
        if (!raw || raw.trim() === '') {
            deleteRoomFile(roomId);
            return null;
        }

        const data = JSON.parse(raw) as RoomQuestionsFile;

        if (data.topic !== topic || data.difficulty !== difficulty) {
            console.log(`[QuestionRepo] Room ${roomId} file topic/difficulty mismatch — deleting`);
            deleteRoomFile(roomId);
            return null;
        }

        if (!data.questions || data.questions.length === 0) {
            deleteRoomFile(roomId);
            return null;
        }

        console.log(`[QuestionRepo] Loaded ${data.questions.length} questions from Quizwall_${roomId}.json`);
        return data.questions;
    } catch (err) {
        console.error(`[QuestionRepo] Error reading Quizwall_${roomId}.json — deleting:`, err);
        deleteRoomFile(roomId);
        return null;
    }
}

/** Save questions to a room's cache file */
function saveRoomFile(roomId: string, questions: ServerQuestion[], topic: string, difficulty: string): void {
    const filePath = getRoomFilePath(roomId);
    try {
        const data: RoomQuestionsFile = {
            roomId,
            topic,
            difficulty,
            generatedAt: new Date().toISOString(),
            questions: questions.map(q => normalizeQuestionFormat(q)),
        };
        writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
        console.log(`[QuestionRepo] Saved ${questions.length} questions to Quizwall_${roomId}.json`);
    } catch (err) {
        console.error(`[QuestionRepo] Error saving Quizwall_${roomId}.json:`, err);
    }
}

/** Delete a room's cache file */
function deleteRoomFile(roomId: string): void {
    const filePath = getRoomFilePath(roomId);
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
            console.log(`[QuestionRepo] Deleted Quizwall_${roomId}.json`);
        }
    } catch (err) {
        console.error(`[QuestionRepo] Error deleting Quizwall_${roomId}.json:`, err);
    }
}

/** Extract roomId from a sessionId (format: "room-<roomId>-<timestamp>") */
function roomIdFromSessionId(sessionId: string): string {
    // sessionId format: "room-ABCDEF-1234567890"
    const parts = sessionId.split('-');
    if (parts.length >= 2 && parts[0] === 'room') {
        return parts[1]; // e.g. "ABCDEF"
    }
    // Fallback: use the full sessionId as the room identifier
    return sessionId;
}

// ==========================================
// Static questions (fallback)
// ==========================================

let staticQuestionsCache: ServerQuestion[] | null = null;

export function loadStaticQuestions(): ServerQuestion[] {
    if (staticQuestionsCache) return staticQuestionsCache;

    if (!existsSync(CONFIG.QUESTIONS_PATH)) {
        console.error(`[QuestionRepo] Questions file not found at: ${CONFIG.QUESTIONS_PATH}`);
        return [];
    }

    try {
        const fileContent = readFileSync(CONFIG.QUESTIONS_PATH, 'utf-8');
        staticQuestionsCache = JSON.parse(fileContent) as ServerQuestion[];
        return staticQuestionsCache;
    } catch (err) {
        console.error('[QuestionRepo] Error parsing questions.json:', err);
        return [];
    }
}

// ==========================================
// In-memory session cache
// ==========================================

interface SessionCacheEntry {
    questions: ServerQuestion[];
    topic: QuizTopicId;
    difficulty: QuizDifficulty;
    roomId: string;
}

// Session-specific generated questions (per room/game)
const sessionQuestionsCache = new Map<string, SessionCacheEntry>();

// In-flight generation promises — prevents duplicate Groq calls for the same session
const generatingPromises = new Map<string, Promise<ServerQuestion[]>>();

// ==========================================
// Global cross-room deduplication
// ==========================================

const globalRecentQuestions = new Set<string>();
const MAX_GLOBAL_RECENT = 500;

function addToGlobalRecent(text: string): void {
    const normalized = text.trim().toLowerCase();
    globalRecentQuestions.add(normalized);
    if (globalRecentQuestions.size > MAX_GLOBAL_RECENT) {
        const oldest = globalRecentQuestions.values().next().value;
        if (oldest) globalRecentQuestions.delete(oldest);
    }
}

function getGlobalExclusionList(): string[] {
    return Array.from(globalRecentQuestions);
}

// ==========================================
// Core generation
// ==========================================

/**
 * Generate fresh questions for a new game session.
 * Always makes a fresh Groq call (forceRefresh=true) to avoid stale questions on repeated topics.
 * Falls back to the room's file cache, then static JSON if Groq fails.
 */
export async function generateSessionQuestions(sessionId: string, topic?: QuizTopicId, difficulty?: QuizDifficulty): Promise<ServerQuestion[]> {
    const currentTopic = topic || DEFAULT_TOPIC;
    const currentDifficulty = difficulty || DEFAULT_DIFFICULTY;
    const roomId = roomIdFromSessionId(sessionId);

    const cached = sessionQuestionsCache.get(sessionId);
    if (cached && cached.topic === currentTopic && cached.difficulty === currentDifficulty) {
        return cached.questions;
    }

    if (cached && (cached.topic !== currentTopic || cached.difficulty !== currentDifficulty)) {
        console.log(`[QuestionRepo] Session ${sessionId} topic/difficulty changed — regenerating`);
    }

    // Reuse in-flight promise for the same session+topic+difficulty
    const inFlightKey = `${sessionId}:${currentTopic}:${currentDifficulty}`;
    const existing = generatingPromises.get(inFlightKey);
    if (existing) {
        console.log(`[QuestionRepo] Reusing in-flight generation for session ${sessionId}, topic ${currentTopic}`);
        return existing;
    }

    const promise = (async (): Promise<ServerQuestion[]> => {
        let questions: ServerQuestion[] = [];

        if (isGroqEnabled()) {
            const maxRetries = 2;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const groqService = getGroqService()!;

                    // forceRefresh=true: always bypass the per-topic Groq cache for new rounds
                    questions = await groqService.generateQuestionsForTopic(
                        currentTopic,
                        getGlobalExclusionList(),
                        true, // forceRefresh
                        currentDifficulty,
                    );

                    if (!questions || questions.length === 0) {
                        throw new Error('Groq returned empty questions array');
                    }

                    // Deduplicate by question text
                    const seenTexts = new Set<string>();
                    questions = questions.filter(q => {
                        const key = q.text.trim().toLowerCase();
                        if (seenTexts.has(key)) return false;
                        seenTexts.add(key);
                        return true;
                    });

                    if (questions.length < 5) {
                        console.warn(`[QuestionRepo] Only ${questions.length} unique questions (attempt ${attempt}/${maxRetries})`);
                        if (attempt < maxRetries) continue;
                    }

                    // Persist to per-room file
                    saveRoomFile(roomId, questions, currentTopic, currentDifficulty);

                    // Track globally to avoid cross-room repetition
                    for (const q of questions) addToGlobalRecent(q.text);

                    break;

                } catch (error) {
                    console.error(`[QuestionRepo] Groq attempt ${attempt}/${maxRetries} failed:`, error);
                    if (attempt === maxRetries) {
                        console.error('[QuestionRepo] All Groq retries exhausted — falling back to room file / static');
                        const fileQuestions = loadRoomFile(roomId, currentTopic, currentDifficulty);
                        questions = fileQuestions ?? getRandomStaticQuestions(CONFIG.QUESTIONS_PER_SESSION || 10);
                    }
                }
            }
        } else {
            // Groq not enabled — use room file cache or static fallback
            const fileQuestions = loadRoomFile(roomId, currentTopic, currentDifficulty);
            questions = fileQuestions ?? getRandomStaticQuestions(CONFIG.QUESTIONS_PER_SESSION || 10);
        }

        questions = questions.map(q => normalizeQuestionFormat(q));

        // Store in memory cache
        if (sessionQuestionsCache.has(sessionId) || !generatingPromises.has(inFlightKey)) {
            sessionQuestionsCache.set(sessionId, { questions, topic: currentTopic, difficulty: currentDifficulty, roomId });
        }

        return questions;
    })();

    generatingPromises.set(inFlightKey, promise);
    try {
        return await promise;
    } finally {
        generatingPromises.delete(inFlightKey);
    }
}

/**
 * Pre-generate questions for a session (fire-and-forget at topic finalization).
 * Starts the Groq call as early as possible so questions are ready before the loading screen ends.
 */
export async function preGenerateForSession(sessionId: string, topic?: QuizTopicId, difficulty?: QuizDifficulty): Promise<void> {
    const currentTopic = topic || DEFAULT_TOPIC;
    const currentDifficulty = difficulty || DEFAULT_DIFFICULTY;
    const cached = sessionQuestionsCache.get(sessionId);
    if (cached && cached.topic === currentTopic && cached.difficulty === currentDifficulty) {
        return;
    }

    try {
        await generateSessionQuestions(sessionId, currentTopic, currentDifficulty);
    } catch (error) {
        console.warn(`[QuestionRepo] Pre-generation failed for session ${sessionId}:`, error);
    }
}

/**
 * Get questions for an active session.
 * Returns cached questions or generates new ones.
 * Tops up with static buffer + background Groq generation when running low.
 */
export async function getSessionQuestions(sessionId: string, additionalCount?: number, topic?: QuizTopicId, difficulty?: QuizDifficulty): Promise<ServerQuestion[]> {
    const currentTopic = topic || DEFAULT_TOPIC;
    const currentDifficulty = difficulty || DEFAULT_DIFFICULTY;
    const roomId = roomIdFromSessionId(sessionId);
    const cached = sessionQuestionsCache.get(sessionId);

    // Explicit top-up request
    if (additionalCount && additionalCount > 0 && cached && cached.topic === currentTopic) {
        const inFlightKey = `${sessionId}:${currentTopic}:${currentDifficulty}:more`;
        if (isGroqEnabled() && !generatingPromises.has(inFlightKey)) {
            const morePromise = generateMoreQuestionsForSession(sessionId, additionalCount, currentTopic);
            generatingPromises.set(inFlightKey, morePromise.then(() => sessionQuestionsCache.get(sessionId)!.questions));
            try {
                await morePromise;
            } finally {
                generatingPromises.delete(inFlightKey);
            }
        }
        return sessionQuestionsCache.get(sessionId)!.questions;
    }

    if (cached && cached.topic === currentTopic && cached.difficulty === currentDifficulty) {
        const questions = cached.questions;

        // Running low — add static buffer immediately and trigger background generation
        if (questions.length < 5) {
            const staticBuffer = getRandomStaticQuestions(10);
            const withBuffer = [...questions, ...staticBuffer];
            sessionQuestionsCache.set(sessionId, { questions: withBuffer, topic: currentTopic, difficulty: currentDifficulty, roomId });

            const inFlightKey = `${sessionId}:${currentTopic}:${currentDifficulty}:more`;
            if (isGroqEnabled() && !generatingPromises.has(inFlightKey)) {
                const bgPromise = generateMoreQuestionsForSession(sessionId, undefined, currentTopic);
                generatingPromises.set(inFlightKey, bgPromise.then(() => []));
                bgPromise.finally(() => generatingPromises.delete(inFlightKey));
            }

            return withBuffer;
        }

        return questions;
    }

    // Topic or difficulty changed — regenerate
    if (cached && (cached.topic !== currentTopic || cached.difficulty !== currentDifficulty)) {
        console.log(`[QuestionRepo] Session ${sessionId} topic/difficulty changed — regenerating`);
        sessionQuestionsCache.delete(sessionId);
    }

    return generateSessionQuestions(sessionId, currentTopic, currentDifficulty);
}

/**
 * Background generation of additional questions for a session.
 * Appends unique new questions to the in-memory cache and updates the room file.
 */
async function generateMoreQuestionsForSession(sessionId: string, count?: number, topic?: QuizTopicId): Promise<void> {
    try {
        const groqService = getGroqService()!;
        const questionCount = count || (CONFIG.QUESTIONS_PER_SESSION || 10);
        const cachedEntry = sessionQuestionsCache.get(sessionId);
        const currentTopic = topic || cachedEntry?.topic || DEFAULT_TOPIC;
        const currentDifficulty = cachedEntry?.difficulty || DEFAULT_DIFFICULTY;
        const roomId = cachedEntry?.roomId || roomIdFromSessionId(sessionId);

        const newQuestions = await groqService.generateQuestionsForTopicWithCount(
            currentTopic,
            questionCount,
            getGlobalExclusionList(),
            true, // forceRefresh
            currentDifficulty,
        );

        if (!newQuestions || newQuestions.length === 0) return;

        const normalizedNew = newQuestions.map(q => normalizeQuestionFormat(q));
        const currentQuestions = sessionQuestionsCache.get(sessionId)?.questions || [];
        const existingTexts = new Set(currentQuestions.map(q => q.text.trim().toLowerCase()));
        const uniqueNew = normalizedNew.filter(q => !existingTexts.has(q.text.trim().toLowerCase()));

        if (uniqueNew.length === 0) return;

        const allQuestions = [...currentQuestions, ...uniqueNew];
        sessionQuestionsCache.set(sessionId, { questions: allQuestions, topic: currentTopic, difficulty: currentDifficulty, roomId });

        // Append unique questions to the room file
        const existingFile = loadRoomFile(roomId, currentTopic, currentDifficulty);
        if (existingFile) {
            const fileTexts = new Set(existingFile.map(q => q.text.trim().toLowerCase()));
            const uniqueForFile = uniqueNew.filter(q => !fileTexts.has(q.text.trim().toLowerCase()));
            if (uniqueForFile.length > 0) {
                saveRoomFile(roomId, [...existingFile, ...uniqueForFile], currentTopic, currentDifficulty);
            }
        } else {
            saveRoomFile(roomId, uniqueNew, currentTopic, currentDifficulty);
        }

        console.log(`[QuestionRepo] Background top-up: +${uniqueNew.length} questions for room ${roomId}`);
    } catch (error) {
        console.error('[QuestionRepo] Background generation failed:', error);
    }
}

// ==========================================
// Session / room cleanup
// ==========================================

/**
 * Clear session questions and delete the room's cache file.
 * Call this when a room is destroyed.
 */
export function clearSessionQuestions(sessionId: string): void {
    const cached = sessionQuestionsCache.get(sessionId);
    if (cached) {
        // Remove from global deduplication set
        for (const q of cached.questions) {
            globalRecentQuestions.delete(q.text.trim().toLowerCase());
        }
        // Delete the per-room file
        deleteRoomFile(cached.roomId);
    }
    sessionQuestionsCache.delete(sessionId);
}

/**
 * Clear all session caches and delete all Quizwall_*.json files.
 */
export function clearAllSessionQuestions(): void {
    // Delete all per-room files
    try {
        const files = readdirSync(__dirname).filter(f => f.startsWith('Quizwall_') && f.endsWith('.json'));
        for (const file of files) {
            try { unlinkSync(join(__dirname, file)); } catch { /* ignore */ }
        }
    } catch { /* ignore */ }

    sessionQuestionsCache.clear();
    globalRecentQuestions.clear();
}

// ==========================================
// Static / legacy helpers
// ==========================================

export function getAllQuestions(): ServerQuestion[] {
    return loadStaticQuestions();
}

export function getRandomStaticQuestions(count: number): ServerQuestion[] {
    const all = [...loadStaticQuestions()];
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length)).map(q => normalizeQuestionFormat(q));
}

export function getRandomQuestions(count: number): ServerQuestion[] {
    return getRandomStaticQuestions(count);
}

export function getCurrentTopic(): QuizTopicId {
    return DEFAULT_TOPIC;
}

/**
 * Force regeneration for all sessions (e.g. on server restart or admin reset).
 * Deletes all Quizwall_*.json files and clears in-memory caches.
 */
export function forceRegenerateAiQuestions(): void {
    clearAllSessionQuestions();
}

// ==========================================
// Format normalization
// ==========================================

/**
 * Normalize question format between AI (object options) and JSON (array options).
 * AI returns: { options: { A: "text", B: "text", ... } }
 * JSON has:   { options: [{ id: "A", text: "text" }, ...] }
 */
function normalizeQuestionFormat(q: ServerQuestion): ServerQuestion {
    if (Array.isArray(q.options)) return q;

    const optionsObj = q.options as unknown as Record<string, string>;
    if (optionsObj && typeof optionsObj === 'object') {
        return {
            ...q,
            options: [
                { id: 'A', text: optionsObj.A || '' },
                { id: 'B', text: optionsObj.B || '' },
                { id: 'C', text: optionsObj.C || '' },
                { id: 'D', text: optionsObj.D || '' },
            ],
        };
    }

    return q;
}
