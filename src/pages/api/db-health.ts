import { sql } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { createDb } from '../../db';

export const prerender = false;

type DbHealthRow = {
  ok: number;
};

export async function GET() {
  try {
    const db = createDb(env.DB);
    const result = await db.get<DbHealthRow>(sql`SELECT 1 AS ok`);

    return Response.json({ ok: result?.ok === 1 });
  } catch (error) {
    console.error('D1 health check failed', error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
