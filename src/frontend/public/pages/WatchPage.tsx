"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicHeader } from "../components/PublicHeader";
import { PointsBadge } from "../components/PointsBadge";
import { VideoPlayer } from "../components/VideoPlayer";
import { LiveControlBar } from "../components/LiveControlBar";
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
import { useYouTubePlayer, youtubePlayerTitle } from "../hooks/useYouTubePlayer";
import { ErrorState } from "@/frontend/shared/ui/ErrorState";
import { InlineNotice } from "@/frontend/shared/ui/InlineNotice";
import { Toast } from "@/frontend/shared/ui/Toast";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { useToast } from "@/frontend/shared/ui/useToast";

export interface WatchPageProps {
  videoId: string;
}

function VideoTitle({ video }: { video: { title: string; channelName: string } }) {
  return (
    <>
      <h1 style={{ fontSize: "var(--fs-h1)", fontWeight: 700 }}>{video.title}</h1>
      {video.channelName && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>วิดีโอจาก YouTube: {video.channelName}</p>}
    </>
  );
}

export function WatchPage({ videoId }: WatchPageProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(watchReducer, initialWatchState);
  const writer = useSessionWriter(state.sessionId, state.lastSeq, dispatch);
  const { visible: toast, dismissSticky } = useToast(state.toastRequest);

  const onPlayRef = useRef<(positionSec: number) => void>(() => {});
  const onPauseRef = useRef<(positionSec: number) => void>(() => {});
  const onEndedRef = useRef<(positionSec: number) => void>(() => {});
  const { containerRef, player, rawPlayer, ready: playerReady, error: playerError } = useYouTubePlayer({
    youtubeId: state.video?.youtubeId ?? "",
    title: youtubePlayerTitle(state.video?.title ?? ""),
    onPlay: (pos) => onPlayRef.current(pos),
    onPause: (pos) => onPauseRef.current(pos),
    onEnded: (pos) => onEndedRef.current(pos),
    onError: () => dispatch({ type: "PLAYER_ERROR" }),
  });

  const claimAttemptedRef = useRef<string | null>(null);
  // ENDED_NOT_WATCHED recovery bookkeeping: a seek-back that didn't move the player far enough
  // can re-fire ENDED almost immediately — ~110 ENDED sends ~80ms apart, softRejectCount 107, in
  // one observed case. A re-ENDED within ENDED_RECOVERY_TIGHT_WINDOW_SEC of the last recovery seek
  // is that same tight loop; one after genuine real playback is a fresh attempt and must not
  // inherit an old, already-resolved tight streak. After MAX_TIGHT_ENDED_RECOVERY_ATTEMPTS tight
  // re-ends in a row, the client must still never sit silently in "playing" at ENDED: a short
  // server-measured playedWall with furthest already near the end can make every recovery attempt
  // land right back at the end again, even with the corrected seek formula below — see
  // attemptEndedRecovery.
  const endedRecoveryAttemptsRef = useRef(0);
  const lastEndedRecoverySeekAtRef = useRef<number | null>(null);
  const endedRecoveryRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ENDED_RECOVERY_TIGHT_WINDOW_SEC = 2;
  const MAX_TIGHT_ENDED_RECOVERY_ATTEMPTS = 3;
  // Guards the initial mount's /api/me + /api/sessions calls against StrictMode's dev-only
  // double-invoke of effects — keyed on videoId (not just a boolean) so a
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

  const trackerApi = useWatchTracker({
    player: rawPlayer,
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
  // can't race the auto-resume's own seek/play and produce a spurious backward jump.
  const [autoResuming, setAutoResuming] = useState(false);

  // Backstops autoResuming: set true the instant the quiz auto-resume timer fires (see below), it
  // must come back to false once the player actually confirms PLAYING. If playVideo() never
  // yields PLAYING — e.g. iOS/Safari silently blocking playback that lacks a user gesture — the
  // Play/Pause control would stay disabled forever with no way for the user to recover. This
  // timeout clears it after a few seconds so a manual tap can take over.
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

  // These timeouts are all refs, not tied to any single effect's cleanup — clear them on unmount
  // so a late timer never calls setState (or, for the ENDED recovery retry, touches the player)
  // after the component is gone.
  useEffect(() => {
    return () => {
      if (autoResumingTimeoutRef.current !== null) clearTimeout(autoResumingTimeoutRef.current);
      if (endedRecoveryRetryTimeoutRef.current !== null) clearTimeout(endedRecoveryRetryTimeoutRef.current);
    };
  }, []);

  // --- resets that follow a fresh session — including an in-app replay of the same video, which
  // reuses the existing player instance rather than remounting it. autoResuming/the autoplay
  // guard are otherwise only ever cleared by a
  // player state change or their own backstop timers, none of which fire on a session swap by
  // itself — stale from the just-ended previous session, they'd wrongly keep the just-armed
  // pendingSeekTo-to-0 guard (or a stuck autoResuming) around into the new one. ---
  useEffect(() => {
    claimAttemptedRef.current = null;
    endedRecoveryAttemptsRef.current = 0;
    lastEndedRecoverySeekAtRef.current = null;
    if (endedRecoveryRetryTimeoutRef.current !== null) {
      clearTimeout(endedRecoveryRetryTimeoutRef.current);
      endedRecoveryRetryTimeoutRef.current = null;
    }
    player?.resetGuard();
    clearAutoResumingBackstop();
  }, [state.sessionId, player, clearAutoResumingBackstop]);
  // autoResuming reset via React's documented "adjust state during render" pattern (not an effect
  // — a synchronous setState in an effect body is a lint error; a ref read during render is too —
  // and this way never even paints the stale value for a frame).
  const [autoResumingSessionId, setAutoResumingSessionId] = useState(state.sessionId);
  if (autoResumingSessionId !== state.sessionId) {
    setAutoResumingSessionId(state.sessionId);
    if (autoResuming) setAutoResuming(false);
  }

  // --- player state changes drive both the reducer and the server write (plan §6) ---
  useEffect(() => {
    // Handles every real ENDED transition, including a recovery's own re-ENDED. Never gives up
    // silently: a short server-measured playedWall (credit is
    // capped at 10s/event — a mobile stall, a slow write, or background throttling can all make
    // it fall behind) combined with furthest already near the end could make the OLD, client-
    // estimate-only seek formula land right back at the end, over and over, forever (dev.db:
    // playedWall 33 vs furthest 43.5 — the client's own deficit came out <= 0 while the server's
    // real one was still 8s). Fixed two ways: the seek now uses the server's own authoritative
    // remainingWatchSec instead of the client's local (less reliable) estimate; and a tight-loop
    // detector only counts a re-ENDED against the cap when it arrives within
    // ENDED_RECOVERY_TIGHT_WINDOW_SEC of the last recovery seek — one after genuine real
    // playback is a fresh attempt. Once actually capped, this still never sits silently in
    // "playing" at ENDED: the recovery dispatch (and its inline notice) always fires, and a
    // backstop retry is scheduled for after the server's own reported remaining time.
    const attemptEndedRecovery = (currentTime: number) => {
      if (endedRecoveryRetryTimeoutRef.current !== null) {
        clearTimeout(endedRecoveryRetryTimeoutRef.current);
        endedRecoveryRetryTimeoutRef.current = null;
      }
      const now = performance.now();
      const isTightReEnd =
        lastEndedRecoverySeekAtRef.current !== null && (now - lastEndedRecoverySeekAtRef.current) / 1000 < ENDED_RECOVERY_TIGHT_WINDOW_SEC;
      if (!isTightReEnd) endedRecoveryAttemptsRef.current = 0;
      endedRecoveryAttemptsRef.current += 1;

      dispatch({ type: "VIDEO_ENDED" });
      void writer.sendImmediate("ENDED", currentTime).then((result) => {
        if (!result) return;
        if (result.state === "ENDED") {
          endedRecoveryAttemptsRef.current = 0;
          lastEndedRecoverySeekAtRef.current = null;
          dispatch({ type: "ENDED_ACCEPTED" });
          return;
        }
        const seekTo = Math.max(0, result.furthestSec - result.remainingWatchSec - 2);
        lastEndedRecoverySeekAtRef.current = performance.now();
        dispatch({ type: "ENDED_NOT_WATCHED", seekTo });

        if (endedRecoveryAttemptsRef.current >= MAX_TIGHT_ENDED_RECOVERY_ATTEMPTS) {
          // The seek-back above already resumes playback, which should reach a real ENDED again
          // on its own — this is a backstop for when it doesn't, waiting out the server's own
          // reported remaining watch time (not hammering it every ~80ms) before trying once
          // more. A later real ENDED (tight or not) clears this via the guard at the top.
          //
          // Floored at ENDED_RECOVERY_TIGHT_WINDOW_SEC + 3: when remainingWatchSec is 0 (e.g. the
          // player genuinely can't move —
          // furthestSec is what's actually short, not playedWall), the old (remaining + 1)s delay
          // was only 1s — inside the 2s tight window, so every backstop-triggered retry looked
          // like the SAME stuck streak, stayed capped, and rescheduled itself again at 1s: a
          // steady ~1Hz ENDED loop with no backoff, until the server started 429ing it. Flooring
          // the delay outside the tight window means each backstop retry is always treated as a
          // fresh attempt, so it never re-triggers itself immediately again.
          const retryDelaySec = Math.max(result.remainingWatchSec + 1, ENDED_RECOVERY_TIGHT_WINDOW_SEC + 3);
          endedRecoveryRetryTimeoutRef.current = setTimeout(
            () => {
              endedRecoveryRetryTimeoutRef.current = null;
              if (!player) return;
              attemptEndedRecovery(player.currentTime());
            },
            retryDelaySec * 1000,
          );
        }
      });
    };

    // The adapter has already filtered out every YouTube quirk (spurious/swallowed PLAYING,
    // BUFFERING/UNSTARTED/CUED) by the time these fire — currentTime is always a real, settled
    // position for a genuine play/pause/end.
    onPlayRef.current = (currentTime: number) => {
      // Hidden-tab edge: if the tab was backgrounded after the quiz auto-resume's own play() call
      // but before this PLAYING confirmation arrived (both real, independently-async postMessage
      // round trips — nothing orders them), state.status was still "paused"/"quiz_open" the whole
      // time, so the separate visibilitychange handler's own status==="playing" guard never fired
      // for it — the real player would otherwise keep playing in the background, unseen and
      // unreported, until the user comes back. Catch it here instead: never accept a PLAYING
      // confirmation while hidden.
      if (document.visibilityState === "hidden") {
        dispatch({ type: "TAB_HIDDEN" });
        player?.pause();
        if (!writer.isInFlight()) void writer.sendImmediate("TAB_HIDDEN", currentTime, undefined, { keepalive: true });
        return;
      }
      setAutoResuming(false);
      clearAutoResumingBackstop();
      // The PAUSED event's own position is itself stale on real YouTube — the ~0.27s pause-
      // settle creep only becomes visible here, at the next genuine PLAYING read. Bounded the
      // same way as the PAUSED call below.
      trackerApi.noteSettled(currentTime);
      dispatch({ type: "PLAY_CLICKED" });
      void writer.sendImmediate("PLAY", currentTime);
    };

    onPauseRef.current = (currentTime: number) => {
      // Trust the (possibly stale) PAUSED position outright too — see noteSettled's own comment
      // and the PLAYING branch above for why both call sites matter.
      trackerApi.noteSettled(currentTime);
      setAutoResuming(false);
      clearAutoResumingBackstop();
      // The gate-hit flow (useWatchTracker) already calls player.pause() and sends its
      // own PAUSE — skip the duplicate this would otherwise send.
      if (trackerApi.isGateInFlight()) return;
      dispatch({ type: "PAUSE_CLICKED" });
      void writer.sendImmediate("PAUSE", currentTime);
    };

    onEndedRef.current = (currentTime: number) => {
      clearAutoResumingBackstop();
      attemptEndedRecovery(currentTime);
    };
  });

  // --- apply a reducer-requested seek, then resume playback if we're meant to be playing —
  // otherwise stay paused. The adapter owns the ENDED-unstick quirk (seekTo() alone is a no-op
  // once ENDED) and the autoplay-after-seek guard for the "stay paused" case. ---
  useEffect(() => {
    if (state.pendingSeekTo === null || !player) return;
    player.seekTo(state.pendingSeekTo, { resume: state.status === "playing" });
    dispatch({ type: "SEEK_CONSUMED" });
  }, [state.pendingSeekTo, state.status, player]);

  // --- auto-resume 900ms after a correct answer (row 13) ---
  useEffect(() => {
    if (state.status !== "quiz_open" || state.feedback?.tone !== "correct") return;
    const t = setTimeout(() => {
      const hidden = document.visibilityState === "hidden";
      dispatch({ type: "QUIZ_RESUME_AFTER_CORRECT", hidden });
      // A hidden tab never gets rAF ticks, so playVideo() here would silently start real playback
      // (and TICKs) the user can't see or stop. Leave status "paused" (already set above, tagged
      // pausedByTabHidden so the "you left the tab" notice shows) so the user resumes with an
      // explicit tap on return.
      if (hidden) return;
      setAutoResuming(true);
      armAutoResumingBackstop();
      // player.play() clears any stale guard from an earlier non-autoplaying seek (e.g. a
      // TICK-overshoot clamp while the quiz was open) on its own — a real intentional play must
      // never be swallowed.
      player?.play();
    }, 900);
    return () => clearTimeout(t);
  }, [state.status, state.feedback, player, armAutoResumingBackstop]);

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
    const onOnline = () => dismissSticky();
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
      // Gated on status === "playing", matching the reducer's own TAB_HIDDEN guard — calling
      // player.pauseVideo() unconditionally used to pause the REAL player even while, say, the
      // quiz modal was open waiting on the 900ms auto-resume timer (status "quiz_open", not
      // "playing" yet). That pause and the auto-resume's own later playVideo() could then race:
      // if the (now-stale) PAUSED event from this pause arrived AFTER the auto-resume's PLAYING
      // one, PAUSE_CLICKED's own guard (only "status !== playing" — no staleness check) would
      // wrongly flip status back to "paused" with no real pause ever having been issued for that,
      // permanently stopping useWatchTracker's rAF/TICK loop while the real player kept playing
      // (one observed case: 30s with zero TICKs after an honest answer). Nothing meaningful to
      // pause here anyway while not "playing".
      if (document.visibilityState !== "hidden" || !player || state.status !== "playing") return;
      const currentTime = player.currentTime();
      dispatch({ type: "TAB_HIDDEN" });
      player.pause();
      if (!writer.isInFlight()) void writer.sendImmediate("TAB_HIDDEN", currentTime, undefined, { keepalive: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [player, writer, state.status]);

  const handleToggle = useCallback(() => {
    if (!player || !selectPlayButtonEnabled(state) || autoResuming) return;
    // A real user gesture always wins over the seek guard, in case it's still armed — player.play()
    // clears it on its own.
    if (state.status === "playing") player.pause();
    else player.play();
  }, [player, state, autoResuming]);

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
  // reloadingInPlace (an in-app replay, no page reload — REPLAY_REQUESTED) must NOT show the
  // loading skeleton in place of <VideoPlayer>: useYouTubePlayer's effect depends only on
  // [youtubeId, title], so a same-video replay never reruns it and reuses the existing player
  // instance — but swapping <VideoPlayer> out for <Skeleton>, even briefly, unmounts the DOM
  // node YT.Player replaced with its iframe. `player` (React state) is then left pointing at that
  // now-detached iframe, whose postMessage commands (seekTo/playVideo) silently go nowhere once
  // <VideoPlayer> remounts with a NEW container div — confirmed against real Chrome: this, not
  // the seekTo-alone-on-ENDED quirk, was the actual reason an early replay-restart fix still
  // failed in a real browser.
  const isLoading = state.status === "loading" && !state.reloadingInPlace;

  return (
    <>
      <PublicHeader showBack pointsBadge={pointsBadge} />
      <main aria-busy={isLoading} style={{ maxWidth: "var(--max-width-watch)", margin: "0 auto", padding: "var(--gutter)", display: "flex", flexDirection: "column", gap: 12 }}>
        {!isLoading && state.video && (
          <div className="watch-title-desktop">
            <VideoTitle video={state.video} />
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
            <LiveControlBar
              player={rawPlayer}
              active={state.status === "playing"}
              fallbackPositionSec={state.positionSec}
              fallbackFurthestSec={state.furthestSec}
              getMaxReached={trackerApi.getMaxReached}
              isPlaying={isPlaying}
              enabled={selectPlayButtonEnabled(state) && playerReady && !autoResuming}
              onToggle={handleToggle}
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
              <VideoTitle video={state.video} />
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
