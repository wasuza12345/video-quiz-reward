// ครูหวาน copy — docs/design/spec.md §3, §4. Every string used by the public pages lives here so
// tone stays consistent and nothing is inlined in a component.

/** `m:ss`, or `h:mm:ss` only at ≥ 1h (spec §1.5). */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatPoints(points: number): string {
  return `${points.toLocaleString("th-TH")} แต้ม`;
}

export const header = {
  homeAriaLabel: "กลับหน้าแรก",
  backAriaLabel: "กลับไปหน้ารวมคลิป",
  backLink: "← กลับไปหน้ารวมคลิป",
  footer: "วิดีโอจาก YouTube เป็นของเจ้าของช่องแต่ละช่อง",
};

export const pointsBadge = {
  ariaLabel: (n: number) => `แต้มสะสม ${n} แต้ม`,
  unavailableSr: "ไม่สามารถโหลดแต้มได้",
  unavailableVisual: "–",
};

export const videoList = {
  heroTitle: "ดูคลิปให้จบ ตอบคำถาม รับแต้มค่ะ",
  heroSub: "ดูคลิปให้จบและตอบคำถามให้ถูก รับแต้มสะสมได้เลยค่ะ",
  onlyOneMore: "คลิปใหม่กำลังจะมาเร็วๆ นี้นะคะ",
  loadingSr: "กำลังโหลดคลิป…",
  allRewardedBanner: "เก่งมากค่ะ! ดูครบทุกคลิปแล้ว ดูทบทวนได้เสมอนะคะ",
  empty: { title: "ยังไม่มีคลิปให้ดูตอนนี้ค่ะ", body: "แวะกลับมาใหม่เร็วๆ นี้นะคะ เรากำลังเตรียมคลิปดีๆ ไว้ให้" },
  error: { title: "โหลดรายการคลิปไม่สำเร็จ", body: "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ค่ะ", action: "ลองใหม่" },
  pointsSummary: {
    label: "แต้มสะสมของคุณ",
    sub: (n: number) => `ได้แต้มแล้ว ${n} คลิป`,
  },
  card: {
    featuredTag: "แนะนำ",
    rewardTag: (points: number) => `+${points} แต้ม`,
    rewardedTag: "✓ ได้แต้มแล้ว",
    questionsTag: (n: number) => `${n} คำถาม`,
    source: (channelName: string) => `วิดีโอจาก YouTube: ${channelName}`,
    ctaFeaturedNew: "เริ่มดูคลิปเลย",
    ctaFeaturedRewarded: "ดูทบทวน",
    ctaListNew: "ดูคลิป →",
    ctaListRewarded: "ดูทบทวน →",
    ariaLabel: (title: string, durationSec: number, rewarded: boolean, rewardPoints: number) =>
      `${title} · ${formatTime(durationSec)} · ${rewarded ? "ได้แต้มแล้ว" : `รับ ${rewardPoints} แต้ม`}`,
  },
};

