"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/frontend/shared/ui/ErrorState";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { Table } from "@/frontend/shared/ui/Table";
import { PageHeader } from "../components/AdminShell";
import { CopyIdButton } from "../components/CopyIdButton";
import { SessionStateBadge } from "../components/SessionStateBadge";
import { StatTiles, type StatTile } from "../components/StatTiles";
import { common, formatTime, users as copy, sessions as sessionsCopy } from "../constants/copy.th";
import { shortId } from "../lib/format";
import type { AdminUserDetail, AdminUserLedgerRow, SessionRow } from "@/shared/contracts/admin";
import { AdminApiError, adminApi } from "../services/api";

export function AdminUserDetailPage({ userId }: { userId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getUser(userId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        if (err instanceof AdminApiError && err.code === "USER_NOT_FOUND") return setNotFound(true);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, router, reloadKey]);

  if (notFound) {
    return (
      <div>
        <EmptyState title={copy.detail.notFound} body="" />
        <div style={{ textAlign: "center" }}>
          <Link href="/admin/users" style={{ color: "var(--brand-primary)" }}>
            ← {copy.detail.back}
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <InlineNotice tone="danger" action={{ label: common.retry, onClick: () => setReloadKey((k) => k + 1) }}>
        {common.retry}
      </InlineNotice>
    );
  }

  if (!detail) {
    return (
      <div>
        <Skeleton height={40} width={240} />
        <div style={{ marginTop: 20 }}>
          <Skeleton height={96} radius="var(--radius-card)" />
        </div>
      </div>
    );
  }

  const flaggedCount = detail.sessions.filter((s) => s.flagged).length;
  const tiles: StatTile[] = [
    { key: "totalPoints", label: copy.detail.tiles.totalPoints, value: detail.user.totalPoints },
    { key: "videosRewarded", label: copy.detail.tiles.videosRewarded, value: detail.ledger.length },
    { key: "totalSessions", label: copy.detail.tiles.totalSessions, value: detail.sessions.length },
    { key: "flagged", label: copy.detail.tiles.flagged, value: flaggedCount, warningWhenPositive: true },
  ];

  return (
    <div>
      <PageHeader
        title={copy.detail.title(shortId(detail.user.id))}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "monospace", fontSize: "var(--fs-sm)", color: "var(--text-2)" }} title={detail.user.id}>
              {shortId(detail.user.id)}
            </span>
            <CopyIdButton id={detail.user.id} />
          </div>
        }
      />
      <p style={{ color: "var(--text-2)", marginTop: -16, marginBottom: 24 }}>{copy.detail.startedAt(new Date(detail.user.createdAt).toLocaleString("th-TH"))}</p>

      <StatTiles tiles={tiles} />

      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: "32px 0 16px" }}>{copy.detail.ledgerTitle}</h2>
      <Table<AdminUserLedgerRow>
        rows={detail.ledger}
        rowKey={(l) => l.sessionId}
        emptyTitle={copy.detail.ledgerEmpty}
        emptyBody=""
        columns={[
          { key: "date", header: copy.detail.ledgerColumns.date, render: (l) => new Date(l.createdAt).toLocaleString("th-TH") },
          {
            key: "video",
            header: copy.detail.ledgerColumns.video,
            href: (l) => `/admin/videos/${l.videoId}`,
            render: (l) => l.videoTitle,
          },
          { key: "points", header: copy.detail.ledgerColumns.points, render: (l) => <span style={{ color: "var(--success)", fontWeight: 700 }}>+{l.points}</span> },
          {
            key: "session",
            header: "",
            href: (l) => `/admin/sessions/${l.sessionId}`,
            render: () => <span style={{ color: "var(--brand-primary)" }}>{copy.detail.viewSession}</span>,
          },
        ]}
      />

      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: "32px 0 16px" }}>{copy.detail.sessionsTitle}</h2>
      <Table<SessionRow>
        rows={detail.sessions}
        rowKey={(s) => s.id}
        rowHref={(s) => `/admin/sessions/${s.id}`}
        rowTone={(s) => (s.flagged ? "warning" : undefined)}
        emptyTitle={sessionsCopy.empty}
        emptyBody=""
        mobileCardHeader={(s) => (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <SessionStateBadge state={s.state} />
            {s.flagged && <span title={sessionsCopy.flaggedSr}>🚩</span>}
          </div>
        )}
        columns={[
          { key: "flag", header: sessionsCopy.columns.flagged, render: (s) => (s.flagged ? "🚩" : "") },
          { key: "startedAt", header: sessionsCopy.columns.startedAt, render: (s) => new Date(s.startedAt).toLocaleString("th-TH") },
          { key: "video", header: sessionsCopy.columns.video, render: (s) => s.videoTitle },
          { key: "state", header: sessionsCopy.columns.state, render: (s) => <SessionStateBadge state={s.state} /> },
          { key: "progress", header: sessionsCopy.columns.progress, render: (s) => `${formatTime(s.furthestSec)} / ${formatTime(s.durationSec)}` },
          { key: "points", header: sessionsCopy.columns.points, render: (s) => (s.pointsAwarded > 0 ? <span style={{ color: "var(--success)", fontWeight: 700 }}>+{s.pointsAwarded}</span> : "–") },
        ]}
      />
    </div>
  );
}
