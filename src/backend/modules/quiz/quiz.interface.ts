import type { AuditContext } from "@/backend/common/audit/audit-log";

export interface PublicChoice {
  label: string;
  text: string;
}

/** Public shape — `correctChoice` never leaves the server (plan §3). */
export interface PublicQuestion {
  id: string;
  triggerSec: number;
  prompt: string;
  choices: PublicChoice[];
}

export interface AnswerQuestion {
  id: string;
  videoId: string;
  correctChoice: string;
  labels: string[];
}

/** The admin-facing row — includes `correctChoice` (plan §4.5). */
export interface AdminQuestionRow {
  id: string;
  videoId: string;
  triggerSec: number;
  prompt: string;
  correctChoice: string;
  choices: PublicChoice[];
}

export interface CreateQuestionInput {
  videoId: string;
  triggerSec: number;
  prompt: string;
  correctChoice: string;
  choices: PublicChoice[];
}

/** Only the fields an admin can ever PATCH — the service layer still enforces the locked set
 * (plan §7) before calling this. */
export interface UpdateQuestionInput {
  triggerSec?: number;
  prompt?: string;
  correctChoice?: string;
  choices?: PublicChoice[];
}

export interface QuizRepository {
  /** Ordered by triggerSec ascending (plan §3: `order = ascending triggerSec`). */
  listForVideo(videoId: string): Promise<PublicQuestion[]>;
  findForAnswer(questionId: string): Promise<AnswerQuestion | null>;

  findAdminById(questionId: string): Promise<AdminQuestionRow | null>;
  /** Duplicate (videoId, triggerSec) surfaces as the DB's own unique-constraint violation
   * (Prisma P2002) — the service maps that to 409 DUPLICATE_TRIGGER, same pattern as the video
   * module's duplicate-youtubeId handling. */
  create(input: CreateQuestionInput, audit: AuditContext): Promise<AdminQuestionRow>;
  /** `requireUnlocked`: true when this update touches a locked-sensitive field (triggerSec,
   * correctChoice, or an add/remove of a choice label) — gated on a conditional write so a
   * session created between the service's lock check and this write can't slip through (review
   * round 2 MINOR 3). `null` means the gate failed (now locked). */
  update(id: string, input: UpdateQuestionInput, audit: AuditContext, requireUnlocked: boolean): Promise<AdminQuestionRow | null>;
  /** Always gated the same way — delete has no "always allowed" subset of fields. `false` means the gate failed (now locked). */
  delete(id: string, audit: AuditContext): Promise<boolean>;
}
