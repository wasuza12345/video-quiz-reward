import { describe, expect, it } from "vitest";
import { publishOrFeatureErrorMessage, youtubeUrlIssueMessage } from "@/frontend/admin/pages/AdminVideoFormPage";
import { mapQuestionSaveError } from "@/frontend/admin/components/QuizEditor";

describe("publishOrFeatureErrorMessage (no raw English toasts)", () => {
  it("names the offending question's trigger time for INVALID_TRIGGER", () => {
    expect(publishOrFeatureErrorMessage({ code: "INVALID_TRIGGER", extra: { triggerSec: 30 } })).toBe(
      "คำถามที่เวลา 0:30.0 ไม่พอดีกับความยาวคลิปที่แก้ไขแล้ว กรุณาแก้ไขก่อนเผยแพร่ค่ะ",
    );
  });

  it("still returns Thai copy for INVALID_TRIGGER when extra.triggerSec is missing", () => {
    expect(publishOrFeatureErrorMessage({ code: "INVALID_TRIGGER", extra: {} })).toContain("ไม่พอดีกับความยาวคลิป");
  });

  it("maps VALIDATION_ERROR to Thai copy", () => {
    expect(publishOrFeatureErrorMessage({ code: "VALIDATION_ERROR", extra: {} })).toBe("คำถามในคลิปนี้ยังไม่ถูกต้อง กรุณาตรวจสอบก่อนเผยแพร่ค่ะ");
  });

  it("reuses the sessions timeline's existing INVALID_TRANSITION copy", () => {
    expect(publishOrFeatureErrorMessage({ code: "INVALID_TRANSITION", extra: {} })).toBe("ลำดับไม่ถูกต้อง");
  });

  it("maps BAD_ORIGIN to Thai copy", () => {
    expect(publishOrFeatureErrorMessage({ code: "BAD_ORIGIN", extra: {} })).toBe("คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่ค่ะ");
  });

  it("falls back to a generic Thai message for an unknown code, never the raw code/English", () => {
    const message = publishOrFeatureErrorMessage({ code: "SOME_UNMAPPED_CODE", extra: {} });
    expect(message).toBe("ทำรายการไม่สำเร็จ กรุณาลองใหม่ค่ะ");
    expect(message).not.toContain("SOME_UNMAPPED_CODE");
  });
});

describe("youtubeUrlIssueMessage (tester audit MINOR 1: a duplicate must not show the generic invalid-link copy)", () => {
  it("maps the server's 'already added' issue message to the duplicate-clip copy", () => {
    expect(youtubeUrlIssueMessage("already added")).toBe("คลิปนี้ถูกเพิ่มไว้แล้วค่ะ");
  });

  it("falls back to the generic invalid-link copy for every other issue message", () => {
    expect(youtubeUrlIssueMessage("invalid YouTube URL")).toBe("ลิงก์ YouTube ไม่ถูกต้อง");
    expect(youtubeUrlIssueMessage("video not found or not embeddable")).toBe("ลิงก์ YouTube ไม่ถูกต้อง");
  });
});

describe("mapQuestionSaveError (uses err.extra.issues[0], not a blind default)", () => {
  it("DUPLICATE_TRIGGER attaches to the triggerSec field", () => {
    expect(mapQuestionSaveError({ code: "DUPLICATE_TRIGGER", extra: {} }, 44)).toEqual({ field: "triggerSec", message: "มีคำถามที่เวลานี้แล้ว เลือกเวลาอื่นค่ะ" });
  });

  it("INVALID_TRIGGER attaches to the triggerSec field with the duration-aware range copy", () => {
    expect(mapQuestionSaveError({ code: "INVALID_TRIGGER", extra: {} }, 44)).toEqual({ field: "triggerSec", message: "เวลาต้องมากกว่า 0:00 และน้อยกว่า 0:42.0" });
  });

  it("VALIDATION_ERROR on correctChoice maps to the correctChoice field, not always noCorrectChoice by accident", () => {
    const err = { code: "VALIDATION_ERROR", extra: { issues: [{ path: "correctChoice", message: "invalid" }] } };
    expect(mapQuestionSaveError(err, 44)).toEqual({ field: "correctChoice", message: "เลือกข้อที่ถูกต้อง 1 ข้อ" });
  });

  it("VALIDATION_ERROR on prompt maps to the prompt field", () => {
    const err = { code: "VALIDATION_ERROR", extra: { issues: [{ path: "prompt", message: "too long" }] } };
    expect(mapQuestionSaveError(err, 44)).toEqual({ field: "prompt", message: "กรุณากรอกคำถาม" });
  });

  it("VALIDATION_ERROR on the choices array itself (duplicate labels) maps to a duplicate-labels message", () => {
    const err = { code: "VALIDATION_ERROR", extra: { issues: [{ path: "choices", message: "choice labels must be unique" }] } };
    expect(mapQuestionSaveError(err, 44)).toEqual({ field: "choices", message: "ตัวเลือกซ้ำกัน กรุณาลองใหม่ค่ะ" });
  });

  it("VALIDATION_ERROR on a nested choices.N.text path maps to an empty-choice-text message", () => {
    const err = { code: "VALIDATION_ERROR", extra: { issues: [{ path: "choices.0.text", message: "too short" }] } };
    expect(mapQuestionSaveError(err, 44)).toEqual({ field: "choices", message: "กรุณากรอกตัวเลือก" });
  });

  it("VALIDATION_ERROR with no issues falls back to the general banner, not a field error", () => {
    expect(mapQuestionSaveError({ code: "VALIDATION_ERROR", extra: {} }, 44)).toEqual({ message: "เลือกข้อที่ถูกต้อง 1 ข้อ" });
  });

  it("VIDEO_LOCKED maps to a Thai locked message on the general banner", () => {
    expect(mapQuestionSaveError({ code: "VIDEO_LOCKED", extra: {} }, 44)).toEqual({ message: "คำถามนี้ถูกล็อกบางส่วนแล้ว เพราะมีผู้ชมเริ่มดูคลิปนี้ค่ะ" });
  });

  it("an unknown code falls back to a generic Thai banner message, never the raw code", () => {
    const result = mapQuestionSaveError({ code: "SOME_UNMAPPED_CODE", extra: {} }, 44);
    expect(result).toEqual({ message: "บันทึกไม่สำเร็จ กรุณาลองใหม่ค่ะ" });
  });
});
