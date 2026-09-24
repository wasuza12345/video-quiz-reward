import { formatPoints, pointsBadge as copy } from "../constants/copy.th";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";

export interface PointsBadgeProps {
  totalPoints: number | null;
  unavailable: boolean;
}

export function PointsBadge({ totalPoints, unavailable }: PointsBadgeProps) {
  if (totalPoints === null && !unavailable) {
    return <Skeleton width={72} height={32} radius="var(--radius-pill)" />;
  }

  return (
    <span
      role="status"
      aria-label={unavailable ? undefined : copy.ariaLabel(totalPoints ?? 0)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 32,
        padding: "0 12px",
        borderRadius: "var(--radius-pill)",
        background: "var(--warning-bg)",
        color: "var(--warning)",
        fontWeight: 700,
        fontSize: "var(--fs-sm)",
      }}
    >
      <span aria-hidden="true">⭐</span>
      {unavailable ? (
        <>
          <span>{copy.unavailableVisual}</span>
          <span className="sr-only">{copy.unavailableSr}</span>
        </>
      ) : (
        <span className="tabular-nums">{formatPoints(totalPoints ?? 0)}</span>
      )}
    </span>
  );
}
