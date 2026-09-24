// Admin auth API contracts (plan §4.4).
import { z } from "zod";

export const adminLoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type AdminLoginBody = z.infer<typeof adminLoginBodySchema>;

export interface AdminMeResponse {
  id: string;
  email: string;
}
