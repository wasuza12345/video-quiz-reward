import { AdminVideoFormPage } from "@/frontend/admin/pages/AdminVideoFormPage";

export default async function AdminVideoEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminVideoFormPage videoId={id} />;
}
