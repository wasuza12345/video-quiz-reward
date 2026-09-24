import { videoList as copy } from "../constants/copy.th";
import { Card } from "@/frontend/shared/ui/Card";

export interface PointsSummaryProps {
  totalPoints: number;
  rewardedCount: number;
}

export function PointsSummary({ totalPoints, rewardedCount }: PointsSummaryProps) {
  return (
    <Card padding="16px 24px">
      <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{copy.pointsSummary.label}</p>
      <p style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 700, color: "var(--brand-primary-dark)" }} className="tabular-nums">
        {totalPoints.toLocaleString("th-TH")} แต้ม
      </p>
      {rewardedCount > 0 && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{copy.pointsSummary.sub(rewardedCount)}</p>}
    </Card>
  );
}
