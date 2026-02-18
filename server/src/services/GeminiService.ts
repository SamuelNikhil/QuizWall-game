// ==========================================
// Gemini Service — AI Question Generation
// Server-side only for API key security
// ==========================================

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { ServerQuestion } from '../shared/types';

interface GeminiConfig {
    apiKey: string;
    model: string;
    topic: string;
    questionCount: number;
}

interface GeneratedQuestionsCache {
    questions: ServerQuestion[];
    topic: string;
    timestamp: number;
}

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private model: GenerativeModel;
    private modelName: string;
    private topic: string;
    private questionCount: number;
    
    // Cache for generated questions (topic-based)
    private cache: GeneratedQuestionsCache | null = null;
    private readonly CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes cache
    
    // Track used question IDs per topic to avoid duplicates
    private usedQuestionIds: Set<number> = new Set();
    private questionIdCounter: number = 1;

    constructor(config: GeminiConfig) {
        this.genAI = new GoogleGenerativeAI(config.apiKey);
        this.modelName = config.model;
        this.model = this.genAI.getGenerativeModel({ model: config.model });
        this.topic = config.topic;
        this.questionCount = config.questionCount;
        
        console.log(`[GeminiService] Initialized with model: ${config.model}, topic: ${config.topic}`);
    }

    /**
     * Generate fresh questions for a new game session
     * Each call generates unique questions to avoid repetition
     */
    async generateQuestionsForSession(): Promise<ServerQuestion[]> {
        try {
            console.log(`[GeminiService] Generating ${this.questionCount} fresh questions for topic: ${this.topic}`);
            
            const prompt = this.buildPrompt();
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            const questions = this.parseResponse(text);
            
            // Assign unique IDs and track them
            const questionsWithIds = questions.map(q => ({
                ...q,
                id: this.getNextQuestionId(),
            }));
            
            console.log(`[GeminiService] Successfully generated ${questionsWithIds.length} questions`);
            return questionsWithIds;
            
        } catch (error) {
            console.error('[GeminiService] Error generating questions:', error);
            throw new Error(`Failed to generate questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Generate questions with caching (for lobby/pre-game)
     * Returns cached questions if valid, otherwise generates new ones
     */
    async getOrGenerateQuestions(): Promise<ServerQuestion[]> {
        // Check if cache is valid for current topic
        if (this.isCacheValid()) {
            console.log('[GeminiService] Returning cached questions');
            return this.cache!.questions;
        }
        
        // Generate new questions and cache them
        const questions = await this.generateQuestionsForSession();
        this.cache = {
            questions,
            topic: this.topic,
            timestamp: Date.now(),
        };
        
        return questions;
    }

    /**
     * Pre-generate questions before game starts
     * Call this when a room is created to have questions ready
     */
    async preGenerateQuestions(): Promise<void> {
        try {
            console.log('[GeminiService] Pre-generating questions for upcoming game...');
            await this.getOrGenerateQuestions();
        } catch (error) {
            console.warn('[GeminiService] Pre-generation failed, will fallback to static questions:', error);
        }
    }

    private isCacheValid(): boolean {
        if (!this.cache) return false;
        if (this.cache.topic !== this.topic) return false;
        return Date.now() - this.cache.timestamp < this.CACHE_DURATION_MS;
    }

    private buildPrompt(): string {
        return `Generate ${this.questionCount} multiple-choice quiz questions about "${this.topic}".

IMPORTANT REQUIREMENTS:
1. Each question must have exactly 4 options labeled A, B, C, D
2. Only ONE correct answer per question
3. Questions must be clear, factual, and unambiguous
4. Mix difficulty levels (easy, medium, hard)
5. Avoid controversial or subjective topics
6. Questions should be educational and interesting

Respond ONLY with valid JSON in this EXACT format (no markdown, no explanation):
[
  {
    "text": "Question text here?",
    "options": {
      "A": "Option A text",
      "B": "Option B text",
      "C": "Option C text",
      "D": "Option D text"
    },
    "correct": "B",
    "category": "${this.topic}"
  }
]

Do NOT include:
- Question IDs (they will be assigned automatically)
- Any text before or after the JSON array
- Markdown code blocks
- Explanations or comments`;
    }

    private parseResponse(text: string): ServerQuestion[] {
        try {
            // Clean the response
            let jsonText = text.trim();
            
            // Remove markdown code blocks if present
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/gi, '').replace(/```/g, '');
            }
            
            // Remove any leading/trailing non-JSON text
            const startIndex = jsonText.indexOf('[');
            const endIndex = jsonText.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1) {
                jsonText = jsonText.substring(startIndex, endIndex + 1);
            }
            
            const parsed = JSON.parse(jsonText);
            
            if (!Array.isArray(parsed)) {
                throw new Error('Response is not an array');
            }
            
            // Validate and sanitize each question
            const validatedQuestions = parsed.map((q: unknown, index: number) => 
                this.validateAndSanitizeQuestion(q, index)
            );
            
            return validatedQuestions;
            
        } catch (error) {
            console.error('[GeminiService] Failed to parse response:', error);
            console.error('[GeminiService] Raw response text:', text.substring(0, 500));
            throw new Error('Failed to parse Gemini response as valid questions');
        }
    }

    private validateAndSanitizeQuestion(q: unknown, index: number): ServerQuestion {
        if (!q || typeof q !== 'object') {
            throw new Error(`Question ${index + 1} is not a valid object`);
        }
        
        const question = q as Record<string, unknown>;
        
        // Validate text
        if (!question.text || typeof question.text !== 'string' || question.text.trim().length === 0) {
            throw new Error(`Question ${index + 1} has invalid or missing text`);
        }
        
        // Validate options
        if (!question.options || typeof question.options !== 'object') {
            throw new Error(`Question ${index + 1} has invalid or missing options`);
        }
        
        const options = question.options as Record<string, unknown>;
        const validOptionKeys = ['A', 'B', 'C', 'D'];
        
        for (const key of validOptionKeys) {
            if (!options[key] || typeof options[key] !== 'string') {
                throw new Error(`Question ${index + 1} has invalid option ${key}`);
            }
            // Sanitize option text
            options[key] = String(options[key]).trim();
        }
        
        // Validate correct answer
        if (!question.correct || typeof question.correct !== 'string') {
            throw new Error(`Question ${index + 1} has invalid or missing correct answer`);
        }
        
        const correctAnswer = String(question.correct).toUpperCase().trim();
        if (!validOptionKeys.includes(correctAnswer)) {
            throw new Error(`Question ${index + 1} has invalid correct answer: ${correctAnswer}`);
        }
        
        // Sanitize and return the question
        return {
            id: 0, // Will be assigned later
            text: String(question.text).trim(),
            options: [
                { id: 'A', text: String(options.A).trim() },
                { id: 'B', text: String(options.B).trim() },
                { id: 'C', text: String(options.C).trim() },
                { id: 'D', text: String(options.D).trim() },
            ],
            correct: correctAnswer as 'A' | 'B' | 'C' | 'D',
            category: String(question.category || this.topic).trim(),
        };
    }

    private getNextQuestionId(): number {
        // Generate a unique ID based on timestamp and counter
        const id = Date.now() * 1000 + this.questionIdCounter;
        this.questionIdCounter = (this.questionIdCounter + 1) % 1000;
        
        // Ensure uniqueness
        while (this.usedQuestionIds.has(id)) {
            this.questionIdCounter++;
            const newId = Date.now() * 1000 + this.questionIdCounter;
            if (newId > id) {
                this.usedQuestionIds.add(newId);
                return newId;
            }
        }
        
        this.usedQuestionIds.add(id);
        return id;
    }

    /**
     * Update topic at runtime
     * Invalidates cache when topic changes
     */
    updateTopic(newTopic: string): void {
        if (newTopic && newTopic !== this.topic) {
            console.log(`[GeminiService] Topic updated: "${this.topic}" -> "${newTopic}"`);
            this.topic = newTopic;
            this.cache = null; // Invalidate cache
        }
    }

    /**
     * Update question count
     */
    updateQuestionCount(count: number): void {
        if (count > 0 && count !== this.questionCount) {
            console.log(`[GeminiService] Question count updated: ${this.questionCount} -> ${count}`);
            this.questionCount = count;
            this.cache = null; // Invalidate cache
        }
    }

    getTopic(): string {
        return this.topic;
    }

    getQuestionCount(): number {
        return this.questionCount;
    }

    /**
     * Clear the question cache
     */
    clearCache(): void {
        this.cache = null;
        console.log('[GeminiService] Cache cleared');
    }

    /**
     * Health check - verify API key is valid
     */
    async healthCheck(): Promise<boolean> {
        try {
            const result = await this.model.generateContent('Say "OK" if you can read this.');
            const response = await result.response;
            return response.text().includes('OK');
        } catch {
            return false;
        }
    }
}

// Singleton instance
let geminiServiceInstance: GeminiService | null = null;

export function initializeGeminiService(config: GeminiConfig): GeminiService {
    geminiServiceInstance = new GeminiService(config);
    return geminiServiceInstance;
}

export function getGeminiService(): GeminiService | null {
    return geminiServiceInstance;
}

export function isGeminiEnabled(): boolean {
    return geminiServiceInstance !== null;
}