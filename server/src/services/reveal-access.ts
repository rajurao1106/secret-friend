import { and, eq, or } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { reveals } from '../schema/reveals.js';

export async function hasReveal(
  db: AppDatabase,
  userA: string,
  userB: string,
): Promise<boolean> {
  const [reveal] = await db
    .select({ id: reveals.id })
    .from(reveals)
    .where(
      or(
        and(eq(reveals.userA, userA), eq(reveals.userB, userB)),
        and(eq(reveals.userA, userB), eq(reveals.userB, userA)),
      ),
    )
    .limit(1);

  return reveal !== undefined;
}
