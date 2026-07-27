require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl:
      process.env.POSTGRES_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();

    const before = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state = 'idle')::int AS idle,
             count(*) FILTER (WHERE state = 'active')::int AS active
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
    `);
    console.log('before', before.rows[0]);

    const killed = await client.query(`
      SELECT pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND usename = current_user
        AND state IN (
          'idle',
          'idle in transaction',
          'idle in transaction (aborted)'
        )
    `);
    console.log('terminated_idle', killed.rowCount);

    const after = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state = 'idle')::int AS idle,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    console.log('after', after.rows[0]);
  } catch (e) {
    console.error('FAIL', e.code || '', e.message);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
})();
