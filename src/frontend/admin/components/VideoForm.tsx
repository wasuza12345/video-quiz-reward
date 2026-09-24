"use client";

import { useId } from "react";
import { formatTime, videoForm as copy } from "../constants/copy.th";

export interface VideoFormValues {
  youtubeUrl: string;
  title: string;
  rewardPoints: number;
}

export interface VideoFormProps {
  mode: "create" | "edit";
  values: VideoFormValues;
  onChange: (values: VideoFormValues) => void;
  channelName: string | null;
  durationSec: number | null;
  locked: boolean;
  errors: { youtubeUrl?: string; durationSec?: string; rewardPoints?: string };
}

const lockedFieldStyle: React.CSSProperties = { background: "var(--surface-2)", color: "var(--text-2)" };
const fieldBaseStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: "var(--radius-field)",
  border: "1px solid var(--border-control)",
  padding: "0 14px",
  fontSize: "var(--fs-md)",
  fontFamily: "var(--font)",
};

function Field({ id, label, helper, error, children }: { id: string; label: string; helper?: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>{label}</label>
      {children}
      {error ? (
        <p style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>{error}</p>
      ) : (
        helper && <p style={{ color: "var(--text-2)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>{helper}</p>
      )}
    </div>
  );
}

export function VideoForm({ mode, values, onChange, channelName, durationSec, locked, errors }: VideoFormProps) {
  const set = (patch: Partial<VideoFormValues>) => onChange({ ...values, ...patch });
  const youtubeUrlId = useId();
  const titleId = useId();
  const durationSecId = useId();
  const rewardPointsId = useId();

  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", padding: 20 }}>
      <Field id={youtubeUrlId} label={`${copy.fields.youtubeUrl.label}${locked ? " 🔒" : ""}`} helper={!errors.youtubeUrl ? copy.fields.youtubeUrl.helper : undefined} error={errors.youtubeUrl}>
        <input
          id={youtubeUrlId}
          value={values.youtubeUrl}
          onChange={(e) => set({ youtubeUrl: e.target.value })}
          readOnly={locked}
          aria-disabled={locked || undefined}
          aria-describedby={locked ? "video-locked-notice" : undefined}
          style={{ ...fieldBaseStyle, ...(locked ? lockedFieldStyle : {}), borderColor: errors.youtubeUrl ? "var(--danger)" : undefined }}
        />
      </Field>

      <Field id={titleId} label={copy.fields.title.label} helper={mode === "create" ? copy.fields.title.helperCreate : undefined}>
        <input id={titleId} value={values.title} onChange={(e) => set({ title: e.target.value })} style={fieldBaseStyle} />
      </Field>

      {channelName && (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: "-8px 0 16px" }}>{copy.fields.channelName(channelName)}</p>
      )}

      <Field id={durationSecId} label={`${copy.fields.durationSec.label}${locked ? " 🔒" : ""}`} helper={!errors.durationSec ? copy.fields.durationSec.helper : undefined} error={errors.durationSec}>
        <input
          id={durationSecId}
          readOnly
          aria-disabled={locked || undefined}
          value={durationSec !== null ? formatTime(durationSec) : ""}
          style={{ ...fieldBaseStyle, ...lockedFieldStyle }}
        />
      </Field>

      <Field id={rewardPointsId} label={copy.fields.rewardPoints.label} error={errors.rewardPoints}>
        <input
          id={rewardPointsId}
          type="number"
          min={1}
          max={1000}
          step={1}
          value={values.rewardPoints}
          onChange={(e) => set({ rewardPoints: Number(e.target.value) })}
          style={{ ...fieldBaseStyle, borderColor: errors.rewardPoints ? "var(--danger)" : undefined }}
        />
      </Field>
    </div>
  );
}
