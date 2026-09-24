export { BASE_URL, BRIEF_QUESTION_CORRECT_CHOICE, BRIEF_QUESTION_TRIGGER_SEC, BRIEF_VIDEO_DURATION_SEC, BRIEF_VIDEO_YOUTUBE_ID } from "../../helpers/env";

// Seeded by scripts/e2e-server.sh's `npm run db:seed` (prisma/seed.ts).
export const ADMIN_EMAIL = "admin@e2e.local";
export const ADMIN_PASSWORD = "e2e-only-password-123456";

// A real, embeddable YouTube video distinct from the brief video (youtubeId is @unique) — used
// by the admin create-video flow. Verified embeddable via oEmbed.
export const ADMIN_TEST_VIDEO_YOUTUBE_ID = "dQw4w9WgXcQ";
