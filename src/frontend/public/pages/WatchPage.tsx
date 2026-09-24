"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import { PublicHeader } from "../components/PublicHeader";
import { PointsBadge } from "../components/PointsBadge";
import { VideoPlayer } from "../components/VideoPlayer";
import { ControlBar } from "../components/ControlBar";
import { StatusLine } from "../components/StatusLine";
import { QuizProgress } from "../components/QuizProgress";
import { QuizModal } from "../components/QuizModal";
import { ContextBanner } from "../components/ContextBanner";
import { RewardCard } from "../components/RewardCard";
import { HowItWorks } from "../components/HowItWorks";
import { formatTime, watch as copy } from "../constants/copy.th";
import { api, ApiError } from "../services/api";
import { initialWatchState, watchReducer, WATCH_ERRORS } from "../state/watch.reducer";
import { selectCurrentQuestion, selectIsPlaying, selectPlayButtonEnabled, selectStatusLineCopy } from "../state/watch.selectors";
import { useSessionWriter } from "../hooks/useSessionWriter";
import { useWatchTracker } from "../hooks/useWatchTracker";
import { useYouTubePlayer, YT_PLAYER_STATE, youtubePlayerTitle } from "../hooks/useYouTubePlayer";
import { ErrorState } from "@/frontend/shared/ui/ErrorState";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Toast } from "@/frontend/shared/ui/Toast";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { useToast } from "@/frontend/shared/ui/useToast";

export interface WatchPageProps {
  videoId: string;
}

