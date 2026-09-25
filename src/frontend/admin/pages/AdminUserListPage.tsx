"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { Table } from "@/frontend/shared/ui/Table";
import { PageHeader } from "../components/AdminShell";
import { CopyIdButton } from "../components/CopyIdButton";
import { Pagination } from "../components/Pagination";
import { common, users as copy } from "../constants/copy.th";
import { ADMIN_USERS_PATH, withFromParam } from "../lib/backHref";
import { shortId } from "../lib/format";
import type { AdminUserListItem } from "@/shared/contracts/admin";
import { adminApi } from "../services/api";

const PAGE_SIZE = 20;

export function AdminUserListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [data, setData] = useState<{ items: AdminUserListItem[]; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listUsers(page, PAGE_SIZE)
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
  }, [page, router, reloadKey]);

  return (
    <div>
      <PageHeader title={copy.title} />

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
          <Table<AdminUserListItem>
            rows={data.items}
            rowKey={(u) => u.id}
            emptyTitle={copy.empty}
            emptyBody=""
            mobileCardHeader={(u) => (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Link href={withFromParam(`/admin/users/${u.id}`, ADMIN_USERS_PATH, searchParams)} style={{ fontFamily: "monospace", fontWeight: 700, color: "inherit" }} title={u.id}>
                  {shortId(u.id)}
                </Link>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "var(--brand-primary-dark)" }}>{u.totalPoints.toLocaleString("th-TH")}</span>
                  <CopyIdButton id={u.id} />
                </div>
              </div>
            )}
            mobileHiddenKeys={["user", "totalPoints", "copy"]}
            columns={[
              {
                key: "user",
                header: copy.columns.user,
                href: (u) => withFromParam(`/admin/users/${u.id}`, ADMIN_USERS_PATH, searchParams),
                render: (u) => (
                  <span style={{ fontFamily: "monospace", fontSize: "var(--fs-sm)" }} title={u.id}>
                    {shortId(u.id)}
                  </span>
                ),
              },
              { key: "createdAt", header: copy.columns.createdAt, render: (u) => new Date(u.createdAt).toLocaleString("th-TH") },
              { key: "totalPoints", header: copy.columns.totalPoints, render: (u) => u.totalPoints.toLocaleString("th-TH") },
              { key: "sessionCount", header: copy.columns.sessionCount, render: (u) => u.sessionCount },
              {
                key: "lastActiveAt",
                header: copy.columns.lastActiveAt,
                render: (u) => (u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString("th-TH") : "–"),
              },
              {
                key: "copy",
                header: "",
                render: (u) => <CopyIdButton id={u.id} />,
              },
            ]}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={(p) => router.push(`/admin/users?page=${p}`)} />
        </>
      )}
    </div>
  );
}
