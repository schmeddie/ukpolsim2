const { Database } = require('node-sqlite3-wasm');
const path = require('path');

const DB_PATH = path.join(__dirname, 'game.db');

let db;

function getDb() {
  if (!db) {
    // Clean up stale lock directory left by a hard-killed process
    const lockDir = DB_PATH + '.lock';
    try {
      if (require('fs').existsSync(lockDir)) {
        require('fs').rmdirSync(lockDir, { recursive: true });
      }
    } catch {}
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    initSchema();
  }
  return db;
}

// Ensure DB is properly closed on exit so no stale locks are left
process.on('exit', () => { try { db && db.close(); } catch {} });
process.on('SIGINT', () => { try { db && db.close(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { db && db.close(); } catch {} process.exit(0); });

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
      approval_rating INTEGER NOT NULL DEFAULT 50,
      party_standing INTEGER NOT NULL DEFAULT 50,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      game_date TEXT NOT NULL,
      game_time TEXT NOT NULL DEFAULT '07:00',
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
      delivery_time TEXT NOT NULL DEFAULT '07:00',
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      email_type TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      thread_id INTEGER,
      is_player INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_date TEXT NOT NULL,
      event_time TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      outcome TEXT,
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

    CREATE TABLE IF NOT EXISTS player_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_date TEXT NOT NULL,
      memory_text TEXT NOT NULL
    );
  `);

  // Auto-migrate schema for new features on existing databases
  try { db.exec("ALTER TABLE game_state ADD COLUMN game_time TEXT NOT NULL DEFAULT '07:00'"); } catch(e){}
  try { db.exec("ALTER TABLE calendar_events ADD COLUMN event_time TEXT"); } catch(e){}
  try { db.exec("ALTER TABLE calendar_events ADD COLUMN status TEXT DEFAULT 'pending'"); } catch(e){}
  try { db.exec("ALTER TABLE calendar_events ADD COLUMN outcome TEXT"); } catch(e){}
  try { db.exec("ALTER TABLE emails ADD COLUMN delivery_time TEXT DEFAULT '07:00'"); } catch(e){}
  try { db.exec("ALTER TABLE emails ADD COLUMN thread_id INTEGER"); } catch(e){}
  try { db.exec("ALTER TABLE emails ADD COLUMN is_player INTEGER NOT NULL DEFAULT 0"); } catch(e){}
  try { db.exec("ALTER TABLE news_items ADD COLUMN body TEXT"); } catch(e){}
  try { db.exec("ALTER TABLE mps ADD COLUMN profile_text TEXT"); } catch(e){}
  try { db.exec("ALTER TABLE player ADD COLUMN approval_rating INTEGER NOT NULL DEFAULT 50"); } catch(e){}
  try { db.exec("ALTER TABLE player ADD COLUMN party_standing INTEGER NOT NULL DEFAULT 50"); } catch(e){}
}

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get([key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run([key, value]);
}

function getAllSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  return result;
}

module.exports = { getDb, getSetting, setSetting, getAllSettings };