export const watch = {
  loading: {
    initial: "กำลังโหลดวิดีโอ…",
    slow: "ใช้เวลานานกว่าปกติ ลองตรวจสอบอินเทอร์เน็ตนะคะ",
  },
  statusLine: {
    readyNew: (questionCount: number, rewardPoints: number) =>
      questionCount > 0
        ? `ดูคลิปให้จบและตอบคำถาม ${questionCount} ข้อ เพื่อรับ ${rewardPoints} แต้มนะคะ`
        : `ดูคลิปให้จบ เพื่อรับ ${rewardPoints} แต้มนะคะ`,
    readyResumed: "กดเล่นเพื่อดูต่อได้เลยค่ะ",
    claimingResumed: "ดูจบแล้ว กำลังบันทึกแต้มให้นะคะ…",
    playingNextQuiz: (m: string) => `คำถามถัดไปจะขึ้นที่ ${m} นะคะ`,
    playingAllPassed: "ตอบครบแล้ว ดูต่อให้จบเพื่อรับแต้มค่ะ",
    playingNoQuizzes: "ดูให้จบเพื่อรับแต้มค่ะ",
    paused: "หยุดชั่วคราว กดเล่นเพื่อดูต่อค่ะ",
    pausedTabHidden: "หยุดไว้ให้ระหว่างที่คุณออกจากหน้านี้ค่ะ",
    ended: "ดูจบแล้ว กำลังตรวจสอบค่ะ…",
    endedFallback: "ดูต่ออีกนิดนะคะ",
    claiming: "กำลังบันทึกแต้มให้นะคะ…",
    replayNew: (questionCount: number) => (questionCount > 0 ? `ดูทบทวนและตอบคำถาม ${questionCount} ข้อได้เลยค่ะ` : "ดูทบทวนได้เลยค่ะ"),
  },
  contextBanner: {
    resumed: (m: string) => `ดูต่อจาก ${m} ที่ค้างไว้นะคะ`,
    replayStart: "คลิปนี้คุณได้รับแต้มไปแล้วค่ะ ดูทบทวนและลองตอบคำถามได้ แต่จะไม่ได้แต้มเพิ่มนะคะ",
  },
  inlineNotice: {
    endedFallback: "ดูต่ออีกนิดนะคะ ระบบยังนับเวลาดูไม่ครบ",
    replayEnd: "ดูทบทวนจบแล้วค่ะ 👏",
    claimFailed: { title: "บันทึกแต้มไม่สำเร็จค่ะ", action: "ลองบันทึกอีกครั้ง" },
  },
  toast: {
    gateFallback: "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ",
    resync: "ข้ามช่วงวิดีโอไม่ได้นะคะ ขอพากลับไปจุดที่ดูถึงค่ะ",
    offline: "ขาดการเชื่อมต่อ ความคืบหน้าอาจยังไม่ถูกบันทึกนะคะ",
  },
  controlBar: {
    playAriaLabel: "เล่นวิดีโอ",
    pauseAriaLabel: "หยุดชั่วคราว",
    progressAriaValueText: (current: string, duration: string) => `ดูไปแล้ว ${current} จาก ${duration}`,
  },
  quizProgress: {
    chip: (i: number, m: string) => `คำถามที่ ${i} · ${m}`,
  },
  quizModal: {
    title: "ตอบคำถามก่อนดูต่อนะคะ",
    eyebrow: (i: number, n: number) => `คำถามที่ ${i} จาก ${n}`,
    helper: "วิดีโอจะเล่นต่อเมื่อตอบถูกค่ะ",
    syncing: "กำลังเตรียมคำถาม…",
    wrong: "ยังไม่ถูกนะคะ ลองเลือกข้ออื่นดูอีกครั้งค่ะ",
    correct: "ถูกต้องค่ะ! เก่งมาก ดูต่อได้เลยนะคะ",
    answerFailed: "ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ",
    invalidChoice: "เกิดข้อผิดพลาด กรุณาลองใหม่ค่ะ",
    choiceAriaLabel: (label: string, text: string) => `ตัวเลือก ${label}: ${text}`,
    wrongSrSuffix: " (ตอบแล้ว ไม่ถูก)",
  },
  rewardCard: {
    congrats: "ยินดีด้วยค่ะ!",
    pointsSuffix: "Points",
    glassBox: (totalPoints: number) => `คุณดูคลิปจบและตอบคำถามถูกครบแล้ว แต้มสะสมทั้งหมด ${totalPoints} แต้มค่ะ`,
    rewatch: "ดูทบทวนอีกครั้ง",
    otherVideos: "ดูคลิปอื่น",
    sr: (points: number, totalPoints: number) => `ยินดีด้วยค่ะ ได้รับ ${points} แต้ม แต้มสะสมทั้งหมด ${totalPoints} แต้ม`,
  },
  replayEnd: {
    watchAgain: "ดูอีกครั้ง",
    otherVideos: "ดูคลิปอื่น",
  },
  error: {
    videoNotFound: { title: "ไม่พบคลิปนี้ค่ะ", body: "คลิปอาจถูกนำออกหรือยังไม่เปิดให้ดู", action: "กลับหน้ารวมคลิป" },
    sessionLoadFailed: { title: "โหลดวิดีโอไม่สำเร็จ", body: "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ค่ะ", action: "ลองใหม่" },
    playerFailed: {
      title: "เล่นวิดีโอนี้ไม่ได้ในขณะนี้ค่ะ",
      body: "ลองใหม่อีกครั้ง หรือกลับไปเลือกคลิปอื่นนะคะ",
      action: "ลองใหม่",
      secondaryAction: "กลับหน้ารวมคลิป",
    },
    notOwner: { title: "เซสชันนี้ไม่ใช่ของคุณ", body: "กรุณาโหลดหน้าใหม่เพื่อดูต่อค่ะ", action: "โหลดหน้าใหม่" },
    eventLimit: { title: "มีการส่งข้อมูลมากผิดปกติ", body: "กรุณาโหลดหน้าใหม่แล้วดูต่อค่ะ", action: "โหลดหน้าใหม่" },
    validation: { title: "เกิดข้อผิดพลาด", body: "กรุณาโหลดหน้าใหม่ค่ะ", action: "โหลดหน้าใหม่" },
  },
};
