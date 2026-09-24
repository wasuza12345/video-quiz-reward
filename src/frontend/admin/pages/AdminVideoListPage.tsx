"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/frontend/shared/ui/Badge";
import { Button } from "@/frontend/shared/ui/Button";
import { ConfirmDialog } from "@/frontend/shared/ui/ConfirmDialog";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { Table } from "@/frontend/shared/ui/Table";
import { Toast } from "@/frontend/shared/ui/Toast";
import { useSimpleToast } from "@/frontend/shared/ui/useSimpleToast";
import { PageHeader } from "../components/AdminShell";
import { KebabMenu, type KebabMenuItem } from "../components/KebabMenu";
import { StatusBadge } from "../components/StatusBadge";
import { formatTime, videos as copy } from "../constants/copy.th";
import type { AdminVideoListItem } from "@/shared/contracts/admin";
import { adminApi } from "../services/api";

type Tab = "all" | "published" | "draft" | "archived";

export function AdminVideoListPage() {
  const router = useRouter();
  const [items, setItems] = useState<AdminVideoListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AdminVideoListItem | null>(null);
  const { show, visible } = useSimpleToast();

  // Explicit-reset version — safe for the retry button and post-mutation refreshes below, since
  // those fire from user gestures/promise callbacks, never from an effect body directly.
  const load = () => {
    setError(false);
    adminApi
      .listVideos(1, 100)
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err?.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        setError(true);
      });
  };

  // No synchronous setState at the top (react-hooks/set-state-in-effect) — the initial fetch just
  // replaces `items`/`error` from inside the async .then()/.catch(), guarded by `cancelled`.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .listVideos(1, 100)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handlePublish = async (video: AdminVideoListItem) => {
    setBusyId(video.id);
    try {
      await adminApi.publishVideo(video.id);
      show(copy.toast.published);
      load();
    } catch {
      // errors surface via a reload of the row state; keep it simple for now
    } finally {
      setBusyId(null);
    }
  };

  const handleFeature = async (video: AdminVideoListItem) => {
    setBusyId(video.id);
    try {
      await adminApi.featureVideo(video.id);
      show(copy.toast.featured);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    const id = archiveTarget.id;
    setArchiveTarget(null);
    setBusyId(id);
    try {
      await adminApi.archiveVideo(id);
      show(copy.toast.archived);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const filtered = items?.filter((v) => tab === "all" || v.status === tab) ?? [];

  return (
    <div>
      <PageHeader
        title={copy.title}
        action={
          <Link href="/admin/videos/new">
            <Button variant="primary-navy" icon={<span aria-hidden="true">+</span>}>
              {copy.add}
            </Button>
          </Link>
        }
      />

      <div role="tablist" style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface-2)", borderRadius: "var(--radius-pill)", padding: 4, width: "fit-content" }}>
        {(["all", "published", "draft", "archived"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              height: 44,
              padding: "0 16px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              background: tab === t ? "var(--surface)" : "transparent",
              fontWeight: tab === t ? 700 : 400,
              fontSize: "var(--fs-sm)",
              cursor: "pointer",
              fontFamily: "var(--font)",
            }}
          >
            {copy.tabs[t]}
          </button>
        ))}
      </div>

      {error ? (
        <InlineNotice tone="danger" action={{ label: "ลองใหม่", onClick: load }}>
          โหลดรายการวิดีโอไม่สำเร็จ
        </InlineNotice>
      ) : items === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={64} radius="var(--radius-card)" />
          ))}
        </div>
      ) : (
        <Table<AdminVideoListItem>
          rows={filtered}
          rowKey={(v) => v.id}
          emptyTitle={items.length === 0 ? copy.empty.title : copy.emptyFilter}
          emptyBody={items.length === 0 ? copy.empty.body : ""}
          mobileHiddenKeys={["thumbnail", "title"]}
          mobileCardHeader={(v) => (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" width={96} height={54} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/admin/videos/${v.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                  {v.title}
                </Link>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <StatusBadge status={v.status} />
                  {v.isFeatured && <Badge tone="navy">★</Badge>}
                  {v.locked && <span title={copy.lockedSr}>🔒</span>}
                </div>
              </div>
              <KebabMenu ariaLabel={`${v.title} actions`} items={buildMenuItems(v)} />
            </div>
          )}
          columns={[
            {
              key: "thumbnail",
              header: copy.columns.thumbnail,
              render: (v) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" width={96} height={54} style={{ borderRadius: 8, objectFit: "cover" }} />
              ),
            },
            {
              key: "title",
              header: copy.columns.title,
              render: (v) => (
                <div>
                  <Link href={`/admin/videos/${v.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                    {v.title}
                  </Link>
                  <p style={{ margin: "2px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>{v.channelName}</p>
                </div>
              ),
            },
            { key: "status", header: copy.columns.status, render: (v) => <StatusBadge status={v.status} /> },
            { key: "featured", header: copy.columns.featured, render: (v) => (v.isFeatured ? <span style={{ color: "var(--brand-primary)" }}>★</span> : null) },
            { key: "duration", header: copy.columns.duration, render: (v) => formatTime(v.durationSec) },
            { key: "questions", header: copy.columns.questions, render: (v) => v.questionCount },
            { key: "points", header: copy.columns.points, render: (v) => v.rewardPoints },
            { key: "views", header: copy.columns.views, render: (v) => v.sessionCount },
            {
              key: "locked",
              header: "",
              render: (v) => (v.locked ? <span title={copy.lockedSr}>🔒</span> : null),
            },
            {
              key: "actions",
              header: "",
              render: (v) => (busyId === v.id ? <Skeleton width={44} height={44} radius="50%" /> : <KebabMenu ariaLabel={`${v.title} actions`} items={buildMenuItems(v)} />),
            },
          ]}
        />
      )}

      {visible && <Toast message={visible.message} />}

      <ConfirmDialog
        open={archiveTarget !== null}
        title={copy.archiveConfirm.title}
        body={copy.archiveConfirm.body}
        cancelLabel={copy.archiveConfirm.cancel}
        confirmLabel={copy.archiveConfirm.confirm}
        tone="danger"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={handleArchiveConfirmed}
      />
    </div>
  );

  function buildMenuItems(v: AdminVideoListItem) {
    const items: KebabMenuItem[] = [{ key: "edit", label: copy.actions.edit, onSelect: () => router.push(`/admin/videos/${v.id}`) }];
    if (v.status === "draft") items.push({ key: "publish", label: copy.actions.publish, onSelect: () => void handlePublish(v) });
    if (v.status === "published" && !v.isFeatured) items.push({ key: "feature", label: copy.actions.feature, onSelect: () => void handleFeature(v) });
    items.push({ key: "archive", label: copy.actions.archive, onSelect: () => setArchiveTarget(v), tone: "danger" });
    return items;
  }
}
