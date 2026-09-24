import Link from "next/link";
import { formatTime, videoList as copy } from "../constants/copy.th";
import { Badge } from "@/frontend/shared/ui/Badge";
import type { PublicVideoItem } from "@/shared/contracts/video";

export interface VideoCardProps {
  video: PublicVideoItem;
}

export function VideoCard({ video }: VideoCardProps) {
  return (
    <Link
      href={`/watch/${video.id}`}
      aria-label={copy.card.ariaLabel(video.title, video.durationSec, video.rewarded, video.rewardPoints)}
      className="card-interactive"
      style={{
        display: "block",
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        transition: "transform var(--motion-duration) var(--motion-ease)",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: "var(--radius-media)", overflow: "hidden", background: "var(--surface-2)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail */}
        <img src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {video.rewarded ? (
          <Badge tone="success" icon="✓">
            {copy.card.rewardedTag}
          </Badge>
        ) : (
          <Badge tone="warning" icon="⭐">
            {copy.card.rewardTag(video.rewardPoints)}
          </Badge>
        )}
        <Badge tone="neutral">{formatTime(video.durationSec)}</Badge>
      </div>

      <h3
        style={{
          margin: "8px 0 0",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--brand-primary-dark)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {video.title}
      </h3>

      <span
        aria-hidden="true"
        style={{ display: "flex", alignItems: "center", height: 44, marginTop: 4, color: "var(--brand-primary)", fontWeight: 700, fontSize: "var(--fs-sm)" }}
      >
        {video.rewarded ? copy.card.ctaListRewarded : copy.card.ctaListNew}
      </span>
    </Link>
  );
}
