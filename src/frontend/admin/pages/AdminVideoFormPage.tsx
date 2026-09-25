"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/frontend/shared/ui/Badge";
import { BackLink } from "@/frontend/shared/ui/BackLink";
import { Button } from "@/frontend/shared/ui/Button";
import { ConfirmDialog } from "@/frontend/shared/ui/ConfirmDialog";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { Toast } from "@/frontend/shared/ui/Toast";
import { useSimpleToast } from "@/frontend/shared/ui/useSimpleToast";
import { PageHeader } from "../components/AdminShell";
import { KebabMenu, type KebabMenuItem } from "../components/KebabMenu";
import { LockNotice } from "../components/LockNotice";
import { QuizEditor } from "../components/QuizEditor";
import { StatusBadge } from "../components/StatusBadge";
import { VideoForm, type VideoFormValues } from "../components/VideoForm";
import { YouTubePreview, type YouTubePreviewHandle } from "../components/YouTubePreview";
import { videoForm as copy, sessions as sessionsCopy } from "../constants/copy.th";
import { formatMmSsTenths } from "../lib/time";
import { parseYoutubeId } from "@/shared/youtube-id";
import { VIDEO_ISSUE } from "@/shared/constants/video";
import type { AdminQuestionDetail, AdminVideoDetail } from "@/shared/contracts/admin";
import { AdminApiError, adminApi } from "../services/api";

/** Thai copy for a publish/feature/archive failure. VALIDATION_ERROR/INVALID_TRIGGER can only come
 * from adminPublish's quiz checks (plan §4.5); INVALID_TRIGGER's extra.triggerSec names the
 * offending question so the toast can point the admin at it directly. Pure/exported for
 * tests/unit/frontend/admin-video-form-errors.test.ts. */
export function publishOrFeatureErrorMessage(err: { code: string; extra: Record<string, unknown> }): string {
  if (err.code === "INVALID_TRIGGER") {
    const triggerSec = err.extra.triggerSec;
    return copy.errors.invalidTrigger(typeof triggerSec === "number" ? formatMmSsTenths(triggerSec) : "");
  }
  if (err.code === "VALIDATION_ERROR") return copy.errors.validation;
  if (err.code === "INVALID_TRANSITION") return sessionsCopy.rejectReason.INVALID_TRANSITION;
  if (err.code === "BAD_ORIGIN") return copy.badOrigin;
  return copy.errors.generic;
}

/** Thai copy for a youtubeUrl save-validation issue. The server's own issue.message distinguishes
 * VIDEO_ISSUE.ALREADY_ADDED (video.service.ts, a duplicate) from every other reason (invalid/
 * unembeddable URL) — used to always map to the generic "invalid link" copy, even a duplicate
 * (tester audit MINOR 1). Pure/exported for tests/unit/frontend/admin-video-form-errors.test.ts. */
export function youtubeUrlIssueMessage(issueMessage: string): string {
  return issueMessage === VIDEO_ISSUE.ALREADY_ADDED ? copy.fields.youtubeUrl.duplicateError : copy.fields.youtubeUrl.error;
}

