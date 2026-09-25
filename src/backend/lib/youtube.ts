// YouTube URL parsing + oEmbed lookup (plan §7: "admin pastes URL → server parses youtubeId,
// fetches oEmbed (title, channelName = author_name, embeddable)"). oEmbed succeeding is itself
// the embeddable check — it 404s for private/deleted/embed-disabled videos (plan §0's verified
// fact: the brief video is "embeddable (oEmbed OK)").
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

export interface YoutubeOembed {
  title: string;
  channelName: string;
}

/** Null if the video doesn't exist, is private, or has embedding disabled — oEmbed fails the same
 * way for all three, which is exactly the check plan §7 wants ("fetches oEmbed ... embeddable"). */
export async function fetchYoutubeOembed(youtubeId: string): Promise<YoutubeOembed | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    // A slow/hanging oEmbed response must not hold an admin request open indefinitely.
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown; author_name?: unknown };
    if (typeof data.title !== "string" || typeof data.author_name !== "string") return null;
    return { title: data.title, channelName: data.author_name };
  } catch {
    return null;
  }
}
