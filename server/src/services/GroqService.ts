// ==========================================
// Groq Service — AI Question Generation
// Server-side only for API key security
// Per-topic generation with cache (30min TTL)
// ==========================================

import type { ServerQuestion, QuizTopicId } from '../shared/types';

interface GroqConfig {
    apiKey: string;
    model: string;
    questionCount: number;
}

interface GroqResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface TopicCacheEntry {
    questions: ServerQuestion[];
    generatedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const topicCache = new Map<QuizTopicId, TopicCacheEntry>();
let globalQuestionIdCounter = 1;

function getNextQuestionId(): number {
    return globalQuestionIdCounter++;
}

export class GroqService {
    private apiKey: string;
    private model: string;
    private questionCount: number;

    constructor(config: GroqConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.questionCount = config.questionCount;

        console.log(`[GroqService] Initialized with model: ${config.model}`);
    }

    private async fetchWithRetry(url: string, options: RequestInit, maxRetries: number = 2): Promise<GroqResponse> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);

            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    const errorText = await response.text();
                    if (response.status === 429 && attempt < maxRetries) {
                        console.warn(`[GroqService] Rate limited (429), retrying attempt ${attempt}/${maxRetries}...`);
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                        lastError = new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorText}`);
                        continue;
                    }
                    throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const data = await response.json() as GroqResponse;
                return data;

            } catch (error) {
                clearTimeout(timeout);

                if (attempt < maxRetries) {
                    console.warn(`[GroqService] Request failed (attempt ${attempt}/${maxRetries}), retrying:`, error instanceof Error ? error.message : error);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    lastError = error instanceof Error ? error : new Error(String(error));
                    continue;
                }

                throw error;
            }
        }

        throw lastError || new Error('All retries exhausted');
    }

    async generateQuestionsForTopic(topicId: QuizTopicId, excludeQuestions?: string[]): Promise<ServerQuestion[]> {
        const cached = topicCache.get(topicId);
        if (cached && (Date.now() - cached.generatedAt < CACHE_TTL_MS)) {
            console.log(`[GroqService] Cache hit for topic "${topicId}" (${cached.questions.length} questions, age: ${Math.round((Date.now() - cached.generatedAt) / 60000)}min)`);
            // Assign fresh IDs from the global counter
            return cached.questions.map(q => ({
                ...q,
                id: getNextQuestionId(),
            }));
        }

        const topicLabel = this.getTopicLabel(topicId);

        try {
            const prompt = this.buildPrompt(topicLabel, excludeQuestions);

            const data = await this.fetchWithRetry(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a quiz question generator. Respond only with valid JSON.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0.9,
                        max_tokens: 4096,
                    }),
                }
            );
            const text = data.choices[0]?.message?.content || '';

            const questions = this.parseResponse(text, topicId);

            const questionsWithIds = questions.map(q => ({
                ...q,
                id: getNextQuestionId(),
            }));

            // Cache the questions for this topic
            topicCache.set(topicId, {
                questions: questionsWithIds.map(q => ({ ...q })),
                generatedAt: Date.now(),
            });

            console.log(`[GroqService] Generated & cached ${questionsWithIds.length} questions for topic "${topicId}"`);
            return questionsWithIds;

        } catch (error) {
            console.error('[GroqService] Error generating questions:', error);
            throw new Error(`Failed to generate questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private getTopicLabel(topicId: QuizTopicId): string {
        const labels: Record<QuizTopicId, string> = {
            'animal-kingdom': 'Animal Kingdom',
            'science-space': 'Science & Space',
            'world-history': 'World History',
            'literature-arts': 'Literature & Arts',
            'geography-culture': 'Geography & Culture',
        };
        return labels[topicId] || topicId;
    }

