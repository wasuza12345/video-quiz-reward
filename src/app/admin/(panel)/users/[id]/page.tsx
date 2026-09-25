import { Suspense } from "react";
import { AdminUserDetailPage } from "@/frontend/admin/pages/AdminUserDetailPage";

export default async function AdminUserDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AdminUserDetailPage userId={id} />
    </Suspense>
  );
}
