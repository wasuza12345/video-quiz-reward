import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoForm } from "@/frontend/admin/components/VideoForm";

// QuestionCard calls useRouter() (for the UNAUTHENTICATED redirect, review round 3 MINOR 3), which
// throws outside a mounted Next.js app router — stub it so a bare renderToStaticMarkup works here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
const { QuestionCard } = await import("@/frontend/admin/components/QuizEditor");

// review round 3 MINOR 5: "form fields have no accessible names ... Tester's Playwright will use
// getByLabel" — these checks approximate what getByLabel needs (a <label for> pointing at a real
// input id, or an aria-label on the input itself) without pulling in jsdom/RTL as new dependencies:
// react-dom/server is already a transitive dependency of this Next.js app.

function labelForIds(html: string): string[] {
  return [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
}
function elementIds(html: string): Set<string> {
  return new Set([...html.matchAll(/<(?:input|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
}
function ariaLabels(html: string): string[] {
  return [...html.matchAll(/<input[^>]*\saria-label="([^"]+)"/g)].map((m) => m[1]);
}

describe("VideoForm label association", () => {
  it("every <label for=...> has a matching input id, with no id collisions between fields", () => {
    const html = renderToStaticMarkup(
      <VideoForm mode="create" values={{ youtubeUrl: "", title: "", rewardPoints: 50 }} onChange={() => {}} channelName={null} durationSec={null} locked={false} errors={{}} />,
    );
    const forIds = labelForIds(html);
    expect(forIds).toHaveLength(4); // youtubeUrl, title, durationSec, rewardPoints
    expect(new Set(forIds).size).toBe(forIds.length);
    const ids = elementIds(html);
    for (const id of forIds) expect(ids.has(id)).toBe(true);
  });
});

describe("QuestionCard (quiz editor) label association", () => {
  it("the trigger and prompt inputs each have a matching label, and every choice input has an aria-label", () => {
    const html = renderToStaticMarkup(
      <QuestionCard
        question={null}
        videoId="v1"
        durationSec={44}
        locked={false}
        previewReady={false}
        previewHandle={null}
        previewCurrentTime={0}
        existingTriggers={[]}
        defaultExpanded
        onSaved={() => {}}
        onDeleted={() => {}}
        tempKey="new-1"
      />,
    );
    const forIds = labelForIds(html);
    expect(forIds).toHaveLength(2); // triggerLabel, promptLabel
    const ids = elementIds(html);
    for (const id of forIds) expect(ids.has(id)).toBe(true);

    const choiceAriaLabels = ariaLabels(html).filter((l) => l.startsWith("ข้อความตัวเลือก"));
    expect(choiceAriaLabels).toEqual(["ข้อความตัวเลือก A", "ข้อความตัวเลือก B"]); // a new draft starts with choices A and B
  });
});
