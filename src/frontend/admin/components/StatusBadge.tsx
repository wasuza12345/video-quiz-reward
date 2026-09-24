import { Badge } from "@/frontend/shared/ui/Badge";
import { videos as copy } from "../constants/copy.th";
import type { VideoStatus } from "@/shared/constants/video";

const TONE: Record<VideoStatus, "success" | "warning" | "neutral"> = {
  published: "success",
  draft: "warning",
  archived: "neutral",
};

export function StatusBadge({ status }: { status: VideoStatus }) {
  return <Badge tone={TONE[status]}>{copy.statusBadge[status]}</Badge>;
}
