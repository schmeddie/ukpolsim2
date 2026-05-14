const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'game.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS player (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      party TEXT NOT NULL,
      constituency TEXT NOT NULL,
      backstory_id TEXT NOT NULL,
      backstory_text TEXT NOT NULL,
      bio TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      current_date TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      scenario_name TEXT NOT NULL,
      pm_name TEXT NOT NULL,
      pm_party TEXT NOT NULL,
      government_majority INTEGER NOT NULL DEFAULT 0,
      day_number INTEGER NOT NULL DEFAULT 1,
      CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS mps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      party TEXT NOT NULL,
      constituency TEXT NOT NULL,
      region TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Backbencher',
      backstory TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER NOT NULL,
      is_player INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_date TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      email_type TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      event_type TEXT NOT NULL,
      is_generated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_date TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      category TEXT NOT NULL
    );
  `);
}

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  return result;
}

module.exports = { getDb, getSetting, setSetting, getAllSettings };
