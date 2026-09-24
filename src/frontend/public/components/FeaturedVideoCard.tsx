import Link from "next/link";
import { formatTime, videoList as copy } from "../constants/copy.th";
import { Badge } from "@/frontend/shared/ui/Badge";
import type { PublicVideoItem } from "@/shared/contracts/video";

export interface FeaturedVideoCardProps {
  video: PublicVideoItem;
  featured: boolean;
}

/**
 * The whole card is one link — the CTA is the visual target only, never a nested `<a>` (spec
 * §3.2). Stacked ≤1024px; a horizontal 58%-thumbnail layout ≥1025px (spec §3.1) via .featured-card.
 */
export function FeaturedVideoCard({ video, featured }: FeaturedVideoCardProps) {
  return (
    <Link
      href={`/watch/${video.id}`}
      aria-label={copy.card.ariaLabel(video.title, video.durationSec, video.rewarded, video.rewardPoints)}
      className="card-interactive featured-card"
      style={{
        display: "flex",
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        transition: "transform var(--motion-duration) var(--motion-ease)",
      }}
    >
      <div className="featured-media" style={{ position: "relative", aspectRatio: "16/9", borderRadius: "var(--radius-media)", overflow: "hidden", background: "var(--surface-2)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail, not eligible for next/image optimization */}
        <img src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`} alt="" loading="eager" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </div>

      <div className="featured-content">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {featured && <Badge tone="navy">{copy.card.featuredTag}</Badge>}
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
          {video.questionCount > 0 && <Badge tone="neutral">{copy.card.questionsTag(video.questionCount)}</Badge>}
        </div>

        <h2
          style={{
            margin: "12px 0 0",
            fontSize: "var(--fs-lg)",
            fontWeight: 700,
            color: "var(--brand-primary-dark)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {video.title}
        </h2>
        {video.channelName && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>{copy.card.source(video.channelName)}</p>}

        <span
          aria-hidden="true"
          className="featured-cta"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 16,
            height: 52,
            padding: "0 32px",
            borderRadius: "var(--radius-pill)",
            background: video.rewarded ? "transparent" : "var(--brand-accent)",
            border: video.rewarded ? "1px solid var(--border-control)" : "none",
            color: video.rewarded ? "var(--brand-primary-dark)" : "#fff",
            fontWeight: 700,
            boxShadow: video.rewarded ? "none" : "var(--shadow-cta)",
          }}
        >
          {video.rewarded ? copy.card.ctaFeaturedRewarded : copy.card.ctaFeaturedNew}
        </span>
      </div>
    </Link>
  );
}
