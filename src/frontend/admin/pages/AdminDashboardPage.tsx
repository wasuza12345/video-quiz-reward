"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Table } from "@/frontend/shared/ui/Table";
import { PageHeader } from "../components/AdminShell";
import { SessionStateBadge } from "../components/SessionStateBadge";
import { StatTiles, type StatTile } from "../components/StatTiles";
import { formatTime, dashboard as copy, sessions as sessionsCopy } from "../constants/copy.th";
import { shortId } from "../lib/format";
import type { AdminStats, AdminVideoListItem, SessionRow } from "@/shared/contracts/admin";
import { adminApi } from "../services/api";

export function AdminDashboardPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<AdminVideoListItem[]>([]);
  const [videoId, setVideoId] = useState<string>("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [flagged, setFlagged] = useState<SessionRow[] | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [flaggedError, setFlaggedError] = useState(false);
  const [flaggedReloadKey, setFlaggedReloadKey] = useState(0);

  useEffect(() => {
    adminApi
      .listVideos(1, 100)
      .then((res) => setVideos(res.items))
      .catch(() => {});
  }, []);

  // No synchronous setState at the top (react-hooks/set-state-in-effect) — every setState here
  // happens inside the fetch's async .then()/.catch(), guarded by `cancelled` against a stale
  // response landing after `videoId` (or a manual retry) has already moved on.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .getStats(videoId || undefined)
      .then((res) => {
        if (cancelled) return;
        setStats(res);
        setStatsError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        setStatsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, router]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listSessions({ flagged: true, page: 1, pageSize: 5 })
      .then((res) => {
        if (cancelled) return;
        setFlagged(res.items);
        setFlaggedError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        setFlaggedError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, flaggedReloadKey]);

  const tiles: StatTile[] = stats
    ? [
        { key: "views", label: copy.tiles.views.label, sub: copy.tiles.views.sub, value: stats.views },
        { key: "completions", label: copy.tiles.completions.label, sub: copy.tiles.completions.sub, value: stats.completions },
        { key: "pointsAwarded", label: copy.tiles.pointsAwarded.label, value: stats.pointsAwarded },
        {
          key: "flagged",
          label: copy.tiles.flagged.label,
          value: stats.flaggedSessions,
          warningWhenPositive: true,
          href: "/admin/sessions?flagged=true",
          ariaLabel: copy.tiles.flagged.ariaLabel(stats.flaggedSessions),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader title={copy.title} />

      <div style={{ marginBottom: 16, maxWidth: 320 }}>
        <select
          value={videoId}
          onChange={(e) => {
            setStats(null);
            setVideoId(e.target.value);
          }}
          style={{ width: "100%", height: 48, borderRadius: "var(--radius-field)", border: "1px solid var(--border-control)", padding: "0 12px", fontFamily: "var(--font)", fontSize: "var(--fs-md)" }}
        >
          <option value="">{copy.allVideos}</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
      </div>

      {statsError ? (
        <InlineNotice tone="danger" action={{ label: copy.retry, onClick: () => setVideoId((v) => v) }}>
          {copy.retry}
        </InlineNotice>
      ) : (
        <StatTiles tiles={tiles} loading={!stats} />
      )}

      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: "32px 0 16px" }}>{copy.flaggedRecent}</h2>

      {flaggedError ? (
        <InlineNotice tone="danger" action={{ label: copy.retry, onClick: () => setFlaggedReloadKey((k) => k + 1) }}>
          {copy.retry}
        </InlineNotice>
      ) : flagged === null ? (
        <p style={{ color: "var(--text-2)" }}>{sessionsCopy.empty}</p>
      ) : (
        <>
          <Table<SessionRow>
            rows={flagged}
            rowKey={(s) => s.id}
            rowHref={(s) => `/admin/sessions/${s.id}`}
            rowTone={() => "warning"}
            emptyTitle={copy.emptyFlagged}
            emptyBody=""
            mobileCardHeader={(s) => (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SessionStateBadge state={s.state} />
                <span>🚩</span>
              </div>
            )}
            columns={[
              { key: "flag", header: sessionsCopy.columns.flagged, render: () => "🚩" },
              { key: "startedAt", header: sessionsCopy.columns.startedAt, render: (s) => new Date(s.startedAt).toLocaleString("th-TH") },
              { key: "user", header: sessionsCopy.columns.user, render: (s) => shortId(s.userId) },
              { key: "video", header: sessionsCopy.columns.video, render: (s) => s.videoTitle },
              { key: "state", header: sessionsCopy.columns.state, render: (s) => <SessionStateBadge state={s.state} /> },
              { key: "progress", header: sessionsCopy.columns.progress, render: (s) => `${formatTime(s.furthestSec)} / ${formatTime(s.durationSec)}` },
            ]}
          />
          {flagged.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Link href="/admin/sessions?flagged=true" style={{ color: "var(--brand-primary)", fontSize: "var(--fs-sm)" }}>
                {copy.viewAll}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
