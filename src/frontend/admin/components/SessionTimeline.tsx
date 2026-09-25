"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { Badge } from "@/frontend/shared/ui/Badge";
import { EmptyState } from "@/frontend/shared/ui/ErrorState";
import { EventTypeChip } from "./EventTypeChip";
import { RejectChip } from "./RejectChip";
import { formatTime, sessions as copy } from "../constants/copy.th";
import { formatMmSsTenths } from "../lib/time";
import type { AdminSessionEventRow } from "@/shared/contracts/admin";
import { SOFT_REJECT_REASONS, TOLERANCES } from "@/shared/constants/session";

// FLAG_WORTHY is visual only (which individual reject reasons get the red chip/border) — kept
// wider than SOFT_REJECT_REASONS deliberately: NOT_WATCHED is still worth an admin's attention
// per-event even though it no longer contributes to the session-level `flagged` threshold below
// (planner review round 4, BLOCKER #3 — see shared/constants/session.ts's own SOFT_REJECT_REASONS).
const FLAG_WORTHY = new Set(["SEEK_FORWARD", "SPEED_EXCEEDED", "NOT_WATCHED"]);

export type TimelineRow = { kind: "event"; event: AdminSessionEventRow } | { kind: "tick-group"; id: string; events: AdminSessionEventRow[] };

function sortedEvents(events: AdminSessionEventRow[]): AdminSessionEventRow[] {
  return [...events].sort((a, b) => a.serverAt.localeCompare(b.serverAt) || a.id - b.id);
}

/** The event that flipped `flagged` to true: the first SEEK_FORWARD, or the Nth soft reject
 * (shared/constants/session.ts's SOFT_REJECT_REASONS — NOT_WATCHED deliberately excluded) —
 * mirrors backend/domain/session-state-machine.ts's `reject()`.
 * Exported for tests/unit/frontend/session-timeline.test.ts. */
export function findFlagTriggerEventId(events: AdminSessionEventRow[]): number | null {
  let softCount = 0;
  for (const e of sortedEvents(events)) {
    if (e.accepted || !e.rejectReason) continue;
    if (e.rejectReason === "SEEK_FORWARD") return e.id;
    if (SOFT_REJECT_REASONS.some((reason) => reason === e.rejectReason)) {
      softCount += 1;
      if (softCount >= TOLERANCES.SOFT_REJECT_FLAG_AT) return e.id;
    }
  }
  return null;
}

export function buildRows(events: AdminSessionEventRow[], onlyRejected: boolean, collapseTicks: boolean): TimelineRow[] {
  const source = onlyRejected ? events.filter((e) => !e.accepted) : events;
  if (!collapseTicks) return source.map((event) => ({ kind: "event", event }));

  const rows: TimelineRow[] = [];
  let group: AdminSessionEventRow[] = [];
  const flush = () => {
    if (group.length === 0) return;
    if (group.length === 1) rows.push({ kind: "event", event: group[0] });
    else rows.push({ kind: "tick-group", id: `tick-${group[0].id}`, events: group });
    group = [];
  };
  for (const e of source) {
    if (e.type === "TICK" && e.accepted) group.push(e);
    else {
      flush();
      rows.push({ kind: "event", event: e });
    }
  }
  flush();
  return rows;
}

export function eventBorder(e: AdminSessionEventRow): string | undefined {
  if (!e.accepted && e.rejectReason && FLAG_WORTHY.has(e.rejectReason)) return "4px solid var(--danger)";
  if (e.fromState !== e.toState && (e.toState === "QUIZ_PENDING" || e.toState === "ENDED")) return "2px solid var(--brand-primary)";
  return undefined;
}

function eventBackground(e: AdminSessionEventRow): string | undefined {
  if (!e.accepted && e.rejectReason) return FLAG_WORTHY.has(e.rejectReason) ? "var(--danger-bg)" : "var(--surface-2)";
  return undefined;
}

export function detailSummary(e: AdminSessionEventRow): string {
  if (!e.payload) return "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(e.payload) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (e.type === "ANSWER") return `ตอบ ${String(parsed.choice)} · ${parsed.correct ? "ถูก" : "ผิด"}`;
  if (e.type === "CLAIM") return parsed.awarded ? `+${String(parsed.points)}` : "0";
  return "";
}

