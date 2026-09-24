import { Badge } from "@/frontend/shared/ui/Badge";
import { sessions as copy } from "../constants/copy.th";

export function EventTypeChip({ type }: { type: string }) {
  const label = copy.eventType[type as keyof typeof copy.eventType] ?? type;
  return <Badge tone="neutral">{label}</Badge>;
}
