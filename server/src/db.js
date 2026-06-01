// One shared Postgres pool for the whole API.
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Tiny query helper: q('select * from orders where id=$1', [id])
export const q = (text, params) => pool.query(text, params);
