// Taps the real network traffic the public client sends (plan §10 flow 1: "Log POST /events and
// assert 0 rejected results over the honest run") — this is the actual browser's own fetch
// calls, not a synthetic request built by the test.
import type { Page, Response } from "@playwright/test";

export interface EventResult {
  seq: number;
  accepted: boolean;
  rejectReason: string | null;
}

export interface EventLog {
  results: EventResult[];
  dispose(): void;
}

export function collectEventResults(page: Page): EventLog {
  const results: EventResult[] = [];
  const onResponse = async (response: Response) => {
    const req = response.request();
    if (req.method() !== "POST") return;
    if (!/\/api\/sessions\/[^/]+\/events$/.test(new URL(response.url()).pathname)) return;
    try {
      const body = (await response.json()) as { results?: EventResult[] };
      if (Array.isArray(body.results)) results.push(...body.results);
    } catch {
      // A non-JSON/empty response here would show up as a missing result anyway — nothing to log.
    }
  };
  page.on("response", onResponse);
  return { results, dispose: () => page.off("response", onResponse) };
}