export function WatchPage({ videoId }: WatchPageProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(watchReducer, initialWatchState);
  const writer = useSessionWriter(state.sessionId, state.lastSeq, dispatch);
  const { visible: toast, dismissSticky } = useToast(state.toastRequest);

  const handleStateChangeRef = useRef<(ytState: number) => void>(() => {});
  const { containerRef, player, ready: playerReady, error: playerError } = useYouTubePlayer({
    youtubeId: state.video?.youtubeId ?? "",
    title: youtubePlayerTitle(state.video?.title ?? ""),
    onStateChange: (s) => handleStateChangeRef.current(s),
    onError: () => dispatch({ type: "PLAYER_ERROR" }),
  });

  const playedWallSecRef = useRef(0);
  const claimAttemptedRef = useRef<string | null>(null);

  // --- initial data: /api/me + create/resume the session ---
  const loadSession = useCallback(() => {
    api
      .createSession(videoId)
      .then((session) => dispatch({ type: "SESSION_LOADED", session }))
      .catch((err) => dispatch({ type: "SESSION_LOAD_FAILED", reason: err instanceof ApiError && err.code === "VIDEO_NOT_FOUND" ? "not_found" : "network" }));
  }, [videoId]);

  useEffect(() => {
    api
      .getMe()
      .then((me) => dispatch({ type: "ME_LOADED", me }))
      .catch(() => dispatch({ type: "ME_FAILED" }));
    loadSession();
  }, [loadSession]);

  // --- "taking a while" notice ---
  useEffect(() => {
    if (state.status !== "loading") return;
    const t = setTimeout(() => dispatch({ type: "LOADING_SLOW" }), 8000);
    return () => clearTimeout(t);
  }, [state.status]);

  // --- resets that follow a fresh session ---
  useEffect(() => {
    playedWallSecRef.current = 0;
    claimAttemptedRef.current = null;
  }, [state.sessionId]);

  // --- local wall-clock estimate of PLAYING time, for the ENDED fallback's seek formula only
  // (the server's own playedWallSec is authoritative and isn't returned to the client) ---
  useEffect(() => {
    if (state.status !== "playing") return;
    const t = setInterval(() => {
      playedWallSecRef.current += 1;
    }, 1000);
    return () => clearInterval(t);
  }, [state.status]);

  // --- player state changes drive both the reducer and the server write (plan §6) ---
  useEffect(() => {
    handleStateChangeRef.current = (ytState: number) => {
      if (!player) return;
      const currentTime = player.getCurrentTime();
      if (ytState === YT_PLAYER_STATE.PLAYING) {
        dispatch({ type: "PLAY_CLICKED" });
        void writer.sendImmediate("PLAY", currentTime);
      } else if (ytState === YT_PLAYER_STATE.PAUSED) {
        dispatch({ type: "PAUSE_CLICKED" });
        void writer.sendImmediate("PAUSE", currentTime);
      } else if (ytState === YT_PLAYER_STATE.ENDED) {
        dispatch({ type: "VIDEO_ENDED" });
        const durationSec = state.video?.durationSec ?? 0;
        void writer.sendImmediate("ENDED", currentTime).then((result) => {
          if (!result) return;
          if (result.state === "ENDED") {
            dispatch({ type: "ENDED_ACCEPTED" });
          } else {
            const seekTo = Math.max(0, result.furthestSec - (0.9 * durationSec - playedWallSecRef.current));
            dispatch({ type: "ENDED_NOT_WATCHED", seekTo });
          }
        });
      }
    };
  });

  useWatchTracker({
    player,
    active: state.status === "playing",
    sessionId: state.sessionId,
    furthestSec: state.furthestSec,
    pendingSeekTo: state.pendingSeekTo,
    quizzes: state.quizzes,
    passedQuestionIds: state.passedQuestionIds,
    writer,
    dispatch,
  });

  // --- apply a reducer-requested seek, then resume playback if we're meant to be playing (and
  // aren't already — avoids a redundant playVideo() call while one is already in progress) ---
  useEffect(() => {
    if (state.pendingSeekTo === null || !player) return;
    player.seekTo(state.pendingSeekTo, true);
    if (state.status === "playing" && player.getPlayerState() !== YT_PLAYER_STATE.PLAYING) player.playVideo();
    dispatch({ type: "SEEK_CONSUMED" });
  }, [state.pendingSeekTo, state.status, player]);

  // --- auto-resume 900ms after a correct answer (row 13) ---
  useEffect(() => {
    if (state.status !== "quiz_open" || state.feedback?.tone !== "correct") return;
    const t = setTimeout(() => {
      dispatch({ type: "QUIZ_RESUME_AFTER_CORRECT" });
      player?.playVideo();
    }, 900);
    return () => clearTimeout(t);
  }, [state.status, state.feedback, player]);

  // --- auto-claim once ended (rows 5, 18) ---
  useEffect(() => {
    if (state.status !== "claiming" || !state.sessionId) return;
    if (claimAttemptedRef.current === state.sessionId && !state.claimError) return;
    claimAttemptedRef.current = state.sessionId;
    void writer.sendClaim().then((result) => {
      if ("failed" in result) {
        dispatch(result.reason === "not_ended" ? { type: "CLAIM_NOT_ENDED" } : { type: "CLAIM_FAILED" });
      } else {
        dispatch({ type: "CLAIM_ACCEPTED", result });
      }
    });
  }, [state.status, state.sessionId, state.claimError, writer]);

  // --- offline/online ---
  useEffect(() => {
    const onOffline = () => dispatch({ type: "OFFLINE" });
    const onOnline = () => {
      dispatch({ type: "ONLINE" });
      dismissSticky();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [dismissSticky]);

  // --- tab hidden: pause + a best-effort TAB_HIDDEN send when nothing else is in flight ---
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || !player) return;
      const currentTime = player.getCurrentTime();
      dispatch({ type: "TAB_HIDDEN" });
      player.pauseVideo();
      if (!writer.isInFlight()) void writer.sendImmediate("TAB_HIDDEN", currentTime, undefined, { keepalive: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [player, writer]);

  const handleToggle = useCallback(() => {
    if (!player || !selectPlayButtonEnabled(state)) return;
    if (state.status === "playing") player.pauseVideo();
    else player.playVideo();
  }, [player, state]);

  const handleChoice = useCallback(
    (choice: string) => {
      const question = selectCurrentQuestion(state);
      if (!question) return;
      dispatch({ type: "ANSWER_SUBMITTED", choice });
      void writer.sendAnswer(question.id, choice).then((result) => {
        if ("failed" in result) dispatch({ type: "ANSWER_FAILED", code: result.code });
        else dispatch({ type: "ANSWER_ACCEPTED", result });
      });
    },
    [state, writer],
  );

  const handleReplay = useCallback(() => {
    dispatch({ type: "REPLAY_REQUESTED" });
    loadSession();
  }, [loadSession]);

  const handleRetry = useCallback(() => {
    dispatch({ type: "RETRY_REQUESTED" });
    if (state.status === "error") loadSession();
  }, [state.status, loadSession]);

  const pointsBadge = <PointsBadge totalPoints={state.totalPoints} unavailable={state.pointsUnavailable} />;

  if (state.status === "error" && state.error) {
    return (
      <>
        <PublicHeader showBack pointsBadge={pointsBadge} />
        <main style={{ maxWidth: "var(--max-width-watch)", margin: "0 auto", padding: "var(--gutter)" }}>
          <ErrorState
            title={state.error.title}
            body={state.error.body}
            action={{ label: state.error.action, onClick: state.error === WATCH_ERRORS.videoNotFound ? () => router.push("/") : handleRetry }}
            secondaryAction={state.error.secondaryAction ? { label: state.error.secondaryAction, onClick: () => router.push("/") } : undefined}
          />
        </main>
      </>
    );
  }

  const currentQuestion = selectCurrentQuestion(state);
  const questionNumber = currentQuestion ? state.quizzes.findIndex((q) => q.id === currentQuestion.id) + 1 : 0;
  const isPlaying = selectIsPlaying(state);
  const isLoading = state.status === "loading";

  return (
    <>
      <PublicHeader showBack pointsBadge={pointsBadge} />
      <main aria-busy={isLoading} style={{ maxWidth: "var(--max-width-watch)", margin: "0 auto", padding: "var(--gutter)", display: "flex", flexDirection: "column", gap: 12 }}>
        {!isLoading && state.video && (
          <div className="watch-title-desktop">
            <h1 style={{ fontSize: "var(--fs-h1)", fontWeight: 700 }}>{state.video.title}</h1>
            {state.video.channelName && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>วิดีโอจาก YouTube: {state.video.channelName}</p>}
          </div>
        )}

        {state.showResumedBanner && state.video && <ContextBanner tone="info">{copy.contextBanner.resumed(formatTime(state.positionSec))}</ContextBanner>}
        {state.showReplayBanner && !state.showResumedBanner && <ContextBanner tone="info">{copy.contextBanner.replayStart}</ContextBanner>}

        {isLoading ? (
          <div style={{ aspectRatio: "16/9", borderRadius: "var(--radius-media)", overflow: "hidden" }}>
            <Skeleton height="100%" radius={0} />
          </div>
        ) : playerError ? (
          <ErrorState title={copy.error.playerFailed.title} body={copy.error.playerFailed.body} action={{ label: copy.error.playerFailed.action, onClick: () => window.location.reload() }} />
        ) : (
          <VideoPlayer
            containerRef={containerRef}
            showCentrePlay={!isPlaying && state.status !== "quiz_open" && state.status !== "ended" && state.status !== "claiming"}
            onShieldClick={handleToggle}
            shieldLabel={isPlaying ? copy.controlBar.pauseAriaLabel : copy.controlBar.playAriaLabel}
          />
        )}

        {!isLoading && state.video && (
          <>
            <ControlBar
              isPlaying={isPlaying}
              enabled={selectPlayButtonEnabled(state) && playerReady}
              onToggle={handleToggle}
              positionSec={state.positionSec}
              furthestSec={state.furthestSec}
              durationSec={state.video.durationSec}
              quizzes={state.quizzes}
              passedQuestionIds={state.passedQuestionIds}
            />
            <StatusLine text={selectStatusLineCopy(state)} />

            {state.inlineNotice === "ended_fallback" && <InlineNotice tone="info">{copy.inlineNotice.endedFallback}</InlineNotice>}
            {state.claimError && (
              <InlineNotice tone="danger" action={{ label: copy.inlineNotice.claimFailed.action, onClick: () => dispatch({ type: "RETRY_REQUESTED" }) }}>
                {copy.inlineNotice.claimFailed.title}
              </InlineNotice>
            )}

            {state.status === "rewarded" && state.claimResult?.awarded && (
              <RewardCard
                points={state.claimResult.points}
                totalPoints={state.claimResult.totalPoints}
                onRewatch={handleReplay}
                onOtherVideos={() => router.push("/")}
              />
            )}
            {state.status === "rewarded" && state.inlineNotice === "replay_end" && (
              <InlineNotice tone="info" action={{ label: copy.replayEnd.watchAgain, onClick: handleReplay }}>
                {copy.inlineNotice.replayEnd}
              </InlineNotice>
            )}

            <QuizProgress quizzes={state.quizzes} passedQuestionIds={state.passedQuestionIds} />
            <div className="watch-title-mobile">
              <h1 style={{ fontSize: "var(--fs-h1)", fontWeight: 700 }}>{state.video.title}</h1>
              {state.video.channelName && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>วิดีโอจาก YouTube: {state.video.channelName}</p>}
            </div>
            <HowItWorks />
          </>
        )}

        <QuizModal
          open={state.status === "quiz_open" && currentQuestion !== null}
          question={currentQuestion}
          questionNumber={questionNumber || 1}
          totalQuestions={state.quizzes.length}
          phase={state.quizPhase}
          pendingChoice={state.pendingChoice}
          wrongChoiceLabels={state.wrongChoiceLabels}
          feedback={state.feedback}
          onChoose={handleChoice}
        />
      </main>
      {toast && <Toast message={toast.message} />}
    </>
  );
}
