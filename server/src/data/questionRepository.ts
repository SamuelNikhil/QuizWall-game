// ==========================================
// Question Repository — Hybrid Layer
// Groq AI + JSON Fallback with Persistent Cache
// ==========================================

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../infrastructure/config.ts';
import type { ServerQuestion } from '../shared/types.ts';
import { getGroqService, isGroqEnabled } from '../services/GroqService.ts';

// Get current directory for file paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_QUESTIONS_PATH = join(__dirname, 'Ai-questions.json');

interface AiQuestionsFile {
    topic: string;
    generatedAt: string;
    questions: ServerQuestion[];
}

// Static JSON questions cache (fallback)
let staticQuestionsCache: ServerQuestion[] | null = null;

// Session-specific generated questions (per room/game)
const sessionQuestionsCache = new Map<string, ServerQuestion[]>();

/** Load static questions from JSON file (fallback source) */
export function loadStaticQuestions(): ServerQuestion[] {
    if (staticQuestionsCache) return staticQuestionsCache;

    if (!existsSync(CONFIG.QUESTIONS_PATH)) {
        console.error(`[QuestionRepo] Questions file not found at: ${CONFIG.QUESTIONS_PATH}`);
        return [];
    }

    try {
        const fileContent = readFileSync(CONFIG.QUESTIONS_PATH, 'utf-8');
        staticQuestionsCache = JSON.parse(fileContent) as ServerQuestion[];
        console.log(`[QuestionRepo] Loaded ${staticQuestionsCache.length} static questions from JSON`);
        return staticQuestionsCache;
    } catch (err) {
        console.error('[QuestionRepo] Error parsing questions.json:', err);
        return [];
    }
}

/** Load AI-generated questions from file if exists and topic matches */
function loadAiQuestions(currentTopic: string): ServerQuestion[] | null {
    if (!existsSync(AI_QUESTIONS_PATH)) {
        console.log('[QuestionRepo] No Ai-questions.json found');
        return null;
    }

    try {
        const fileContent = readFileSync(AI_QUESTIONS_PATH, 'utf-8');
        
        // Handle empty file
        if (!fileContent || fileContent.trim() === '') {
            console.log('[QuestionRepo] Ai-questions.json is empty, deleting...');
            deleteAiQuestions();
            return null;
        }
        
        const data = JSON.parse(fileContent) as AiQuestionsFile;
        
        // Check if topic matches
        if (data.topic !== currentTopic) {
            console.log(`[QuestionRepo] Topic changed from "${data.topic}" to "${currentTopic}" - deleting old cache`);
            deleteAiQuestions();
            return null;
        }
        
        if (!data.questions || data.questions.length === 0) {
            console.log('[QuestionRepo] Ai-questions.json has no questions, deleting...');
            deleteAiQuestions();
            return null;
        }
        
        console.log(`[QuestionRepo] Loaded ${data.questions.length} AI questions from cache (topic: ${data.topic})`);
        return data.questions;
    } catch (err) {
        console.error('[QuestionRepo] Error reading Ai-questions.json, deleting corrupted file:', err);
        deleteAiQuestions();
        return null;
    }
}

/** Save AI-generated questions to file */
function saveAiQuestions(questions: ServerQuestion[], topic: string): void {
    try {
        const data: AiQuestionsFile = {
            topic,
            generatedAt: new Date().toISOString(),
            questions: questions.map(q => normalizeQuestionFormat(q))
        };
        
        writeFileSync(AI_QUESTIONS_PATH, JSON.stringify(data, null, 4), 'utf-8');
        console.log(`[QuestionRepo] Saved ${questions.length} AI questions to Ai-questions.json (topic: ${topic})`);
    } catch (err) {
        console.error('[QuestionRepo] Error saving Ai-questions.json:', err);
    }
}

/** Delete AI questions file (when topic changes) */
function deleteAiQuestions(): void {
    try {
        if (existsSync(AI_QUESTIONS_PATH)) {
            unlinkSync(AI_QUESTIONS_PATH);
            console.log('[QuestionRepo] Deleted Ai-questions.json');
        }
    } catch (err) {
        console.error('[QuestionRepo] Error deleting Ai-questions.json:', err);
    }
}

/**
 * Generate fresh questions for a new game session
 * ALWAYS generates fresh AI questions via Groq to avoid repetition
 * Falls back to static JSON only if AI generation fails
 */
