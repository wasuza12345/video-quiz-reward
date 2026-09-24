import { Suspense } from "react";
import { AdminUserListPage } from "@/frontend/admin/pages/AdminUserListPage";

export default function AdminUsersRoute() {
  return (
    <Suspense>
      <AdminUserListPage />
    </Suspense>
  );
}
