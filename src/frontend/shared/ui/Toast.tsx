export interface ToastProps {
  message: string;
}

/** Bottom-centre above the ControlBar (spec §4.3.6). Rendered by the caller only while visible. */
export function Toast({ message }: ToastProps) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 88,
        transform: "translateX(-50%)",
        maxWidth: "calc(100% - 32px)",
        padding: "10px 16px",
        borderRadius: 12,
        background: "var(--brand-primary-dark)",
        color: "#fff",
        fontSize: "var(--fs-sm)",
        boxShadow: "var(--shadow-modal)",
        zIndex: 50,
      }}
    >
      {message}
    </div>
  );
}
