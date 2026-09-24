import { Badge } from "@/frontend/shared/ui/Badge";
import { sessions as copy } from "../constants/copy.th";

const TONE: Record<string, "neutral" | "info" | "warning" | "success"> = {
  CREATED: "neutral",
  PLAYING: "info",
  PAUSED: "neutral",
  QUIZ_PENDING: "warning",
  ENDED: "success",
};

export function SessionStateBadge({ state }: { state: string }) {
  const label = copy.stateBadge[state as keyof typeof copy.stateBadge] ?? state;
  return <Badge tone={TONE[state] ?? "neutral"}>{label}</Badge>;
}