export async function generateSessionQuestions(sessionId: string): Promise<ServerQuestion[]> {
    // Check if we already have questions for this session
    if (sessionQuestionsCache.has(sessionId)) {
        console.log(`[QuestionRepo] Returning cached questions for session: ${sessionId}`);
        return sessionQuestionsCache.get(sessionId)!;
    }

    const currentTopic = CONFIG.QUIZ_TOPIC || 'General Knowledge';
    let questions: ServerQuestion[] = [];

    // Step 1: ALWAYS try to generate fresh questions via Groq first (to avoid repetition)
    if (isGroqEnabled()) {
        try {
            const groqService = getGroqService()!;
            console.log(`[QuestionRepo] Generating ${CONFIG.QUESTIONS_PER_SESSION || 10} FRESH questions via Groq for topic: ${currentTopic}`);
            
            questions = await groqService.generateQuestionsForSession();
            
            if (!questions || questions.length === 0) {
                throw new Error('Groq returned empty questions array');
            }
            
            // Remove any duplicates based on question text
            const seenTexts = new Set<string>();
            questions = questions.filter(q => {
                const normalizedText = q.text.trim().toLowerCase();
                if (seenTexts.has(normalizedText)) {
                    console.log(`[QuestionRepo] Filtering duplicate question: "${q.text.substring(0, 50)}..."`);
                    return false;
                }
                seenTexts.add(normalizedText);
                return true;
            });
            
            console.log(`[QuestionRepo] Generated ${questions.length} FRESH questions via Groq (after deduplication)`);
            console.log(`[QuestionRepo] First question:`, JSON.stringify(questions[0]).substring(0, 200));
            
            // Save to Ai-questions.json for backup only (not for reuse)
            saveAiQuestions(questions, currentTopic);
            
        } catch (error) {
            console.error('[QuestionRepo] Groq generation failed, falling back to cached/static:', error);
            // Try cached AI questions as fallback
            const cachedAiQuestions = loadAiQuestions(currentTopic);
            if (cachedAiQuestions && cachedAiQuestions.length > 0) {
                console.log(`[QuestionRepo] Using cached AI questions as fallback`);
                questions = cachedAiQuestions;
            } else {
                console.log('[QuestionRepo] No cached questions, using static fallback');
                questions = getRandomStaticQuestions(CONFIG.QUESTIONS_PER_SESSION || 10);
            }
        }
    }
    // Step 2: Groq not enabled, try cached AI questions
    else {
        const cachedAiQuestions = loadAiQuestions(currentTopic);
        if (cachedAiQuestions && cachedAiQuestions.length > 0) {
            console.log(`[QuestionRepo] Groq disabled, using cached AI questions for topic: ${currentTopic}`);
            questions = cachedAiQuestions;
        } else {
            console.log('[QuestionRepo] Groq not enabled and no cache, using static questions');
            questions = getRandomStaticQuestions(CONFIG.QUESTIONS_PER_SESSION || 10);
        }
    }

    // Normalize format
    questions = questions.map(q => normalizeQuestionFormat(q));

    // Cache for this session
    sessionQuestionsCache.set(sessionId, questions);
    
    console.log(`[QuestionRepo] Cached ${questions.length} questions for session: ${sessionId}`);
    return questions;
}

/**
 * Pre-generate questions for a session (call when room is created)
 * This ensures questions are ready when game starts
 */
export async function preGenerateForSession(sessionId: string): Promise<void> {
    if (sessionQuestionsCache.has(sessionId)) {
        console.log(`[QuestionRepo] Questions already cached for session: ${sessionId}`);
        return;
    }

    try {
        await generateSessionQuestions(sessionId);
    } catch (error) {
        console.warn(`[QuestionRepo] Pre-generation failed for session ${sessionId}:`, error);
    }
}

/**
 * Get questions for an active session
 * Returns cached questions or generates new ones
 * Automatically adds static questions as buffer and generates +10 more if running low
 * 
 * @param sessionId - The session ID
 * @param additionalCount - Optional number of additional questions to generate (for dynamic limit increases)
 */
export async function getSessionQuestions(sessionId: string, additionalCount?: number): Promise<ServerQuestion[]> {
    // If additionalCount is specified, generate more questions for existing session
    if (additionalCount && additionalCount > 0 && sessionQuestionsCache.has(sessionId)) {
        console.log(`[QuestionRepo] Generating +${additionalCount} additional questions for session ${sessionId}`);
        
        if (isGroqEnabled() && !isGenerating.has(sessionId)) {
            isGenerating.add(sessionId);
            try {
                await generateMoreQuestionsForSession(sessionId, additionalCount);
            } finally {
                isGenerating.delete(sessionId);
            }
        }
        
        return sessionQuestionsCache.get(sessionId)!;
    }
    
    if (sessionQuestionsCache.has(sessionId)) {
        const questions = sessionQuestionsCache.get(sessionId)!;
        
        // Check if we need more questions (less than 5 remaining)
        if (questions.length < 5) {
            console.log(`[QuestionRepo] Running low on questions (${questions.length} left), adding static buffer + generating AI...`);
            
            // Step 1: Immediately add static questions as temporary buffer
            const staticBuffer = getRandomStaticQuestions(10);
            const withBuffer = [...questions, ...staticBuffer];
            sessionQuestionsCache.set(sessionId, withBuffer);
            console.log(`[QuestionRepo] Added ${staticBuffer.length} static questions as buffer. Total: ${withBuffer.length}`);
            
            // Step 2: Trigger background AI generation if Groq is enabled
            if (isGroqEnabled() && !isGenerating.has(sessionId)) {
                isGenerating.add(sessionId);
                console.log(`[QuestionRepo] Triggering background AI generation for session ${sessionId}...`);
                
                // Run generation in background (don't await)
                generateMoreQuestionsForSession(sessionId).finally(() => {
                    isGenerating.delete(sessionId);
                });
            }
            
            return withBuffer;
        }
        
        return questions;
    }
    return generateSessionQuestions(sessionId);
}

