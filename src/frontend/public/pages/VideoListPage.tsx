"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicHeader } from "../components/PublicHeader";
import { PointsBadge } from "../components/PointsBadge";
import { PointsSummary } from "../components/PointsSummary";
import { FeaturedVideoCard } from "../components/FeaturedVideoCard";
import { VideoCard } from "../components/VideoCard";
import { VideoGrid } from "../components/VideoGrid";
import { videoList as copy } from "../constants/copy.th";
import { api, ApiError } from "../services/api";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { EmptyState, ErrorState } from "@/frontend/shared/ui/ErrorState";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import type { MeResponse, VideoListResponse } from "@/shared/contracts/video";

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

export function VideoListPage() {
  const [videos, setVideos] = useState<LoadState<VideoListResponse>>({ status: "loading" });
  const [me, setMe] = useState<LoadState<MeResponse>>({ status: "loading" });

  const fetchVideos = useCallback(() => {
    api
      .getVideos()
      .then((data) => setVideos({ status: "ready", data }))
      .catch(() => setVideos({ status: "error" }));
  }, []);

  const fetchMe = useCallback(() => {
    api
      .getMe()
      .then((data) => setMe({ status: "ready", data }))
      .catch((err) => {
        if (err instanceof ApiError) setMe({ status: "error" });
      });
  }, []);

  // The mount fetch relies on the initial state already being "loading"; a retry (event handler,
  // not an effect) explicitly resets it first.
  useEffect(() => {
    fetchVideos();
    fetchMe();
  }, [fetchVideos, fetchMe]);

  const retryVideos = useCallback(() => {
    setVideos({ status: "loading" });
    fetchVideos();
  }, [fetchVideos]);

  const totalPoints = me.status === "ready" ? me.data.totalPoints : null;
  const pointsUnavailable = me.status === "error";
  const rewardedCount = me.status === "ready" ? me.data.rewardedVideoIds.length : 0;

  const isLoading = videos.status === "loading";

  return (
    <>
      <PublicHeader pointsBadge={<PointsBadge totalPoints={totalPoints} unavailable={pointsUnavailable} />} />
      <main
        aria-busy={isLoading}
        style={{ maxWidth: "var(--max-width-public)", margin: "0 auto", padding: "var(--gutter)", display: "flex", flexDirection: "column", gap: 16 }}
      >
        {isLoading && <span className="sr-only">{copy.loadingSr}</span>}

        <section>
          <h1 style={{ fontSize: "var(--fs-display)", fontWeight: 800, letterSpacing: -0.5 }}>{copy.heroTitle}</h1>
          {videos.status === "ready" && <p style={{ marginTop: 4, color: "var(--text-2)" }}>{copy.heroSub}</p>}
        </section>

        {me.status === "ready" && (me.data.totalPoints > 0 || rewardedCount > 0) && (
          <PointsSummary totalPoints={me.data.totalPoints} rewardedCount={rewardedCount} />
        )}

        {videos.status === "ready" && videos.data.videos.length > 0 && videos.data.videos.every((v) => v.rewarded) && (
          <InlineNotice tone="info">{copy.allRewardedBanner}</InlineNotice>
        )}

        {videos.status === "loading" && (
          <>
            <Skeleton height={220} radius="var(--radius-card)" />
            <Skeleton height={140} radius="var(--radius-card)" />
            <Skeleton height={140} radius="var(--radius-card)" />
          </>
        )}

        {videos.status === "error" && (
          <ErrorState title={copy.error.title} body={copy.error.body} action={{ label: copy.error.action, onClick: retryVideos }} />
        )}

        {videos.status === "ready" && <VideoListBody data={videos.data} />}
      </main>
    </>
  );
}

function VideoListBody({ data }: { data: VideoListResponse }) {
  const { featured, videos } = data;
  const rest = featured ? videos.filter((v) => v.id !== featured.id) : videos.slice(1);
  const pseudoFeatured = featured ?? videos[0] ?? null;

  if (!pseudoFeatured) {
    return <EmptyState title={copy.empty.title} body={copy.empty.body} />;
  }

  return (
    <>
      <FeaturedVideoCard video={pseudoFeatured} featured={featured !== null} />
      {rest.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{copy.onlyOneMore}</p>
      ) : (
        <>
          <h2 style={{ fontSize: "var(--fs-h2)", fontWeight: 700 }}>คลิปทั้งหมด</h2>
          <VideoGrid>
            {rest.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </VideoGrid>
        </>
      )}
    </>
  );
}
