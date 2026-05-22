// ==========================================
// SQLite Database — Data Layer (sql.js)
// Pure JavaScript SQLite — no native compilation needed
// ==========================================

import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CONFIG } from '../infrastructure/config.ts';

let db: Database;
let saveTimeout: NodeJS.Timeout | null = null;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  // Ensure database directory exists
  const dbDir = dirname(CONFIG.DB_PATH);
  if (!existsSync(dbDir)) {
    console.log('[DB] Creating database directory:', dbDir);
    mkdirSync(dbDir, { recursive: true });
  }

  // Load existing database file if it exists
  if (existsSync(CONFIG.DB_PATH)) {
    const buffer = readFileSync(CONFIG.DB_PATH);
    db = new SQL.Database(buffer);
    console.log('[DB] Loaded existing database from:', CONFIG.DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database at:', CONFIG.DB_PATH);
  }

  // Create tables
  // Players table - stores individual player high scores
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      highest_score INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Teams table - stores team high scores
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      total_score INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Game sessions table - stores individual game session records
  db.run(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      questions_answered INTEGER NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'easy',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );
  `);

  // Migrate: add topic/difficulty columns if missing (existing dbs)
  try { db.run('ALTER TABLE game_sessions ADD COLUMN topic TEXT NOT NULL DEFAULT ""'); } catch {}
  try { db.run('ALTER TABLE game_sessions ADD COLUMN difficulty TEXT NOT NULL DEFAULT "easy"'); } catch {}

  // Create index for faster client_id lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_players_client_id ON players(client_id)
  `);

  // Create index for faster name lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_players_name ON players(name)
  `);

  // Create index for teams name lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name)
  `);

  saveDatabase();
  console.log('[DB] Tables initialized');
  return db;
}

/** Save database to disk (debounced) */
export function saveDatabase(): void {
  if (!db) return;
  
  // Clear any existing timeout
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // Set new timeout to save in 500ms
  saveTimeout = setTimeout(() => {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(CONFIG.DB_PATH, buffer);
    saveTimeout = null;
  }, 500);
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}
