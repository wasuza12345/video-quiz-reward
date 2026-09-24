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
  create(input: CreateQuestionInput): Promise<AdminQuestionRow>;
  update(id: string, input: UpdateQuestionInput): Promise<AdminQuestionRow>;
  delete(id: string): Promise<void>;
}
