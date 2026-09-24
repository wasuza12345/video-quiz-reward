// m:ss.s formatting/parsing for the quiz editor's trigger-time input and the preview's live
// readout (spec §5.4: "m:ss.s, one decimal, tabular-nums").

export function formatMmSsTenths(totalSeconds: number): string {
  const sec = Math.max(0, totalSeconds);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/** Accepts "m:ss.s", "m:ss", or a bare number of seconds. Null if unparseable. */
export function parseMmSsTenths(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const match = trimmed.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (match) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) return minutes * 60 + seconds;
    return null;
  }
  const bare = Number(trimmed);
  return Number.isFinite(bare) ? bare : null;
}
