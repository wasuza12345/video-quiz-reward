// YouTube video-id parsing (plan §7). Pure and free of Node/DOM imports so both backend/lib and
// the admin frontend can use it — the frontend derives the id locally just to drive the live
// preview; the server re-parses this same way and is the actual source of truth on save.
const YOUTUBE_ID_RE = /^[\w-]{11}$/;

/** Accepts a bare 11-char id, youtu.be/ID, youtube.com/watch?v=ID, or /embed|shorts/ID. Null if
 * the input isn't recognizably a YouTube video URL/id at all. */
export function parseYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    const match = url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/);
    if (match) return match[1];
  }
  return null;
}
