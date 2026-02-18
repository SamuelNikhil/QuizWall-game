// ==========================================
// Groq Service — AI Question Generation
// Server-side only for API key security
// ==========================================

import type { ServerQuestion } from '../shared/types';

interface GroqConfig {
    apiKey: string;
    model: string;
    topic: string;
    questionCount: number;
}

interface GroqResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

export class GroqService {
    private apiKey: string;
    private model: string;
    private topic: string;
    private questionCount: number;
    private questionIdCounter: number = 1;

    constructor(config: GroqConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.topic = config.topic;
        this.questionCount = config.questionCount;
        
        console.log(`[GroqService] Initialized with model: ${config.model}, topic: ${config.topic}`);
    }

    /**
     * Generate fresh questions for a new game session
     */
    async generateQuestionsForSession(): Promise<ServerQuestion[]> {
        try {
            console.log(`[GroqService] Generating ${this.questionCount} fresh questions for topic: ${this.topic}`);
            
            const prompt = this.buildPrompt();
            
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
                    temperature: 0.7,
                    max_tokens: 2048,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as GroqResponse;
            const text = data.choices[0]?.message?.content || '';
            
            const questions = this.parseResponse(text);
            
            // Assign unique IDs
            const questionsWithIds = questions.map(q => ({
                ...q,
                id: this.getNextQuestionId(),
            }));
            
            console.log(`[GroqService] Successfully generated ${questionsWithIds.length} questions`);
            return questionsWithIds;
            
        } catch (error) {
            console.error('[GroqService] Error generating questions:', error);
            throw new Error(`Failed to generate questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private buildPrompt(): string {
        return `Generate ${this.questionCount} multiple-choice quiz questions about "${this.topic}".

CRITICAL ACCURACY REQUIREMENTS:
1. Each question must be FACTUALLY ACCURATE and historically correct
2. Each question must have exactly 4 options labeled A, B, C, D
3. Only ONE correct answer per question - verify the correct answer is accurate
4. Questions must be clear, specific, and based on verified historical facts
5. Include specific dates, names, and events where applicable
6. Avoid ambiguous or debatable questions
7. Ensure all options are plausible but only one is definitively correct

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
            // Clean up the response
            let jsonText = text.trim();
            
            // Remove markdown code blocks if present
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/gi, '').replace(/```/g, '');
            }
            
            // Extract JSON array
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
            
            // Validate and sanitize each question
            return parsed.map(q => this.validateAndSanitizeQuestion(q));
            
        } catch (error) {
            console.error('[GroqService] Failed to parse response:', text);
            throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private validateAndSanitizeQuestion(q: any): ServerQuestion {
        // Ensure required fields exist
        const text = q.text || 'Question text missing';
        const options = q.options || {};
        const correct = q.correct || 'A';
        const category = q.category || this.topic;
        
        // Ensure options has all required keys
        const optionEntries = [
            { key: 'A', text: options.A || options.a || 'Option A' },
            { key: 'B', text: options.B || options.b || 'Option B' },
            { key: 'C', text: options.C || options.c || 'Option C' },
            { key: 'D', text: options.D || options.d || 'Option D' },
        ];
        
        // Find the correct answer text
        const correctKey = ['A', 'B', 'C', 'D'].includes(correct.toUpperCase()) ? correct.toUpperCase() : 'A';
        const correctText = optionEntries.find(e => e.key === correctKey)?.text || optionEntries[0].text;
        
        // Shuffle the options randomly
        const shuffled = [...optionEntries].sort(() => Math.random() - 0.5);
        
        // Reassign keys A, B, C, D to shuffled options
        const sanitizedOptions: Record<string, string> = {};
        let newCorrectKey = 'A';
        
        ['A', 'B', 'C', 'D'].forEach((key, index) => {
            sanitizedOptions[key] = shuffled[index].text;
            if (shuffled[index].text === correctText) {
                newCorrectKey = key;
            }
        });
        
        return {
            id: 0, // Will be assigned later
            text,
            options: sanitizedOptions as any,
            correct: newCorrectKey,
            category,
        };
    }

    private getNextQuestionId(): number {
        return this.questionIdCounter++;
    }

    getTopic(): string {
        return this.topic;
    }

    updateTopic(newTopic: string): void {
        this.topic = newTopic;
        this.questionIdCounter = 1;
        console.log(`[GroqService] Topic updated to: ${newTopic}`);
    }
}

// Singleton instance
let groqService: GroqService | null = null;

export function initializeGroqService(config: { apiKey: string; model: string; topic: string; questionCount: number }): void {
    if (!config.apiKey) {
        console.log('[GroqService] No API key provided, service not initialized');
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
