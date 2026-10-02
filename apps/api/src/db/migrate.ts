import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../db.js';

const migrationsDir = join(process.cwd(), '../../database/migrations');

await pool.query(`
  create table if not exists schema_migrations (
    version varchar(255) primary key,
    applied_at timestamptz not null default now()
  )
`);

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort();

for (const file of files) {
  const exists = await pool.query('select 1 from schema_migrations where version = $1', [file]);
  if (exists.rowCount) continue;

  const sql = await readFile(join(migrationsDir, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations(version) values ($1)', [file]);
    await client.query('commit');
    console.log(`Applied ${file}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
