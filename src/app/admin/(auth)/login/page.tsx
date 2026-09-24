import { Suspense } from "react";
import { AdminLoginPage } from "@/frontend/admin/pages/AdminLoginPage";

export default function AdminLoginRoute() {
  return (
    <Suspense>
      <AdminLoginPage />
    </Suspense>
  );
}
