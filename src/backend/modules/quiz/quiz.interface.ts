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

export interface QuizRepository {
  /** Ordered by triggerSec ascending (plan §3: `order = ascending triggerSec`). */
  listForVideo(videoId: string): Promise<PublicQuestion[]>;
  findForAnswer(questionId: string): Promise<AnswerQuestion | null>;
}
