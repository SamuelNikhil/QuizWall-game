// ==========================================
// SQLite Database — Data Layer (sql.js)
// Pure JavaScript SQLite — no native compilation needed
// ==========================================

import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { CONFIG } from '../infrastructure/config.ts';

let db: Database;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (existsSync(CONFIG.DB_PATH)) {
    const buffer = readFileSync(CONFIG.DB_PATH);
    db = new SQL.Database(buffer);
    console.log('[DB] Loaded existing database from:', CONFIG.DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_score INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id),
      score INTEGER DEFAULT 0,
      questions_answered INTEGER DEFAULT 0,
      played_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      code TEXT,
      options TEXT NOT NULL,
      correct TEXT NOT NULL,
      category TEXT DEFAULT 'javascript'
    );
  `);

  saveDatabase();
  console.log('[DB] Tables initialized');
  return db;
}

/** Save database to disk */
export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(CONFIG.DB_PATH, buffer);
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}
