import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'socket.db');

export const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    voltage REAL,
    current REAL,
    power REAL,
    temperature REAL,
    relay_state INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    severity TEXT,
    message TEXT,
    details TEXT
  );
`);

// Default settings
const defaultSettings = {
  max_power_w: 2300,
  warn_power_pct: 80,
  warn_temp_c: 55,
  max_temp_c: 70
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, JSON.stringify(value));
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return { ...defaultSettings, ...settings };
}

export function updateSettings(newSettings) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const updateMany = db.transaction((settingsObj) => {
    for (const [key, val] of Object.entries(settingsObj)) {
      upsert.run(key, JSON.stringify(Number(val)));
    }
  });
  updateMany(newSettings);
  return getSettings();
}

export function recordReading(reading) {
  const stmt = db.prepare(`
    INSERT INTO readings (voltage, current, power, temperature, relay_state)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    reading.voltage,
    reading.current,
    reading.power,
    reading.temperature,
    reading.relay_state ? 1 : 0
  );
}

export function recordEvent(type, severity, message, details = '') {
  const stmt = db.prepare(`
    INSERT INTO events (type, severity, message, details)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(type, severity, message, typeof details === 'object' ? JSON.stringify(details) : String(details));
}

export function getReadings(limit = 100) {
  return db.prepare('SELECT * FROM readings ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

export function getEvents(limit = 50) {
  return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
}