function timeOffset(e: AdminSessionEventRow, startedAt: string): string {
  const deltaSec = Math.max(0, (new Date(e.serverAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return `+${formatTime(Math.round(deltaSec))}`;
}

export function SessionTimeline({ events, startedAt }: { events: AdminSessionEventRow[]; startedAt: string }) {
  const [onlyRejected, setOnlyRejected] = useState(false);
  const [collapseTicks, setCollapseTicks] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const rowRefs = useRef(new Map<number, HTMLTableRowElement | HTMLLIElement>());
  const [rejectedCursor, setRejectedCursor] = useState(-1);

  const flagTriggerId = useMemo(() => findFlagTriggerEventId(events), [events]);
  const rows = useMemo(() => buildRows(events, onlyRejected, collapseTicks), [events, onlyRejected, collapseTicks]);
  const rejectedIds = useMemo(() => sortedEvents(events).filter((e) => !e.accepted).map((e) => e.id), [events]);

  if (events.length === 0) {
    return <EmptyState title={copy.detail.timeline.empty} body="" />;
  }

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const goToNextRejected = () => {
    if (rejectedIds.length === 0) return;
    const nextIndex = (rejectedCursor + 1) % rejectedIds.length;
    setRejectedCursor(nextIndex);
    const el = rowRefs.current.get(rejectedIds[nextIndex]);
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  function renderEventRow(e: AdminSessionEventRow, opts: { nested?: boolean } = {}) {
    const border = eventBorder(e);
    const background = eventBackground(e);
    const isTrigger = e.id === flagTriggerId;
    const style: React.CSSProperties = {
      borderBottom: "1px solid var(--surface-2)",
      ...(background ? { background } : {}),
      ...(border ? { borderLeft: border } : {}),
      ...(opts.nested ? { background: background ?? "var(--surface-2)" } : {}),
    };
    return (
      <tr
        key={e.id}
        ref={(el) => {
          if (el) rowRefs.current.set(e.id, el);
          else rowRefs.current.delete(e.id);
        }}
        tabIndex={-1}
        style={style}
      >
        <td style={{ padding: "10px 16px" }} title={new Date(e.serverAt).toLocaleString("th-TH")}>
          {timeOffset(e, startedAt)}
        </td>
        <td style={{ padding: "10px 16px" }}>{e.seq === null ? <Badge tone="neutral">{copy.detail.timeline.systemChip}</Badge> : `#${e.seq}`}</td>
        <td style={{ padding: "10px 16px" }}>
          <EventTypeChip type={e.type} />
        </td>
        <td style={{ padding: "10px 16px" }}>{formatMmSsTenths(e.positionSec)}</td>
        <td style={{ padding: "10px 16px" }}>{e.fromState !== e.toState ? <strong>{`${e.fromState} → ${e.toState}`}</strong> : null}</td>
        <td style={{ padding: "10px 16px" }}>
          {e.accepted ? (
            <span style={{ color: "var(--success)" }}>✓</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--danger)" }}>✕</span>
              {e.rejectReason && <RejectChip reason={e.rejectReason} />}
              {isTrigger && <Badge tone="danger">🚩 {copy.detail.timeline.flagWorthy}</Badge>}
            </span>
          )}
        </td>
        <td style={{ padding: "10px 16px" }}>{detailSummary(e)}</td>
      </tr>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, cursor: "pointer", fontSize: "var(--fs-sm)" }}>
          <input type="checkbox" checked={onlyRejected} onChange={(e) => setOnlyRejected(e.target.checked)} style={{ width: 20, height: 20 }} />
          {copy.detail.timeline.onlyRejected}
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, cursor: "pointer", fontSize: "var(--fs-sm)" }}>
          <input type="checkbox" checked={collapseTicks} onChange={(e) => setCollapseTicks(e.target.checked)} style={{ width: 20, height: 20 }} />
          {copy.detail.timeline.collapseTicks}
        </label>
        <button
          type="button"
          onClick={goToNextRejected}
          disabled={rejectedIds.length === 0}
          style={{ height: 44, padding: "0 16px", borderRadius: "var(--radius-field)", border: "1px solid var(--border-control)", background: "var(--surface)", cursor: rejectedIds.length ? "pointer" : "default", fontFamily: "var(--font)", fontSize: "var(--fs-sm)" }}
        >
          {copy.detail.timeline.nextRejected}
        </button>
      </div>

      <table className="admin-table-desktop" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {[
              copy.detail.timeline.columns.time,
              copy.detail.timeline.columns.seq,
              copy.detail.timeline.columns.event,
              copy.detail.timeline.columns.position,
              copy.detail.timeline.columns.state,
              copy.detail.timeline.columns.result,
              copy.detail.timeline.columns.detail,
            ].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: "var(--fs-xs)", color: "var(--text-2)", fontWeight: 600, borderBottom: "1px solid var(--border-control)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "event") return renderEventRow(row.event);
            const first = row.events[0];
            const last = row.events[row.events.length - 1];
            const expanded = expandedGroups.has(row.id);
            return (
              <Fragment key={row.id}>
                <tr style={{ borderBottom: "1px solid var(--surface-2)" }}>
                  <td style={{ padding: "10px 16px" }} title={new Date(first.serverAt).toLocaleString("th-TH")}>
                    {timeOffset(first, startedAt)}
                  </td>
                  <td style={{ padding: "10px 16px" }}>{first.seq !== null && last.seq !== null ? (first.seq === last.seq ? `#${first.seq}` : `#${first.seq}–#${last.seq}`) : <Badge tone="neutral">{copy.detail.timeline.systemChip}</Badge>}</td>
                  <td colSpan={4} style={{ padding: "10px 16px" }}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(row.id)}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--brand-primary)", fontFamily: "var(--font)", fontSize: "var(--fs-sm)" }}
                      aria-expanded={expanded}
                    >
                      {copy.detail.timeline.collapsedTicks(row.events.length, formatMmSsTenths(first.positionSec), formatMmSsTenths(last.positionSec))}
                      {expanded ? " ▲" : " ▼"}
                    </button>
                  </td>
                  <td style={{ padding: "10px 16px" }} />
                </tr>
                {expanded && row.events.map((e) => renderEventRow(e, { nested: true }))}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <ul className="admin-table-mobile" style={{ flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row) => {
          if (row.kind === "event") {
            const e = row.event;
            const border = eventBorder(e);
            const background = eventBackground(e);
            const isTrigger = e.id === flagTriggerId;
            return (
              <li
                key={e.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(e.id, el);
                  else rowRefs.current.delete(e.id);
                }}
                tabIndex={-1}
                style={{ padding: "10px 12px", borderRadius: 8, borderLeft: border ?? "4px solid transparent", background: background ?? "var(--surface)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--fs-sm)" }}>
                  <span title={new Date(e.serverAt).toLocaleString("th-TH")}>{timeOffset(e, startedAt)}</span>
                  <EventTypeChip type={e.type} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
                  <span>{formatMmSsTenths(e.positionSec)}</span>
                  {e.fromState !== e.toState && <strong style={{ color: "var(--text)" }}>{`${e.fromState} → ${e.toState}`}</strong>}
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {e.accepted ? <span style={{ color: "var(--success)" }}>✓</span> : (
                    <>
                      <span style={{ color: "var(--danger)" }}>✕</span>
                      {e.rejectReason && <RejectChip reason={e.rejectReason} />}
                      {isTrigger && <Badge tone="danger">🚩 {copy.detail.timeline.flagWorthy}</Badge>}
                    </>
                  )}
                  {detailSummary(e) && <span style={{ fontSize: "var(--fs-xs)" }}>{detailSummary(e)}</span>}
                </div>
              </li>
            );
          }
          const first = row.events[0];
          const last = row.events[row.events.length - 1];
          const expanded = expandedGroups.has(row.id);
          return (
            <li key={row.id} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface)" }}>
              <button
                type="button"
                onClick={() => toggleGroup(row.id)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--brand-primary)", fontFamily: "var(--font)", fontSize: "var(--fs-sm)" }}
                aria-expanded={expanded}
              >
                {copy.detail.timeline.collapsedTicks(row.events.length, formatMmSsTenths(first.positionSec), formatMmSsTenths(last.positionSec))}
                {expanded ? " ▲" : " ▼"}
              </button>
              {expanded && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {row.events.map((e) => (
                    <div key={e.id} style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
                      {timeOffset(e, startedAt)} · {formatMmSsTenths(e.positionSec)}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
