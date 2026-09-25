"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  // Guards the initial mount's /api/me + /api/sessions calls against StrictMode's dev-only
  // double-invoke of effects (review MINOR 2) — keyed on videoId (not just a boolean) so a
  // genuine videoId change still loads. handleReplay/handleRetry call loadSession() directly
  // from a user gesture and are unaffected.
  const initialLoadVideoIdRef = useRef<string | null>(null);

  // --- initial data: /api/me + create/resume the session ---
  const loadSession = useCallback(() => {
    api
      .createSession(videoId)
      .then((session) => dispatch({ type: "SESSION_LOADED", session }))
      .catch((err) => dispatch({ type: "SESSION_LOAD_FAILED", reason: err instanceof ApiError && err.code === "VIDEO_NOT_FOUND" ? "not_found" : "network" }));
  }, [videoId]);

  useEffect(() => {
    if (initialLoadVideoIdRef.current === videoId) return;
    initialLoadVideoIdRef.current = videoId;
    api
      .getMe()
      .then((me) => dispatch({ type: "ME_LOADED", me }))
      .catch(() => dispatch({ type: "ME_FAILED" }));
    loadSession();
  }, [loadSession, videoId]);

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

  const trackerApi = useWatchTracker({
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

  // True from the moment the auto-resume-after-correct-answer timer fires until the player
  // actually confirms PLAYING — the ControlBar toggle is disabled for this window so a click
  // can't race the auto-resume's own seek/play and produce a spurious backward jump (MINOR 3).
  const [autoResuming, setAutoResuming] = useState(false);

  // Armed by the resume-seek effect below whenever the resumed/reloaded session should stay
  // paused. YouTube's seekTo() on a freshly-cued player can silently resume playback on its own
  // — no playVideo() call of ours involved — which let a reloaded session run unattended straight
  // through the quiz gate (found in P6b browser E2E: the Play button ends up permanently disabled
  // because status jumps to "quiz_open" behind the user's back). A ref, not state: it's read only
  // from the imperative onStateChange/handleToggle callbacks, never rendered.
  //
  // One-shot: armed only for the seek it was meant for. If that seek doesn't trigger the quirk
  // (the common case for an already-buffered, non-cued player — e.g. a TICK-overshoot clamp mid-
  // session), the guard must not outlive it — otherwise the NEXT legitimate playVideo() (the
  // quiz auto-resume, or a user's Play click) gets its own PLAYING event swallowed and re-paused,
  // and — since that swallow returns before setAutoResuming(false) — autoResuming gets stuck
  // true, permanently disabling the Play/Pause control (the same symptom, a different trigger;
  // found by planner review after the first fix). Disarmed by: consuming a spurious PLAYING, the
  // next settled (non-BUFFERING, non-UNSTARTED) state, a ~5s backstop timeout, or any programmatic
  // playVideo() we make on purpose (which always clears it first, since a real play should never
  // be swallowed).
  //
  // The backstop is a pure safety net, not the primary disarm path — a real state change always
  // wins if it arrives first. It has to be generous: real instrumentation on the quirk showed an
  // asynchronous UNSTARTED -> BUFFERING -> UNSTARTED -> PLAYING sequence, and a slow buffer can
  // easily outlast a short timer, which would disarm the guard *before* the quirk's own PLAYING
  // lands — letting it straight through as if it were a real, user-initiated play (planner review
  // round: this exact race was observed with the original 1.5s timeout).
  const suppressAutoplayAfterSeekRef = useRef(false);
  const suppressAutoplayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTOPLAY_GUARD_BACKSTOP_MS = 5000;

  const armAutoplayGuard = useCallback(() => {
    suppressAutoplayAfterSeekRef.current = true;
    if (suppressAutoplayTimeoutRef.current !== null) clearTimeout(suppressAutoplayTimeoutRef.current);
    suppressAutoplayTimeoutRef.current = setTimeout(() => {
      suppressAutoplayAfterSeekRef.current = false;
      suppressAutoplayTimeoutRef.current = null;
    }, AUTOPLAY_GUARD_BACKSTOP_MS);
  }, []);

  const clearAutoplayGuard = useCallback(() => {
    suppressAutoplayAfterSeekRef.current = false;
    if (suppressAutoplayTimeoutRef.current !== null) {
      clearTimeout(suppressAutoplayTimeoutRef.current);
      suppressAutoplayTimeoutRef.current = null;
    }
  }, []);

  // Backstops autoResuming: set true the instant the quiz auto-resume timer fires (see below), it
  // must come back to false once the player actually confirms PLAYING. If playVideo() never
  // yields PLAYING — e.g. iOS/Safari silently blocking playback that lacks a user gesture — the
  // Play/Pause control would stay disabled forever with no way for the user to recover. This
  // timeout clears it after a few seconds so a manual tap can take over (planner review round).
  const autoResumingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_RESUMING_BACKSTOP_MS = 3000;

  const armAutoResumingBackstop = useCallback(() => {
    if (autoResumingTimeoutRef.current !== null) clearTimeout(autoResumingTimeoutRef.current);
    autoResumingTimeoutRef.current = setTimeout(() => {
      setAutoResuming(false);
      autoResumingTimeoutRef.current = null;
    }, AUTO_RESUMING_BACKSTOP_MS);
  }, []);

  const clearAutoResumingBackstop = useCallback(() => {
    if (autoResumingTimeoutRef.current !== null) {
      clearTimeout(autoResumingTimeoutRef.current);
      autoResumingTimeoutRef.current = null;
    }
  }, []);

  // Both timeouts above are refs, not tied to any single effect's cleanup — clear them on unmount
  // so a late timer never calls setState after the component is gone.
  useEffect(() => {
    return () => {
      if (suppressAutoplayTimeoutRef.current !== null) clearTimeout(suppressAutoplayTimeoutRef.current);
      if (autoResumingTimeoutRef.current !== null) clearTimeout(autoResumingTimeoutRef.current);
    };
  }, []);

  // --- player state changes drive both the reducer and the server write (plan §6) ---
  useEffect(() => {
    handleStateChangeRef.current = (ytState: number) => {
      if (!player) return;
      const currentTime = player.getCurrentTime();
      if (ytState === YT_PLAYER_STATE.PLAYING) {
        if (suppressAutoplayAfterSeekRef.current) {
          clearAutoplayGuard();
          player.pauseVideo();
          return;
        }
        setAutoResuming(false);
        clearAutoResumingBackstop();
        dispatch({ type: "PLAY_CLICKED" });
        void writer.sendImmediate("PLAY", currentTime);
      } else if (ytState === YT_PLAYER_STATE.BUFFERING || ytState === YT_PLAYER_STATE.UNSTARTED) {
        // Transitional states the seek quirk passes through on its way to the eventual spurious
        // PLAYING (real instrumentation: UNSTARTED -> BUFFERING -> UNSTARTED -> PLAYING) — must
        // NOT disarm the guard here, or the quirk's own PLAYING would slip through unswallowed.
        // Intentionally a no-op; only a settled state (PLAYING/PAUSED/CUED/ENDED) or the backstop
        // timeout above disarms an armed guard.
      } else if (ytState === YT_PLAYER_STATE.PAUSED || ytState === YT_PLAYER_STATE.CUED) {
        clearAutoplayGuard();
        if (ytState === YT_PLAYER_STATE.CUED) return;
        setAutoResuming(false);
        clearAutoResumingBackstop();
        // The gate-hit flow (useWatchTracker) already calls player.pauseVideo() and sends its
        // own PAUSE — skip the duplicate this onStateChange(PAUSED) would otherwise send (MINOR 4).
        if (trackerApi.isGateInFlight()) return;
        dispatch({ type: "PAUSE_CLICKED" });
        void writer.sendImmediate("PAUSE", currentTime);
      } else if (ytState === YT_PLAYER_STATE.ENDED) {
        clearAutoplayGuard();
        clearAutoResumingBackstop();
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

  // --- apply a reducer-requested seek, then resume playback if we're meant to be playing (and
  // aren't already — avoids a redundant playVideo() call while one is already in progress);
  // otherwise arm the guard above, since seekTo() alone can make the player start playing on its
  // own (review MAJOR) ---
  useEffect(() => {
    if (state.pendingSeekTo === null || !player) return;
    if (state.status === "playing") {
      player.seekTo(state.pendingSeekTo, true);
      if (player.getPlayerState() !== YT_PLAYER_STATE.PLAYING) {
        clearAutoplayGuard();
        player.playVideo();
      }
    } else {
      armAutoplayGuard();
      player.seekTo(state.pendingSeekTo, true);
    }
    dispatch({ type: "SEEK_CONSUMED" });
  }, [state.pendingSeekTo, state.status, player, armAutoplayGuard, clearAutoplayGuard]);

  // --- auto-resume 900ms after a correct answer (row 13) ---
  useEffect(() => {
    if (state.status !== "quiz_open" || state.feedback?.tone !== "correct") return;
    const t = setTimeout(() => {
      dispatch({ type: "QUIZ_RESUME_AFTER_CORRECT" });
      setAutoResuming(true);
      armAutoResumingBackstop();
      // A stale guard from an earlier non-autoplaying seek (e.g. a TICK-overshoot clamp while the
      // quiz was open) must not swallow THIS intentional play — clear it first.
      clearAutoplayGuard();
      player?.playVideo();
    }, 900);
    return () => clearTimeout(t);
  }, [state.status, state.feedback, player, clearAutoplayGuard, armAutoResumingBackstop]);

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
    if (!player || !selectPlayButtonEnabled(state) || autoResuming) return;
    if (state.status === "playing") player.pauseVideo();
    else {
      // A real user gesture always wins over the seek-guard above, in case it's still armed.
      clearAutoplayGuard();
      player.playVideo();
    }
  }, [player, state, autoResuming, clearAutoplayGuard]);

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
              enabled={selectPlayButtonEnabled(state) && playerReady && !autoResuming}
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
