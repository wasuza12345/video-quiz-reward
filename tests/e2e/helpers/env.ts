// Shared between playwright.config.ts and test files so both agree on the same server address.
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// The brief video seeded by prisma/seed.ts (plan §0, §10) — duration/trigger/correct choice are
// server truth the public API never echoes back, so the honest-flow test hardcodes them here.
export const BRIEF_VIDEO_YOUTUBE_ID = "X7K_Xlz3T1Y";
export const BRIEF_VIDEO_DURATION_SEC = 44;
export const BRIEF_QUESTION_TRIGGER_SEC = 13;
export const BRIEF_QUESTION_CORRECT_CHOICE = "D";

// Extra throwaway videos seeded by tests/e2e/fixtures/extra-videos.ts.
export const CHEATS_VIDEO_YOUTUBE_ID = "e2e-cheats";
export const CHEATS_VIDEO_DURATION_SEC = 30;
export const REPLAY_VIDEO_YOUTUBE_ID = "e2e-replay";
export const REPLAY_VIDEO_DURATION_SEC = 6;
