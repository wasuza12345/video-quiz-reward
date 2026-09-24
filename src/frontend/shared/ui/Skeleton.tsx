export interface SkeletonProps {
  variant?: "rect" | "text" | "circle";
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/** Reduced-motion aware: the shimmer is a fade only under `prefers-reduced-motion: reduce`. */
export function Skeleton({ variant = "rect", width = "100%", height = 16, radius, className }: SkeletonProps) {
  const computedRadius = radius ?? (variant === "circle" ? "50%" : variant === "text" ? 4 : "var(--radius-media)");
  return (
    <span
      aria-hidden="true"
      className={["skeleton", className].filter(Boolean).join(" ")}
      style={{ display: "block", width, height, borderRadius: computedRadius, background: "var(--surface-2)" }}
    />
  );
}
