import { Badge } from "@/frontend/shared/ui/Badge";
import { sessions as copy } from "../constants/copy.th";

const FLAG_WORTHY = new Set(["SEEK_FORWARD", "SPEED_EXCEEDED", "NOT_WATCHED"]);

/** spec §5.7 — danger tone for flag-worthy reasons, neutral (+ "(ปกติ ไม่นับ)") for benign ones. */
export function RejectChip({ reason }: { reason: string }) {
  const label = copy.rejectReason[reason as keyof typeof copy.rejectReason] ?? reason;
  const flagWorthy = FLAG_WORTHY.has(reason);
  return (
    <Badge tone={flagWorthy ? "danger" : "neutral"}>
      {label} <span style={{ fontFamily: "monospace", fontSize: "var(--fs-xs)" }}>{reason}</span>
      {!flagWorthy && ` ${copy.detail.timeline.benignSuffix}`}
    </Badge>
  );
}

export { FLAG_WORTHY };
