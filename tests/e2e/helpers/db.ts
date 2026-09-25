// Read-only verification against the same e2e.db file the app server writes to, for internal
// fields the public API never exposes (e.g. `flagged` — there is no admin API to read it yet).
// Raw @libsql/client rather than the generated Prisma client: the "prisma-client" generator
// output is ESM-only and doesn't load under Playwright's test transform. A second connection is
// safe for reads under sqlite's file locking; retry on rare SQLITE_BUSY from the app server's own
// writes landing at the same instant.
import path from "node:path";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env.e2e") });

function client() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) {
    throw new Error("tests/e2e/helpers/db.ts needs DATABASE_URL=file:... in the test process env");
  }
  return createClient({ url });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 20): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const busy = err instanceof Error && /busy|locked/i.test(err.message);
      if (!busy || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw new Error("unreachable");
}

export interface SessionFlags {
  flagged: boolean;
  softRejectCount: number;
  state: string;
  playedWallSec: number;
  furthestSec: number;
  bankSec: number;
}

export async function readSessionFlags(sessionId: string): Promise<SessionFlags> {
  return withRetry(async () => {
    const db = client();
    try {
      const res = await db.execute({
        sql: "SELECT flagged, softRejectCount, state, playedWallSec, furthestSec, bankSec FROM WatchSession WHERE id = ?",
        args: [sessionId],
      });
      if (res.rows.length === 0) throw new Error(`no WatchSession row for id ${sessionId}`);
      const row = res.rows[0];
      return {
        flagged: Number(row.flagged) === 1,
        softRejectCount: Number(row.softRejectCount),
        state: String(row.state),
        playedWallSec: Number(row.playedWallSec),
        furthestSec: Number(row.furthestSec),
        bankSec: Number(row.bankSec),
      };
    } finally {
      db.close();
    }
  });
}

export async function countLedgerRows(userId: string, videoId: string): Promise<number> {
  return withRetry(async () => {
    const db = client();
    try {
      const res = await db.execute({
        sql: "SELECT COUNT(*) as c FROM PointsLedger WHERE userId = ? AND videoId = ?",
        args: [userId, videoId],
      });
      return Number(res.rows[0].c);
    } finally {
      db.close();
    }
  });
}
