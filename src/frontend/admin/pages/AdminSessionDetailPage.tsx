"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/frontend/shared/ui/Badge";
import { EmptyState } from "@/frontend/shared/ui/ErrorState";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { ProgressBar } from "@/frontend/shared/ui/ProgressBar";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { PageHeader } from "../components/AdminShell";
import { SessionStateBadge } from "../components/SessionStateBadge";
import { SessionTimeline } from "../components/SessionTimeline";
import { common, formatTime, sessions as copy } from "../constants/copy.th";
import { shortId } from "../lib/format";
import { TOLERANCES } from "@/shared/constants/session";
import type { AdminSessionDetail, AdminSessionEventRow } from "@/shared/contracts/admin";
import { AdminApiError, adminApi } from "../services/api";

const SOFT_REJECT_LIMIT = 3;

function buildFlagReason(events: AdminSessionEventRow[]): string {
  const seekForwardCount = events.filter((e) => !e.accepted && e.rejectReason === "SEEK_FORWARD").length;
  if (seekForwardCount > 0) {
    return `ถูกแจ้งเตือนเพราะ: ${copy.rejectReason.SEEK_FORWARD} (SEEK_FORWARD) ${seekForwardCount} ครั้ง`;
  }
  const speedCount = events.filter((e) => !e.accepted && e.rejectReason === "SPEED_EXCEEDED").length;
  const notWatchedCount = events.filter((e) => !e.accepted && e.rejectReason === "NOT_WATCHED").length;
  const total = speedCount + notWatchedCount;
  return `ถูกปฏิเสธสะสม ${total} ครั้ง (${copy.rejectReason.SPEED_EXCEEDED} ${speedCount} · ${copy.rejectReason.NOT_WATCHED} ${notWatchedCount})`;
}

function Fact({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "success" | "warning" | "danger" }) {
  const color = tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : tone === "danger" ? "var(--danger)" : "var(--text)";
  return (
    <div>
      <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)", margin: "0 0 4px" }}>{label}</p>
      <p style={{ fontSize: "var(--fs-md)", fontWeight: 600, color, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)", margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

export function AdminSessionDetailPage({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getSession(sessionId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        if (err instanceof AdminApiError && err.code === "SESSION_NOT_FOUND") return setNotFound(true);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, router, reloadKey]);

  if (notFound) {
    return (
      <div>
        <EmptyState title={copy.detail.notFound} body="" />
        <div style={{ textAlign: "center" }}>
          <Link href="/admin/sessions" style={{ color: "var(--brand-primary)" }}>
            ← กลับ
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
          <Skeleton height={200} radius="var(--radius-card)" />
        </div>
      </div>
    );
  }

  const { session, events } = detail;
  const requiredWallSec = TOLERANCES.MIN_PLAYED_RATIO * session.durationSec;
  const claimEvent = events.find((e) => e.type === "CLAIM" && e.accepted);

  return (
    <div>
      <PageHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {copy.detail.title(shortId(session.id))}
            <SessionStateBadge state={session.state} />
            {session.flagged && <Badge tone="warning">🚩 {copy.detail.flaggedPill}</Badge>}
            {session.isReplay && <Badge tone="neutral">{copy.detail.replayTag}</Badge>}
          </span>
        }
      />

      {session.flagged && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="warning">{buildFlagReason(events)}</InlineNotice>
        </div>
      )}

      <div className="session-facts-grid" style={{ display: "grid", gap: 16, background: "var(--surface)", borderRadius: "var(--radius-card)", padding: 20, marginBottom: 32 }}>
        <Fact label={copy.detail.facts.user} value={<Link href={`/admin/users/${session.userId}`} style={{ color: "var(--brand-primary)" }}>{shortId(session.userId)}</Link>} />
        <Fact label={copy.detail.facts.video} value={<Link href={`/admin/videos/${session.videoId}`} style={{ color: "var(--brand-primary)" }}>{session.videoTitle}</Link>} />
        <Fact
          label={copy.detail.facts.startedEnded}
          value={`${new Date(session.startedAt).toLocaleString("th-TH")} / ${session.endedAt ? new Date(session.endedAt).toLocaleString("th-TH") : "–"}`}
        />
        <Fact label={copy.detail.facts.position} value={`${formatTime(session.positionSec)} / ${formatTime(session.furthestSec)} จาก ${formatTime(session.durationSec)}`} />
        <Fact
          label={copy.detail.facts.playedWallSec}
          value={formatTime(session.playedWallSec)}
          tone={session.playedWallSec >= requiredWallSec ? "success" : undefined}
          sub={<ProgressBar value={session.playedWallSec} max={session.durationSec} secondaryValue={requiredWallSec} valueText={formatTime(session.playedWallSec)} height={6} />}
        />
        <Fact
          label={copy.detail.facts.questionsPassed}
          value={
            session.questionCount === 0
              ? copy.detail.facts.questionsPassedNone
              : `${copy.detail.facts.questionsPassedValue(session.passedQuestionIds.length, session.questionCount)}${session.currentQuestionId ? ` · ${copy.detail.facts.questionsPassedPending}` : ""}`
          }
          tone={session.questionCount > 0 && session.passedQuestionIds.length === session.questionCount ? "success" : undefined}
        />
        <Fact label={copy.detail.facts.bankSec} value={`${session.bankSec}s / ${TOLERANCES.BANK_MAX_SEC}s`} />
        <Fact
          label={copy.detail.facts.softRejectCount}
          value={`${session.softRejectCount} / ${SOFT_REJECT_LIMIT}`}
          tone={session.softRejectCount >= SOFT_REJECT_LIMIT ? "danger" : session.softRejectCount >= 1 ? "warning" : undefined}
        />
        <Fact
          label={copy.detail.facts.eventCount}
          value={session.eventCount}
          sub={<span style={{ fontSize: 13 }}>last seq {session.lastSeq} · version {session.version}</span>}
        />
        <Fact
          label={copy.detail.facts.points}
          value={
            session.pointsAwarded > 0
              ? `+${session.pointsAwarded}${claimEvent ? ` · ${new Date(claimEvent.serverAt).toLocaleTimeString("th-TH")}` : ""}`
              : session.isReplay
                ? copy.detail.facts.pointsReplay
                : copy.detail.facts.pointsNone
          }
          tone={session.pointsAwarded > 0 ? "success" : undefined}
        />
      </div>

      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: "0 0 16px" }}>{copy.detail.timeline.title}</h2>
      <SessionTimeline events={events} startedAt={session.startedAt} />
    </div>
  );
}
