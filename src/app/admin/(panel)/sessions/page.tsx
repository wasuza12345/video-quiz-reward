import { Suspense } from "react";
import { AdminSessionListPage } from "@/frontend/admin/pages/AdminSessionListPage";

export default function AdminSessionsRoute() {
  return (
    <Suspense>
      <AdminSessionListPage />
    </Suspense>
  );
}
