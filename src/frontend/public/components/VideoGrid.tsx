import type { ReactNode } from "react";

export function VideoGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 12 }} className="video-grid">
      {children}
    </div>
  );
}