export function AdminVideoFormPage({ videoId }: { videoId?: string }) {
  const mode: "create" | "edit" = videoId ? "edit" : "create";
  const router = useRouter();
  const { show, visible } = useSimpleToast();

  const [video, setVideo] = useState<AdminVideoDetail | null>(null);
  const [questions, setQuestions] = useState<AdminQuestionDetail[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState(false);

  const [values, setValues] = useState<VideoFormValues>({ youtubeUrl: "", title: "", rewardPoints: 50 });
  const [channelName, setChannelName] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ youtubeUrl?: string; durationSec?: string; rewardPoints?: string; general?: string }>({});
  const [saving, setSaving] = useState(false);

  const [previewHandle, setPreviewHandle] = useState<YouTubePreviewHandle | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !videoId) return;
    adminApi
      .getVideo(videoId)
      .then((v) => {
        setVideo(v);
        setQuestions(v.questions);
        setValues({ youtubeUrl: `https://youtu.be/${v.youtubeId}`, title: v.title, rewardPoints: v.rewardPoints });
        setChannelName(v.channelName);
        setDurationSec(v.durationSec);
      })
      .catch((err) => {
        if (err instanceof AdminApiError && err.code === "UNAUTHENTICATED") router.push("/admin/login?reason=expired");
        else setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [mode, videoId, router]);

  const youtubeId = parseYoutubeId(values.youtubeUrl);
  const locked = video?.locked ?? false;

  useEffect(() => {
    // No synchronous setState here (react-hooks/set-state-in-effect) — the preview player is
    // destroyed and rebuilt whenever youtubeId changes (useAdminYouTubePreview), so the stale
    // handle is dropped by THIS run's cleanup, right before the next youtubeId's effect fires
    // (same pattern as useAdminYouTubePreview.ts's own cleanup).
    return () => {
      setPreviewReady(false);
      setPreviewHandle(null);
      setPreviewCurrentTime(0);
    };
  }, [youtubeId]);

  const handlePreviewReady = useCallback((handle: YouTubePreviewHandle) => {
    setPreviewHandle(handle);
    setPreviewReady(true);
  }, []);
  const handleDuration = useCallback(
    (d: number) => {
      // Only auto-fill from the preview while duration isn't locked (create, or an unlocked edit
      // where the admin is actively replacing the link) — plan §7: "durationSec ... admin input trusted".
      if (mode === "create" || !locked) setDurationSec(Math.round(d * 10) / 10);
    },
    [mode, locked],
  );

  const dirty =
    mode === "edit" && video
      ? values.title !== video.title || values.rewardPoints !== video.rewardPoints || (!locked && values.youtubeUrl !== `https://youtu.be/${video.youtubeId}`)
      : false;

  const handleSave = async () => {
    setErrors({});
    if (values.rewardPoints < 1 || values.rewardPoints > 1000 || !Number.isInteger(values.rewardPoints)) {
      setErrors({ rewardPoints: copy.fields.rewardPoints.error });
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        if (!durationSec || durationSec <= 0) {
          setErrors({ durationSec: copy.fields.durationSec.error });
          setSaving(false);
          return;
        }
        const created = await adminApi.createVideo({ youtubeUrl: values.youtubeUrl, title: values.title.trim() || undefined, durationSec, rewardPoints: values.rewardPoints });
        show(copy.savedToast);
        router.push(`/admin/videos/${created.id}`);
        return;
      }
      if (video) {
        const patch: { title?: string; rewardPoints?: number; youtubeUrl?: string } = { title: values.title, rewardPoints: values.rewardPoints };
        if (!locked && values.youtubeUrl !== `https://youtu.be/${video.youtubeId}`) patch.youtubeUrl = values.youtubeUrl;
        const updated = await adminApi.updateVideo(video.id, patch);
        const fresh = await adminApi.getVideo(video.id);
        setVideo(fresh);
        setQuestions(fresh.questions);
        setChannelName(fresh.channelName);
        setDurationSec(fresh.durationSec);
        void updated;
        show(copy.savedEditToast);
      }
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.code === "VALIDATION_ERROR") {
          const issues = (err.extra.issues as { path: string; message: string }[] | undefined) ?? [];
          const next: typeof errors = {};
          for (const issue of issues) {
            if (issue.path === "youtubeUrl") next.youtubeUrl = youtubeUrlIssueMessage(issue.message);
            else if (issue.path === "durationSec") next.durationSec = copy.fields.durationSec.error;
            else if (issue.path === "rewardPoints") next.rewardPoints = copy.fields.rewardPoints.error;
          }
          setErrors(Object.keys(next).length ? next : { general: err.message });
        } else if (err.code === "VIDEO_LOCKED") {
          show(copy.lockedToast);
          if (videoId) {
            const fresh = await adminApi.getVideo(videoId).catch(() => null);
            if (fresh) {
              setVideo(fresh);
              setValues({ youtubeUrl: `https://youtu.be/${fresh.youtubeId}`, title: fresh.title, rewardPoints: fresh.rewardPoints });
              setDurationSec(fresh.durationSec);
            }
          }
        } else if (err.code === "BAD_ORIGIN") {
          setErrors({ general: copy.badOrigin });
        } else if (err.code === "UNAUTHENTICATED") {
          router.push("/admin/login?reason=expired");
        } else {
          setErrors({ general: err.message });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!video) return;
    try {
      await adminApi.publishVideo(video.id);
      const fresh = await adminApi.getVideo(video.id);
      setVideo(fresh);
      show("เผยแพร่แล้วค่ะ");
    } catch (err) {
      if (!(err instanceof AdminApiError)) return;
      if (err.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
      show(publishOrFeatureErrorMessage(err));
    }
  };

  const handleFeature = async () => {
    if (!video) return;
    try {
      await adminApi.featureVideo(video.id);
      const fresh = await adminApi.getVideo(video.id);
      setVideo(fresh);
      show("ตั้งเป็นคลิปแนะนำแล้วค่ะ (คลิปแนะนำเดิมถูกยกเลิก)");
    } catch (err) {
      if (!(err instanceof AdminApiError)) return;
      if (err.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
      show(publishOrFeatureErrorMessage(err));
    }
  };

  const handleArchive = async () => {
    if (!video) return;
    setArchiveConfirm(false);
    try {
      await adminApi.archiveVideo(video.id);
      router.push("/admin/videos");
    } catch (err) {
      if (!(err instanceof AdminApiError)) return;
      if (err.code === "UNAUTHENTICATED") return router.push("/admin/login?reason=expired");
      show(publishOrFeatureErrorMessage(err));
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton height={40} width={240} />
        <div style={{ marginTop: 20, display: "grid", gap: 24, gridTemplateColumns: "5fr 7fr" }}>
          <Skeleton height={280} radius={14} />
          <Skeleton height={400} radius="var(--radius-card)" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return <InlineNotice tone="danger">โหลดข้อมูลวิดีโอไม่สำเร็จ</InlineNotice>;
  }

  const kebabItems: KebabMenuItem[] = video ? [{ key: "archive", label: "เก็บถาวร", onSelect: () => setArchiveConfirm(true), tone: "danger" }] : [];

  return (
    <div>
      <BackLink href="/admin/videos" label={copy.backLink} />
      <PageHeader
        title={mode === "create" ? copy.newTitle : copy.editTitle}
        action={
          video && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusBadge status={video.status} />
              {video.status === "draft" && (
                <Button variant="outline" size="sm" onClick={handlePublish}>
                  {copy.publishAction}
                </Button>
              )}
              {video.status === "published" && !video.isFeatured && (
                <Button variant="outline" size="sm" onClick={handleFeature}>
                  {copy.featureAction}
                </Button>
              )}
              {video.isFeatured && <Badge tone="navy">{copy.featuredBadge}</Badge>}
              <KebabMenu ariaLabel="video actions" items={kebabItems} />
            </div>
          )
        }
      />

      {errors.general && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="danger">{errors.general}</InlineNotice>
        </div>
      )}

      {video?.locked && (
        <div style={{ marginBottom: 16 }}>
          <LockNotice sessionCount={video.sessionCount} id="video-locked-notice" />
        </div>
      )}

      {video && video.status === "draft" && video.questionCount === 0 && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="warning">{copy.zeroQuestionsWarning}</InlineNotice>
        </div>
      )}

      <div className="video-form-grid" style={{ display: "grid", gap: 24 }}>
        <div>
          <YouTubePreview youtubeId={youtubeId} onReady={handlePreviewReady} onDuration={handleDuration} onTimeUpdate={setPreviewCurrentTime} />
        </div>
        <div>
          <VideoForm mode={mode} values={values} onChange={setValues} channelName={channelName} durationSec={durationSec} locked={locked} errors={errors} />
          <div style={{ marginTop: 16 }}>
            <Button variant="primary-navy" loading={saving} disabled={mode === "edit" && !dirty} onClick={handleSave}>
              {mode === "create" ? copy.saveCreate : copy.saveEdit}
            </Button>
          </div>
          {mode === "edit" && video && (
            <QuizEditor
              videoId={video.id}
              questions={questions}
              durationSec={durationSec ?? video.durationSec}
              locked={locked}
              videoSaved
              previewReady={previewReady}
              previewHandle={previewHandle}
              previewCurrentTime={previewCurrentTime}
              onQuestionsChange={setQuestions}
            />
          )}
        </div>
      </div>

      {visible && <Toast message={visible.message} />}

      <ConfirmDialog
        open={archiveConfirm}
        title="เก็บคลิปนี้ถาวร?"
        body="ผู้ชมใหม่จะไม่เห็นคลิปนี้ ผู้ที่เริ่มดูไว้แล้วยังดูต่อและรับแต้มได้ค่ะ"
        cancelLabel="ยกเลิก"
        confirmLabel="เก็บถาวร"
        tone="danger"
        onCancel={() => setArchiveConfirm(false)}
        onConfirm={handleArchive}
      />
    </div>
  );
}
