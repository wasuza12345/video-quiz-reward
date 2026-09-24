import { WatchPage } from "@/frontend/public/pages/WatchPage";

export default async function WatchRoute({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  return <WatchPage videoId={videoId} />;
}
