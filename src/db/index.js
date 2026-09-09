const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  // Per-connection PRAGMAs — not schema state, so these run on every open
  // rather than living in a one-time migration file (and journal_mode
  // can't be changed from inside a transaction, which migrations run in).
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename));

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const markApplied = db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      markApplied.run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }
}

module.exports = { createDb };