// Track which sessions are currently generating to prevent duplicates
const isGenerating = new Set<string>();

/**
 * Background generation of more AI questions for a session
 * Generates FRESH questions to avoid repetition
 * 
 * @param sessionId - The session ID
 * @param count - Optional number of questions to generate (defaults to QUESTIONS_PER_SESSION)
 */
async function generateMoreQuestionsForSession(sessionId: string, count?: number): Promise<void> {
    try {
        const groqService = getGroqService()!;
        const questionCount = count || (CONFIG.QUESTIONS_PER_SESSION || 10);
        console.log(`[QuestionRepo] Generating ${questionCount} FRESH questions in background for session ${sessionId}...`);
        
        // Temporarily override question count for this generation
        const originalCount = groqService['questionCount'];
        groqService['questionCount'] = questionCount;
        
        // Generate fresh questions (not from cache)
        const newQuestions = await groqService.generateQuestionsForSession();
        
        // Restore original count
        groqService['questionCount'] = originalCount;
        
        if (newQuestions && newQuestions.length > 0) {
            // Normalize new questions
            const normalizedNew = newQuestions.map(q => normalizeQuestionFormat(q));
            
            // Get current cache
            const currentQuestions = sessionQuestionsCache.get(sessionId) || [];
            
            // Filter out any questions that have the same text as existing ones (avoid duplicates)
            const existingTexts = new Set(currentQuestions.map(q => q.text.trim().toLowerCase()));
            const uniqueNewQuestions = normalizedNew.filter(q => !existingTexts.has(q.text.trim().toLowerCase()));
            
            if (uniqueNewQuestions.length === 0) {
                console.log('[QuestionRepo] Generated questions were all duplicates, skipping...');
                return;
            }
            
            // Combine existing with new fresh questions
            const allQuestions = [...currentQuestions, ...uniqueNewQuestions];
            sessionQuestionsCache.set(sessionId, allQuestions);
            
            // Also save to file for persistence (append mode)
            const currentTopic = CONFIG.QUIZ_TOPIC || 'General Knowledge';
            const existingCache = loadAiQuestions(currentTopic);
            if (existingCache) {
                // Also filter duplicates from file cache
                const fileTexts = new Set(existingCache.map(q => q.text.trim().toLowerCase()));
                const uniqueForFile = uniqueNewQuestions.filter(q => !fileTexts.has(q.text.trim().toLowerCase()));
                if (uniqueForFile.length > 0) {
                    saveAiQuestions([...existingCache, ...uniqueForFile], currentTopic);
                }
            } else {
                saveAiQuestions(uniqueNewQuestions, currentTopic);
            }
            
            console.log(`[QuestionRepo] Background generation complete! Added ${uniqueNewQuestions.length} FRESH AI questions. Total: ${allQuestions.length}`);
        }
    } catch (error) {
        console.error('[QuestionRepo] Background generation failed:', error);
    }
}

/**
 * Clear session questions (call when game/room ends)
 */
export function clearSessionQuestions(sessionId: string): void {
    sessionQuestionsCache.delete(sessionId);
    console.log(`[QuestionRepo] Cleared questions for session: ${sessionId}`);
}

/**
 * Clear all session caches
 */
export function clearAllSessionQuestions(): void {
    sessionQuestionsCache.clear();
    console.log('[QuestionRepo] Cleared all session question caches');
}

/** Get all static questions (legacy support) */
export function getAllQuestions(): ServerQuestion[] {
    return loadStaticQuestions();
}

/** Get a random subset of static questions */
export function getRandomStaticQuestions(count: number): ServerQuestion[] {
    const all = [...loadStaticQuestions()];
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length)).map(q => normalizeQuestionFormat(q));
}

/** Get a random subset of questions (legacy support) */
export function getRandomQuestions(count: number): ServerQuestion[] {
    return getRandomStaticQuestions(count);
}

/**
 * Normalize question format between AI and JSON formats
 * AI returns: { options: { A: "text", B: "text", ... } }
 * JSON has: { options: [{ id: "A", text: "text" }, ...] }
 */
function normalizeQuestionFormat(q: ServerQuestion): ServerQuestion {
    // If options is already an array, return as-is
    if (Array.isArray(q.options)) {
        return q;
    }
    
    // Convert object format to array format
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

/**
 * Get current topic from config
 */
export function getCurrentTopic(): string {
    return CONFIG.QUIZ_TOPIC || 'General Knowledge';
}

/**
 * Force regeneration of AI questions (call when topic changes)
 * Deletes the cached AI questions file
 */
export function forceRegenerateAiQuestions(): void {
    deleteAiQuestions();
    clearAllSessionQuestions();
    console.log('[QuestionRepo] Forced regeneration - AI questions will be generated on next game');
}

/**
 * Check if AI is enabled
 */
export function isUsingAi(): boolean {
    return isGroqEnabled();
}

/**
 * Get the path to AI questions file (for debugging)
 */
export function getAiQuestionsPath(): string {
    return AI_QUESTIONS_PATH;
}
