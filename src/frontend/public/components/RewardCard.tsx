import { watch as copy } from "../constants/copy.th";
import { Button } from "@/frontend/shared/ui/Button";

export interface RewardCardProps {
  points: number;
  totalPoints: number;
  onRewatch: () => void;
  onOtherVideos: () => void;
}

/** Reference C6 — reward banner "ยินดีด้วย +50 Points" (spec §4.3.8). */
export function RewardCard({ points, totalPoints, onRewatch, onOtherVideos }: RewardCardProps) {
  return (
    <div
      role="status"
      style={{
        background: "linear-gradient(135deg, #1A2A5E 0%, #2B4BB5 100%)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-modal)",
        padding: 24,
        color: "#fff",
        textAlign: "center",
      }}
    >
      <span className="sr-only">{copy.rewardCard.sr(points, totalPoints)}</span>
      <p aria-hidden="true" style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: 700 }}>
        <span style={{ color: "var(--gold)", fontSize: 28 }}>⭐</span> {copy.rewardCard.congrats}
      </p>
      <p aria-hidden="true" className="tabular-nums" style={{ margin: "8px 0", fontSize: "var(--fs-score)", fontWeight: 900, color: "var(--gold)" }}>
        +{points} <span style={{ color: "#fff", fontSize: 24, fontWeight: 700 }}>{copy.rewardCard.pointsSuffix}</span>
      </p>
      <div
        aria-hidden="true"
        style={{ background: "#FFFFFF1A", border: "1px solid #FFFFFF33", borderRadius: 16, padding: 16, fontSize: "var(--fs-sm)", marginTop: 16 }}
      >
        {copy.rewardCard.glassBox(totalPoints)}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
        <Button variant="outline-white" onClick={onRewatch}>
          {copy.rewardCard.rewatch}
        </Button>
        <Button variant="white" onClick={onOtherVideos}>
          {copy.rewardCard.otherVideos}
        </Button>
      </div>
    </div>
  );
}
