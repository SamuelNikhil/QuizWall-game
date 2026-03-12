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

  // Create index for faster client_id lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_players_client_id ON players(client_id)
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
