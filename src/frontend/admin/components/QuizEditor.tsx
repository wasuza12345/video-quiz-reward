"use client";

import { useState } from "react";
import { Button } from "@/frontend/shared/ui/Button";
import { ConfirmDialog } from "@/frontend/shared/ui/ConfirmDialog";
import { EmptyState } from "@/frontend/shared/ui/ErrorState";
import { quizEditor as copy } from "../constants/copy.th";
import { formatMmSsTenths, parseMmSsTenths } from "../lib/time";
import type { YouTubePreviewHandle } from "./YouTubePreview";
import { AdminApiError, adminApi } from "../services/api";
import type { AdminQuestionDetail } from "@/shared/contracts/admin";

const CHOICE_LABELS = ["A", "B", "C", "D"] as const;
type ChoiceLabel = (typeof CHOICE_LABELS)[number];

interface DraftChoice {
  label: ChoiceLabel;
  text: string;
}

interface Draft {
  triggerSec: string; // raw input text, "m:ss.s"
  prompt: string;
  choices: DraftChoice[];
  correctChoice: ChoiceLabel;
}

function toDraft(q: AdminQuestionDetail): Draft {
  // The server only ever stores A-D labels (the create/update body schemas enforce it); the
  // shared contract type just isn't narrowed that tightly.
  return { triggerSec: formatMmSsTenths(q.triggerSec), prompt: q.prompt, choices: q.choices as DraftChoice[], correctChoice: q.correctChoice as ChoiceLabel };
}

const NEW_DRAFT: Draft = { triggerSec: "", prompt: "", choices: [{ label: "A", text: "" }, { label: "B", text: "" }], correctChoice: "A" };