    private buildPrompt(topicLabel: string, excludeQuestions?: string[]): string {
        const randomSeed = Math.random().toString(36).substring(2, 10);
        const timeSeed = Date.now().toString(36).substring(2, 8);

        let exclusionBlock = '';
        if (excludeQuestions && excludeQuestions.length > 0) {
            const truncated = excludeQuestions.slice(0, 20);
            exclusionBlock = `\n\nDO NOT generate any of these questions (they were already used in other active sessions):\n${truncated.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nGenerate COMPLETELY DIFFERENT questions from the ones listed above.`;
        }

        return `Generate ${this.questionCount} multiple-choice quiz questions about "${topicLabel}".

UNIQUE GENERATION SEED: ${randomSeed}-${timeSeed}
Use this seed to ensure you generate COMPLETELY DIFFERENT questions from any previous requests.

CRITICAL REQUIREMENTS:
1. Each question must be FACTUALLY ACCURATE and historically correct
2. Each question must have exactly 4 options labeled A, B, C, D
3. Only ONE correct answer per question - verify the correct answer is accurate
4. Questions must be clear, specific, and based on verified facts
5. Include specific dates, names, and events where applicable
6. Avoid ambiguous or debatable questions
7. Ensure all options are plausible but only one is definitively correct
8. Generate COMPLETELY DIFFERENT questions - do NOT repeat common/popular questions
9. Cover diverse sub-topics within "${topicLabel}" - don't focus on the same events/people
10. Be creative and explore lesser-known but interesting facts

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
    "category": "${topicLabel}"
  }
]

Do NOT include:
- Question IDs (they will be assigned automatically)
- Any text before or after the JSON array
- Markdown code blocks
- Explanations or comments${exclusionBlock}`;
    }

    private parseResponse(text: string, topicId: QuizTopicId): ServerQuestion[] {
        try {
            let jsonText = text.trim();

            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/gi, '').replace(/```/g, '');
            }

            const startIndex = jsonText.indexOf('[');
            const endIndex = jsonText.lastIndexOf(']');

            if (startIndex === -1 || endIndex === -1) {
                throw new Error('Could not find JSON array in response');
            }

            jsonText = jsonText.substring(startIndex, endIndex + 1);

            const parsed = JSON.parse(jsonText);

            if (!Array.isArray(parsed)) {
                throw new Error('Parsed response is not an array');
            }

            return parsed.map(q => this.validateAndSanitizeQuestion(q, topicId));

        } catch (error) {
            console.error('[GroqService] Failed to parse response:', text);
            throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private validateAndSanitizeQuestion(q: any, topicId: QuizTopicId): ServerQuestion {
        const text = q.text || 'Question text missing';
        const options = q.options || {};
        const correct = q.correct || 'A';
        const category = q.category || this.getTopicLabel(topicId);

        const optionEntries = [
            { key: 'A', text: options.A || options.a || 'Option A' },
            { key: 'B', text: options.B || options.b || 'Option B' },
            { key: 'C', text: options.C || options.c || 'Option C' },
            { key: 'D', text: options.D || options.d || 'Option D' },
        ];

        const correctKey = ['A', 'B', 'C', 'D'].includes(correct.toUpperCase()) ? correct.toUpperCase() : 'A';
        const correctText = optionEntries.find(e => e.key === correctKey)?.text || optionEntries[0].text;

        const shuffled = [...optionEntries].sort(() => Math.random() - 0.5);

        const sanitizedOptions: Record<string, string> = {};
        let newCorrectKey = 'A';

        ['A', 'B', 'C', 'D'].forEach((key, index) => {
            sanitizedOptions[key] = shuffled[index].text;
            if (shuffled[index].text === correctText) {
                newCorrectKey = key;
            }
        });

        return {
            id: 0,
            text,
            options: sanitizedOptions as any,
            correct: newCorrectKey,
            category,
        };
    }

    setQuestionCount(count: number): void {
        this.questionCount = count;
    }

    getQuestionCount(): number {
        return this.questionCount;
    }
}

let groqService: GroqService | null = null;

export function initializeGroqService(config: { apiKey: string; model: string; questionCount: number }): void {
    if (!config.apiKey) {
        return;
    }

    groqService = new GroqService(config);
}

export function getGroqService(): GroqService | null {
    return groqService;
}

export function isGroqEnabled(): boolean {
    return groqService !== null;
}