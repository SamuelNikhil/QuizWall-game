#!/usr/bin/env node
// ==========================================
// Manual AI Question Generator (Groq)
// Run this to generate and cache questions
// Usage: npx tsx generate-ai-questions.ts
// ==========================================

import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_QUESTIONS_PATH = join(__dirname, 'src', 'data', 'Ai-questions.json');

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const TOPIC = process.env.QUIZ_TOPIC || 'General Knowledge';
const COUNT = parseInt(process.env.QUESTIONS_PER_SESSION || '10', 10);

console.log('==========================================');
console.log('AI Question Generator (Groq)');
console.log('==========================================');
console.log(`Topic: ${TOPIC}`);
console.log(`Count: ${COUNT} new questions`);
console.log(`Model: ${MODEL}`);
console.log(`API Key: ${API_KEY ? API_KEY.substring(0, 15) + '...' : 'NOT SET'}`);
console.log('');

interface CachedQuestions {
    topic: string;
    generatedAt: string;
    questions: Array<{
        id: number;
        text: string;
        options: Array<{ id: string; text: string }>;
        correct: string;
        category: string;
    }>;
}

let existingCache: CachedQuestions | null = null;
let nextId = 1;

async function generateQuestions(): Promise<void> {
    if (!API_KEY) {
        console.error('❌ ERROR: GROQ_API_KEY not set in .env file');
        process.exit(1);
    }

    // Check existing cache
    if (existsSync(AI_QUESTIONS_PATH)) {
        try {
            const content = readFileSync(AI_QUESTIONS_PATH, 'utf-8');
            existingCache = JSON.parse(content);
            
            if (existingCache && existingCache.topic === TOPIC) {
                console.log(`📦 Found existing cache with ${existingCache.questions.length} questions for topic "${TOPIC}"`);
                console.log(`➕ Will add ${COUNT} new questions to the cache`);
                nextId = existingCache.questions.length + 1;
                console.log('');
            } else {
                console.log(`🗑️  Topic changed from "${existingCache?.topic}" to "${TOPIC}"`);
                console.log('   Creating new cache...');
                existingCache = null;
                console.log('');
            }
        } catch (e) {
            console.log('⚠️  Could not read existing cache, creating new one');
            console.log('');
        }
    }

    try {
        console.log('🤖 Connecting to Groq API...');

        const prompt = `Generate ${COUNT} multiple-choice quiz questions about "${TOPIC}".

IMPORTANT REQUIREMENTS:
1. Each question must have exactly 4 options labeled A, B, C, D
2. Only ONE correct answer per question
3. Questions must be clear, factual, and unambiguous
4. Mix difficulty levels (easy, medium, hard)
5. Avoid controversial or subjective topics

Respond ONLY with valid JSON in this EXACT format:
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
    "category": "${TOPIC}"
  }
]

Do NOT include any text before or after the JSON array.`;

        console.log(`⏳ Generating ${COUNT} questions about "${TOPIC}"...`);
        console.log('   (This may take 5-15 seconds)');
        console.log('');

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
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

        const data = await response.json();
        const text = data.choices[0]?.message?.content || '';

        // Parse the response
        let jsonText = text.trim();
        if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```json?\n?/gi, '').replace(/```/g, '');
        }
        const startIndex = jsonText.indexOf('[');
        const endIndex = jsonText.lastIndexOf(']');
        if (startIndex !== -1 && endIndex !== -1) {
            jsonText = jsonText.substring(startIndex, endIndex + 1);
        }

        const questions = JSON.parse(jsonText);

        if (!Array.isArray(questions) || questions.length === 0) {
            throw new Error('Invalid response format or empty questions array');
        }

        // Add IDs and normalize format
        const formattedQuestions = questions.map((q, index) => ({
            id: nextId + index,
            text: q.text,
            options: [
                { id: 'A', text: q.options.A || q.options[0]?.text || '' },
                { id: 'B', text: q.options.B || q.options[1]?.text || '' },
                { id: 'C', text: q.options.C || q.options[2]?.text || '' },
                { id: 'D', text: q.options.D || q.options[3]?.text || '' },
            ],
            correct: q.correct,
            category: q.category || TOPIC,
        }));

        // Merge with existing questions if same topic
        const allQuestions = existingCache 
            ? [...existingCache.questions, ...formattedQuestions]
            : formattedQuestions;

        // Save to file
        const dataToSave = {
            topic: TOPIC,
            generatedAt: new Date().toISOString(),
            questions: allQuestions,
        };

        const fs = await import('fs');
        fs.writeFileSync(AI_QUESTIONS_PATH, JSON.stringify(dataToSave, null, 4), 'utf-8');

        console.log('✅ SUCCESS! Questions generated and saved.');
        console.log('');
        console.log(`📁 Saved to: ${AI_QUESTIONS_PATH}`);
        console.log(`📝 Topic: ${TOPIC}`);
        console.log(`❓ New questions added: ${formattedQuestions.length}`);
        console.log(`📊 Total questions in cache: ${allQuestions.length}`);
        console.log('');
        console.log('Sample new questions:');
        formattedQuestions.slice(0, 3).forEach((q, i) => {
            console.log(`  ${q.id}. ${q.text.substring(0, 60)}...`);
        });
        console.log('');
        console.log('🎮 The game will now use these cached AI questions!');
        console.log('   (No more API calls needed until you change the topic)');

    } catch (error: any) {
        console.error('');
        console.error('❌ ERROR:', error.message);
        if (error.message?.includes('429')) {
            console.error('');
            console.error('💡 Rate limit exceeded. Please wait a moment and try again.');
        } else if (error.message?.includes('401')) {
            console.error('');
            console.error('💡 Invalid API key. Check your GROQ_API_KEY in .env');
        }
        process.exit(1);
    }
}

generateQuestions();
