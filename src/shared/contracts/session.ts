// Public API request contracts (plan §4.1, §4.2). Response shapes are documented in plan.md
// and not re-typed here — they're built directly from repository/service return types.
import { z } from "zod";
import { CLIENT_EVENT_TYPES, EVENT_CAPS } from "@/shared/constants/session";

export const clientEventSchema = z.object({
  seq: z.number().int().min(1),
  type: z.enum(CLIENT_EVENT_TYPES),
  positionSec: z.number().finite().min(0),
  clientAt: z.string().optional(),
});

export const postEventsBodySchema = z
  .object({ events: z.array(clientEventSchema).min(1).max(EVENT_CAPS.MAX_EVENTS_PER_REQUEST) })
  .refine((b) => b.events.every((e, i) => i === 0 || e.seq > b.events[i - 1].seq), {
    message: "events[].seq must be strictly increasing",
    path: ["events"],
  });
export type PostEventsBody = z.infer<typeof postEventsBodySchema>;

export const createSessionBodySchema = z.object({ videoId: z.string().min(1) });
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

export const answerBodySchema = z.object({
  questionId: z.string().min(1),
  choice: z.string().min(1),
});
export type AnswerBody = z.infer<typeof answerBodySchema>;
