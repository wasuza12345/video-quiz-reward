// @vitest-environment jsdom
//
// The E2E console-error assertion can't
// actually catch a <div>-nested-in-<p> React warning, because Playwright's api/ui-desktop projects
// run a PRODUCTION `next build` (React strips validateDOMNesting and every other dev-only warning
// in production), and the page itself renders server-first anyway. Only a real client-side render
// under a DEV React build — exactly what createRoot into a jsdom container gives here — actually
// performs the DOM-nesting check and logs it via console.error.
//
// Fact used to wrap `sub` in a <p>; the playedWallSec Fact passes a <ProgressBar> (a <div>) as
// sub — a <div> nested in a <p> is invalid HTML, so React logged it as 2 separate console.error
// calls (the "cannot be a descendant of" check and the "cannot contain a nested" check) on every
// render. Fixed by rendering sub in a <div> instead (same styling).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fact } from "@/frontend/admin/pages/AdminSessionDetailPage";
import { ProgressBar } from "@/frontend/shared/ui/ProgressBar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Fact (must fail if sub is wrapped back in a <p>)", () => {
  it("rendering a ProgressBar as sub logs 0 console errors (valid HTML: no <div> nested in a <p>)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      act(() => {
        root.render(
          <Fact
            label="เวลาเล่นจริง"
            value="0:20"
            sub={<ProgressBar value={20} max={44} secondaryValue={39.6} valueText="0:20" height={6} />}
          />,
        );
      });
      expect(spy, "React must log 0 console.error calls — a <div> (ProgressBar's root) nested in a <p> is invalid HTML").not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
