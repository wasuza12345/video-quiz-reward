import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BackLink } from "@/frontend/shared/ui/BackLink";

describe("BackLink", () => {
  it("renders a real <a> pointing at the given href, with the full label (including its arrow)", () => {
    const html = renderToStaticMarkup(<BackLink href="/admin/videos" label="← กลับไปรายการคลิป" />);
    expect(html.trimStart().startsWith("<a ")).toBe(true);
    expect(html).toContain('href="/admin/videos"');
    expect(html).toContain("← กลับไปรายการคลิป");
  });

  it("uses the href/label given, not a hardcoded target — different pages point it at different parents", () => {
    const html = renderToStaticMarkup(<BackLink href="/" label="← กลับไปหน้ารวมคลิป" />);
    expect(html).toContain('href="/"');
    expect(html).toContain("← กลับไปหน้ารวมคลิป");
  });
});