function draftsEqual(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface QuestionCardProps {
  question: AdminQuestionDetail | null; // null = a brand-new, unsaved question
  videoId: string;
  durationSec: number;
  locked: boolean;
  previewReady: boolean;
  previewHandle: YouTubePreviewHandle | null;
  existingTriggers: number[]; // sibling questions' triggerSec, for the client-side duplicate check
  defaultExpanded: boolean;
  onSaved: (question: AdminQuestionDetail, wasNew: boolean, tempKey: string) => void;
  onDeleted: (tempKey: string) => void;
  tempKey: string;
}

function QuestionCard({ question, videoId, durationSec, locked, previewReady, previewHandle, existingTriggers, defaultExpanded, onSaved, onDeleted, tempKey }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [draft, setDraft] = useState<Draft>(question ? toDraft(question) : NEW_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ triggerSec?: string; prompt?: string; choices?: string; correctChoice?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const savedDraft = question ? toDraft(question) : NEW_DRAFT;
  const dirty = !draftsEqual(draft, savedDraft) || question === null;
  const triggerSecParsed = parseMmSsTenths(draft.triggerSec);

  const setField = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const useCurrentTime = () => {
    if (!previewHandle) return;
    const t = previewHandle.getCurrentTime();
    if (t === null) return;
    const rounded = Math.round(t * 10) / 10;
    setField({ triggerSec: formatMmSsTenths(rounded) });
    setAnnouncement(copy.useCurrentTimeAnnounce(formatMmSsTenths(rounded)));
  };

  const goToTime = () => {
    if (!previewHandle || triggerSecParsed === null) return;
    previewHandle.seekTo(triggerSecParsed);
  };

  const validate = (): boolean => {
    const errs: typeof fieldErrors = {};
    if (triggerSecParsed === null || !(triggerSecParsed > 0 && triggerSecParsed < durationSec - 2)) {
      errs.triggerSec = copy.errors.triggerRange(formatMmSsTenths(durationSec - 2));
    } else if (existingTriggers.some((t) => Math.abs(t - triggerSecParsed) < 0.05)) {
      errs.triggerSec = copy.errors.duplicateTrigger;
    }
    if (!draft.prompt.trim()) errs.prompt = copy.errors.emptyPrompt;
    if (draft.choices.some((c) => !c.text.trim())) errs.choices = copy.errors.emptyChoiceText;
    if (!draft.choices.some((c) => c.label === draft.correctChoice)) errs.correctChoice = copy.errors.noCorrectChoice;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || triggerSecParsed === null) return;
    setSaving(true);
    setError(null);
    try {
      const body = { triggerSec: triggerSecParsed, prompt: draft.prompt.trim(), choices: draft.choices.map((c) => ({ label: c.label, text: c.text.trim() })), correctChoice: draft.correctChoice };
      const saved = question ? await adminApi.updateQuestion(question.id, body) : await adminApi.createQuestion(videoId, body);
      onSaved(saved, question === null, tempKey);
      setExpanded(false);
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.code === "DUPLICATE_TRIGGER") setFieldErrors((f) => ({ ...f, triggerSec: copy.errors.duplicateTrigger }));
        else if (err.code === "INVALID_TRIGGER") setFieldErrors((f) => ({ ...f, triggerSec: copy.errors.triggerRange(formatMmSsTenths(durationSec - 2)) }));
        else if (err.code === "VALIDATION_ERROR") setError(copy.errors.noCorrectChoice);
        else setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    if (question === null) {
      onDeleted(tempKey);
      return;
    }
    setSaving(true);
    try {
      await adminApi.deleteQuestion(question.id);
      onDeleted(tempKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const correctLabel = draft.correctChoice;
  const summary = copy.summary(formatMmSsTenths(triggerSecParsed ?? 0), draft.prompt || "…", draft.choices.length, correctLabel);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          minHeight: 48,
          padding: "8px 16px",
          border: "none",
          background: "var(--surface)",
          cursor: "pointer",
          fontFamily: "var(--font)",
          fontSize: "var(--fs-sm)",
          textAlign: "left",
        }}
      >
        <span>{summary}</span>
        {dirty && <span style={{ fontSize: "var(--fs-xs)", color: "var(--warning)" }}>● {copy.dirty}</span>}
      </button>

      {expanded && (
        <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <p role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
            {announcement}
          </p>

          <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>{copy.triggerLabel}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <input
              value={draft.triggerSec}
              onChange={(e) => setField({ triggerSec: e.target.value })}
              readOnly={locked}
              aria-disabled={locked || undefined}
              style={{ width: 120, height: 48, borderRadius: "var(--radius-field)", border: `1px solid ${fieldErrors.triggerSec ? "var(--danger)" : "var(--border-control)"}`, padding: "0 12px", fontFamily: "var(--font)" }}
            />
            <Button variant="outline" size="sm" onClick={useCurrentTime} disabled={locked || !previewReady} title={!previewReady ? copy.useCurrentTimeDisabledPreview : undefined}>
              {copy.useCurrentTime}
            </Button>
            <Button variant="outline" size="sm" onClick={goToTime} disabled={!previewReady || triggerSecParsed === null}>
              {copy.goToTime}
            </Button>
          </div>
          <p style={{ fontSize: "var(--fs-xs)", color: fieldErrors.triggerSec ? "var(--danger)" : "var(--text-2)", margin: "0 0 16px" }}>
            {fieldErrors.triggerSec ?? copy.triggerHelper(formatMmSsTenths(durationSec - 2))}
          </p>

          <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>{copy.promptLabel}</label>
          <textarea
            value={draft.prompt}
            onChange={(e) => setField({ prompt: e.target.value.slice(0, 300) })}
            maxLength={300}
            rows={3}
            style={{ width: "100%", borderRadius: "var(--radius-field)", border: `1px solid ${fieldErrors.prompt ? "var(--danger)" : "var(--border-control)"}`, padding: 12, fontFamily: "var(--font)", fontSize: "var(--fs-md)", resize: "vertical" }}
          />
          <p style={{ fontSize: "var(--fs-xs)", color: fieldErrors.prompt ? "var(--danger)" : "var(--text-2)", margin: "4px 0 16px", textAlign: "right" }}>
            {fieldErrors.prompt ?? copy.promptCounter(draft.prompt.length)}
          </p>

          <label style={{ display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>{copy.choicesLabel}</label>
          {draft.choices.map((choice) => (
            <div key={choice.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, flexShrink: 0, cursor: "pointer" }}>
                <input
                  type="radio"
                  name={`correct-${tempKey}`}
                  checked={draft.correctChoice === choice.label}
                  onChange={() => setField({ correctChoice: choice.label })}
                  disabled={locked}
                  aria-label={`${copy.correctSr} ${choice.label}`}
                />
              </label>
              <span style={{ fontWeight: 700, width: 16 }}>{choice.label}</span>
              <input
                value={choice.text}
                onChange={(e) => setField({ choices: draft.choices.map((c) => (c.label === choice.label ? { ...c, text: e.target.value } : c)) })}
                style={{ flex: 1, height: 44, borderRadius: "var(--radius-field)", border: "1px solid var(--border-control)", padding: "0 12px", fontFamily: "var(--font)" }}
              />
              {draft.choices.length > 2 && !locked && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={copy.removeChoiceAriaLabel}
                  onClick={() => {
                    const remaining = draft.choices.filter((c) => c.label !== choice.label);
                    setField({ choices: remaining, correctChoice: draft.correctChoice === choice.label ? remaining[0].label : draft.correctChoice });
                  }}
                >
                  🗑
                </Button>
              )}
            </div>
          ))}
          {(fieldErrors.choices || fieldErrors.correctChoice) && (
            <p style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", margin: "0 0 8px" }}>{fieldErrors.choices ?? fieldErrors.correctChoice}</p>
          )}
          {draft.choices.length < 4 && !locked && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextLabel = CHOICE_LABELS.find((l) => !draft.choices.some((c) => c.label === l));
                if (nextLabel) setField({ choices: [...draft.choices, { label: nextLabel, text: "" }] });
              }}
              style={{ marginBottom: 16 }}
            >
              {copy.addChoice}
            </Button>
          )}

          {error && <p style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <Button variant="danger-text" disabled={locked} onClick={() => setConfirmDelete(true)}>
              {copy.deleteQuestion}
            </Button>
            <Button variant="primary-navy" loading={saving} onClick={handleSave}>
              {copy.saveQuestion}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={copy.deleteConfirm.title}
        body={copy.deleteConfirm.body}
        cancelLabel={copy.deleteConfirm.cancel}
        confirmLabel={copy.deleteConfirm.confirm}
        tone="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

export interface QuizEditorProps {
  videoId: string;
  questions: AdminQuestionDetail[];
  durationSec: number;
  locked: boolean;
  videoSaved: boolean;
  previewReady: boolean;
  previewHandle: YouTubePreviewHandle | null;
  onQuestionsChange: (questions: AdminQuestionDetail[]) => void;
}

export function QuizEditor({ videoId, questions, durationSec, locked, videoSaved, previewReady, previewHandle, onQuestionsChange }: QuizEditorProps) {
  const [newDraftKeys, setNewDraftKeys] = useState<string[]>([]);

  const sorted = [...questions].sort((a, b) => a.triggerSec - b.triggerSec);

  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: 0 }}>{copy.title(questions.length)}</h2>
        <Button
          variant="outline"
          disabled={locked || !videoSaved}
          title={!videoSaved ? copy.addDisabledHelper : undefined}
          onClick={() => setNewDraftKeys((keys) => [...keys, `new-${Date.now()}`])}
        >
          {copy.add}
        </Button>
      </div>

      {sorted.length === 0 && newDraftKeys.length === 0 && <EmptyState title={copy.empty.title} body={copy.empty.body} />}

      {sorted.map((q) => (
        <QuestionCard
          key={q.id}
          tempKey={q.id}
          question={q}
          videoId={videoId}
          durationSec={durationSec}
          locked={locked}
          previewReady={previewReady}
          previewHandle={previewHandle}
          existingTriggers={sorted.filter((s) => s.id !== q.id).map((s) => s.triggerSec)}
          defaultExpanded={false}
          onSaved={(saved) => onQuestionsChange(questions.map((existing) => (existing.id === saved.id ? saved : existing)))}
          onDeleted={() => onQuestionsChange(questions.filter((existing) => existing.id !== q.id))}
        />
      ))}

      {newDraftKeys.map((key) => (
        <QuestionCard
          key={key}
          tempKey={key}
          question={null}
          videoId={videoId}
          durationSec={durationSec}
          locked={locked}
          previewReady={previewReady}
          previewHandle={previewHandle}
          existingTriggers={sorted.map((s) => s.triggerSec)}
          defaultExpanded
          onSaved={(saved, _wasNew, tempKey) => {
            setNewDraftKeys((keys) => keys.filter((k) => k !== tempKey));
            onQuestionsChange([...questions, saved]);
          }}
          onDeleted={(tempKey) => setNewDraftKeys((keys) => keys.filter((k) => k !== tempKey))}
        />
      ))}
    </div>
  );
}
