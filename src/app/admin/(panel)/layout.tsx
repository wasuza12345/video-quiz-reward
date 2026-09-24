import { AdminShell } from "@/frontend/admin/components/AdminShell";

export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
