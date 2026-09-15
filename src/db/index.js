const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

/**
 * `connectionConfig` is either a Postgres connection string (production) or
 * a pre-built pg-compatible Pool (tests, via pg-mem) passed as
 * `{ pool: <Pool-like> }` so the migration/bookkeeping logic below is
 * exercised identically in both cases.
 */
async function createDb(connectionConfig) {
  const pool = connectionConfig && connectionConfig.pool
    ? connectionConfig.pool
    : new Pool({ connectionString: connectionConfig });
  await runMigrations(pool);
  return pool;
}

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)', [
          file,
          new Date().toISOString(),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

module.exports = { createDb };
