import { drizzle } from 'drizzle-orm/d1';

export function createDb(database: D1Database) {
  return drizzle(database);
}
