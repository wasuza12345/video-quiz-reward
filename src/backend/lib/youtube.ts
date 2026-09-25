// oEmbed lookup (plan §7: "admin pastes URL → server parses youtubeId, fetches oEmbed (title,
// channelName = author_name, embeddable)"). oEmbed succeeding is itself the embeddable check — it
// 404s for private/deleted/embed-disabled videos (plan §0's verified fact: the brief video is
// "embeddable (oEmbed OK)"). The id parser itself lives in shared/youtube-id.ts.
export { parseYoutubeId } from "@/shared/youtube-id";

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
