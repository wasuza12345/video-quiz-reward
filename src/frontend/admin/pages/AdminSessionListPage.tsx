"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { ProgressBar } from "@/frontend/shared/ui/ProgressBar";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { Table } from "@/frontend/shared/ui/Table";
import { PageHeader } from "../components/AdminShell";
import { Pagination } from "../components/Pagination";
import { SessionStateBadge } from "../components/SessionStateBadge";
import { common, formatTime, sessions as copy } from "../constants/copy.th";
import { withFromParam } from "../lib/backHref";
import { shortId } from "../lib/format";
import type { AdminVideoListItem, SessionRow } from "@/shared/contracts/admin";
import { adminApi } from "../services/api";

const PAGE_SIZE = 20;

export function AdminSessionListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const videoId = searchParams.get("videoId") ?? "";
  const flagged = searchParams.get("flagged") === "true";

  const [videos, setVideos] = useState<AdminVideoListItem[]>([]);
  const [data, setData] = useState<{ items: SessionRow[]; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    adminApi
      .listVideos(1, 100)
      .then((res) => setVideos(res.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listSessions({ videoId: videoId || undefined, flagged: flagged || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setData({ items: res.items, total: res.total });
        setError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, flagged, page, router, reloadKey]);

  const pushQuery = (next: { videoId?: string; flagged?: boolean; page?: number }) => {
    const usp = new URLSearchParams();
    const nextVideoId = next.videoId ?? videoId;
    const nextFlagged = next.flagged ?? flagged;
    if (nextVideoId) usp.set("videoId", nextVideoId);
    if (nextFlagged) usp.set("flagged", "true");
    usp.set("page", String(next.page ?? 1));
    router.push(`/admin/sessions?${usp.toString()}`);
  };

  const hasFilter = Boolean(videoId) || flagged;

  return (
    <div>
      <PageHeader title={copy.title} />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <select
          value={videoId}
          onChange={(e) => pushQuery({ videoId: e.target.value, page: 1 })}
          style={{ height: 48, minWidth: 220, borderRadius: "var(--radius-field)", border: "1px solid var(--border-control)", padding: "0 12px", fontFamily: "var(--font)", fontSize: "var(--fs-md)" }}
        >
          <option value="">{copy.allVideos}</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, cursor: "pointer", fontSize: "var(--fs-sm)" }}>
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => pushQuery({ flagged: e.target.checked, page: 1 })}
            style={{ width: 20, height: 20 }}
          />
          {copy.flaggedOnly}
        </label>
      </div>

      {error ? (
        <InlineNotice tone="danger" action={{ label: common.retry, onClick: () => setReloadKey((k) => k + 1) }}>
          {common.retry}
        </InlineNotice>
      ) : data === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={56} radius="var(--radius-card)" />
          ))}
        </div>
      ) : (
        <>
          <Table<SessionRow>
            rows={data.items}
            rowKey={(s) => s.id}
            rowHref={(s) => withFromParam(`/admin/sessions/${s.id}`, "/admin/sessions", searchParams)}
            rowTone={(s) => (s.flagged ? "warning" : undefined)}
            emptyTitle={hasFilter ? copy.emptyFilter : copy.empty}
            emptyBody=""
            mobileCardHeader={(s) => (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SessionStateBadge state={s.state} />
                {s.flagged && <span title={copy.flaggedSr}>🚩</span>}
              </div>
            )}
            mobileHiddenKeys={["flag", "state"]}
            columns={[
              { key: "flag", header: copy.columns.flagged, render: (s) => (s.flagged ? <span title={copy.flaggedSr}>🚩</span> : "") },
              { key: "startedAt", header: copy.columns.startedAt, render: (s) => new Date(s.startedAt).toLocaleString("th-TH") },
              {
                key: "user",
                header: copy.columns.user,
                href: (s) => `/admin/users/${s.userId}`,
                render: (s) => (
                  <span style={{ fontFamily: "monospace", fontSize: "var(--fs-sm)" }} title={s.userId}>
                    {shortId(s.userId)}
                  </span>
                ),
              },
              { key: "video", header: copy.columns.video, render: (s) => s.videoTitle },
              { key: "state", header: copy.columns.state, render: (s) => <SessionStateBadge state={s.state} /> },
              {
                key: "progress",
                header: copy.columns.progress,
                render: (s) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 48 }}>
                      <ProgressBar value={s.furthestSec} max={s.durationSec} valueText={`${formatTime(s.furthestSec)} / ${formatTime(s.durationSec)}`} height={6} />
                    </div>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
                      {formatTime(s.furthestSec)} / {formatTime(s.durationSec)}
                    </span>
                  </div>
                ),
              },
              { key: "type", header: copy.columns.type, render: (s) => (s.isReplay ? copy.typeReplay : copy.typeFirst) },
              { key: "playedWallSec", header: copy.columns.playedWallSec, render: (s) => formatTime(s.playedWallSec) },
              {
                key: "points",
                header: copy.columns.points,
                render: (s) => (s.pointsAwarded > 0 ? <span style={{ color: "var(--success)", fontWeight: 700 }}>+{s.pointsAwarded}</span> : "–"),
              },
            ]}
          />
          {hasFilter && data.items.length === 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => router.push("/admin/sessions")}
                style={{ background: "none", border: "none", color: "var(--brand-primary)", cursor: "pointer", padding: 0, fontSize: "var(--fs-sm)" }}
              >
                {copy.clearFilter}
              </button>
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={(p) => pushQuery({ page: p })} />
        </>
      )}
    </div>
  );
}
