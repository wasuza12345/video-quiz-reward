import { Suspense } from "react";
import { AdminSessionDetailPage } from "@/frontend/admin/pages/AdminSessionDetailPage";

export default async function AdminSessionDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AdminSessionDetailPage sessionId={id} />
    </Suspense>
  );
}
