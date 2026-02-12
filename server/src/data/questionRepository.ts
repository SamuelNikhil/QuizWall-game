// ==========================================
// Question Repository — Data Layer (sql.js)
// ==========================================

import { getDatabase, saveDatabase } from './database.ts';
import type { ServerQuestion, QuestionOption } from '../shared/types.ts';

const DEFAULT_QUESTIONS: Omit<ServerQuestion, 'id'>[] = [
    {
        text: 'What is the output of the following code?',
        code: 'console.log(typeof null);',
        options: [
            { id: 'A', text: 'null' },
            { id: 'B', text: 'object' },
            { id: 'C', text: 'undefined' },
            { id: 'D', text: 'string' },
        ],
        correct: 'B',
    },
    {
        text: 'Which method removes the last element from an array?',
        code: 'const arr = [1, 2, 3];\narr.???();',
        options: [
            { id: 'A', text: 'shift()' },
            { id: 'B', text: 'pop()' },
            { id: 'C', text: 'slice()' },
            { id: 'D', text: 'splice()' },
        ],
        correct: 'B',
    },
    {
        text: 'What does "===" check in JavaScript?',
        code: "1 === '1'",
        options: [
            { id: 'A', text: 'Value only' },
            { id: 'B', text: 'Type only' },
            { id: 'C', text: 'Value and Type' },
            { id: 'D', text: 'Reference' },
        ],
        correct: 'C',
    },
    {
        text: 'What will be logged?',
        code: 'console.log(0.1 + 0.2 === 0.3);',
        options: [
            { id: 'A', text: 'true' },
            { id: 'B', text: 'false' },
            { id: 'C', text: 'undefined' },
            { id: 'D', text: 'NaN' },
        ],
        correct: 'B',
    },
    {
        text: 'Which is NOT a JavaScript data type?',
        code: 'let x = ???;',
        options: [
            { id: 'A', text: 'Symbol' },
            { id: 'B', text: 'BigInt' },
            { id: 'C', text: 'Float' },
            { id: 'D', text: 'undefined' },
        ],
        correct: 'C',
    },
];

/** Seed default questions if the table is empty */
export function seedQuestions(): void {
    const db = getDatabase();

    const result = db.exec('SELECT COUNT(*) as c FROM questions');
    const count = result.length > 0 ? (result[0].values[0][0] as number) : 0;

    if (count === 0) {
        const stmt = db.prepare(
            'INSERT INTO questions (text, code, options, correct, category) VALUES (?, ?, ?, ?, ?)'
        );

        for (const q of DEFAULT_QUESTIONS) {
            stmt.run([q.text, q.code || null, JSON.stringify(q.options), q.correct, 'javascript']);
        }
        stmt.free();
        saveDatabase();
        console.log(`[DB] Seeded ${DEFAULT_QUESTIONS.length} default questions`);
    } else {
        console.log(`[DB] Questions table already has ${count} entries, skipping seed`);
    }
}

/** Get all questions from database */
export function getAllQuestions(): ServerQuestion[] {
    const db = getDatabase();
    const result = db.exec('SELECT id, text, code, options, correct, category FROM questions');

    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });

        return {
            id: obj.id as number,
            text: obj.text as string,
            code: (obj.code as string) || undefined,
            options: JSON.parse(obj.options as string) as QuestionOption[],
            correct: obj.correct as string,
            category: obj.category as string,
        };
    });
}

/** Get a random subset of questions */
export function getRandomQuestions(count: number): ServerQuestion[] {
    const all = getAllQuestions();
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, Math.min(count, all.length));
}
