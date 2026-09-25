// Admin panel copy — docs/design/spec.md §5. No ครูหวาน flourishes in labels; messages keep "ค่ะ".
export { formatTime } from "@/frontend/public/constants/copy.th";

export const shell = {
  appName: "ดูคลิป รับแต้ม · ผู้ดูแลระบบ",
  nav: { dashboard: "แดชบอร์ด", videos: "วิดีโอ", users: "ผู้ใช้", sessions: "เซสชัน" },
  logout: "ออกจากระบบ",
  hamburgerAriaLabel: "เปิดเมนู",
  closeDrawerAriaLabel: "ปิดเมนู",
};

export const login = {
  title: "เข้าสู่ระบบผู้ดูแล",
  emailLabel: "อีเมล",
  passwordLabel: "รหัสผ่าน",
  showPasswordAriaLabel: "แสดงรหัสผ่าน",
  hidePasswordAriaLabel: "ซ่อนรหัสผ่าน",
  submit: "เข้าสู่ระบบ",
  submitting: "กำลังเข้าสู่ระบบ…",
  validation: {
    emailRequired: "กรุณากรอกอีเมล",
    emailInvalid: "รูปแบบอีเมลไม่ถูกต้อง",
    passwordRequired: "กรุณากรอกรหัสผ่าน",
  },
  errors: {
    invalidCredentials: "อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ",
    tooManyAttempts: "ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ (อาจต้องรอถึง 15 นาที)",
    badOrigin: "คำขอไม่ถูกต้อง กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้งค่ะ",
    network: "เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่ค่ะ",
  },
  reasonExpired: "หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้งค่ะ",
  reasonLogout: "ออกจากระบบเรียบร้อยแล้วค่ะ",
};

export const dashboard = {
  title: "แดชบอร์ด",
  allVideos: "ทุกวิดีโอ",
  tiles: {
    views: { label: "ยอดเข้าชม", sub: "ไม่รวมการดูทบทวน" },
    completions: { label: "ดูจบ/รับแต้ม", sub: "จำนวนครั้งที่ได้แต้ม" },
    pointsAwarded: { label: "แต้มที่แจกไป" },
    flagged: { label: "เซสชันที่ถูกแจ้งเตือน", ariaLabel: (n: number) => `ดูเซสชันที่ถูกแจ้งเตือน ${n} รายการ` },
  },
  flaggedRecent: "เซสชันที่ถูกแจ้งเตือนล่าสุด",
  viewAll: "ดูทั้งหมด →",
  emptyFlagged: "ยังไม่มีเซสชันที่ถูกแจ้งเตือนค่ะ 🎉",
  retry: "ลองใหม่",
};

export const videos = {
  title: "วิดีโอ",
  add: "เพิ่มวิดีโอ",
  tabs: { all: "ทั้งหมด", published: "เผยแพร่แล้ว", draft: "ฉบับร่าง", archived: "เก็บถาวร" },
  columns: { thumbnail: "", title: "ชื่อคลิป", status: "สถานะ", featured: "แนะนำ", duration: "ความยาว", questions: "คำถาม", points: "แต้ม", views: "ผู้ชม" },
  lockedSr: "ล็อกแล้ว",
  actions: { edit: "แก้ไข", publish: "เผยแพร่", feature: "ตั้งเป็นคลิปแนะนำ", archive: "เก็บถาวร" },
  toast: { published: "เผยแพร่แล้วค่ะ", featured: "ตั้งเป็นคลิปแนะนำแล้วค่ะ (คลิปแนะนำเดิมถูกยกเลิก)", archived: "เก็บถาวรแล้วค่ะ" },
  archiveConfirm: {
    title: "เก็บคลิปนี้ถาวร?",
    body: "ผู้ชมใหม่จะไม่เห็นคลิปนี้ ผู้ที่เริ่มดูไว้แล้วยังดูต่อและรับแต้มได้ค่ะ",
    cancel: "ยกเลิก",
    confirm: "เก็บถาวร",
  },
  empty: { title: "ยังไม่มีวิดีโอค่ะ", body: "เริ่มเพิ่มคลิปแรกกันเลย" },
  emptyFilter: "ไม่มีวิดีโอในสถานะนี้",
  statusBadge: { published: "เผยแพร่แล้ว", draft: "ฉบับร่าง", archived: "เก็บถาวร" },
};

export const videoForm = {
  newTitle: "วิดีโอ",
  editTitle: "แก้ไขวิดีโอ",
  backAriaLabel: "กลับไปหน้ารายการวิดีโอ",
  fields: {
    youtubeUrl: { label: "ลิงก์ YouTube", helper: "วางลิงก์ เช่น https://youtu.be/…", error: "ลิงก์ YouTube ไม่ถูกต้อง", duplicateError: "คลิปนี้ถูกเพิ่มไว้แล้วค่ะ" },
    title: { label: "ชื่อคลิป", helperCreate: "เว้นว่างไว้เพื่อใช้ชื่อจาก YouTube" },
    channelName: (name: string) => `จาก YouTube: ${name}`,
    durationSec: { label: "ความยาว", helper: "ดึงจากตัวอย่างอัตโนมัติ", error: "ยังอ่านความยาวคลิปไม่ได้ กรุณารอตัวอย่างโหลดเสร็จค่ะ" },
    rewardPoints: { label: "แต้มที่ได้รับ", error: "แต้มต้องเป็นจำนวนเต็ม 1–1,000" },
  },
  saveCreate: "บันทึกและเพิ่มคำถาม",
  saveEdit: "บันทึกการแก้ไข",
  savedToast: "บันทึกวิดีโอแล้วค่ะ",
  savedEditToast: "บันทึกการแก้ไขแล้วค่ะ",
  unsavedConfirm: { title: "มีการแก้ไขที่ยังไม่บันทึก", body: "ออกจากหน้านี้เลยไหมคะ?", cancel: "ยกเลิก", confirm: "ออกจากหน้านี้" },
  lockedToast: "บางช่องถูกล็อกแล้ว เพราะมีผู้ชมเริ่มดูคลิปนี้ค่ะ",
  badOrigin: "คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่ค่ะ",
  featuredBadge: "★ คลิปแนะนำ",
  publishAction: "เผยแพร่",
  featureAction: "ตั้งเป็นคลิปแนะนำ",
  zeroQuestionsWarning: "คลิปนี้ยังไม่มีคำถาม ผู้ชมจะรับแต้มได้โดยไม่ต้องตอบคำถามค่ะ",
  errors: {
    invalidTrigger: (mmss: string) => `คำถามที่เวลา ${mmss} ไม่พอดีกับความยาวคลิปที่แก้ไขแล้ว กรุณาแก้ไขก่อนเผยแพร่ค่ะ`,
    validation: "คำถามในคลิปนี้ยังไม่ถูกต้อง กรุณาตรวจสอบก่อนเผยแพร่ค่ะ",
    generic: "ทำรายการไม่สำเร็จ กรุณาลองใหม่ค่ะ",
  },
};

export const youtubePreview = {
  empty: "วางลิงก์ YouTube เพื่อดูตัวอย่าง",
  error: "เล่นตัวอย่างไม่ได้ ตรวจสอบว่าลิงก์ถูกต้องและคลิปอนุญาตให้ฝัง (embed) ค่ะ",
  currentTime: (mmss: string, total: string) => `เวลาปัจจุบัน ${mmss} / ${total}`,
};

export const lockNotice = {
  title: (sessionCount: number) => `คลิปนี้มีผู้ชมเริ่มดูแล้ว จึงล็อกลิงก์ ความยาว เวลาของคำถาม และเฉลยไว้ค่ะ แก้ได้เฉพาะข้อความ ชื่อคลิป แต้ม และคลิปแนะนำ (ผู้ชม ${sessionCount} เซสชัน)`,
  reasonSr: "ล็อกแล้ว",
};

export const quizEditor = {
  title: (n: number) => `คำถามในคลิป (${n})`,
  add: "+ เพิ่มคำถาม",
  addDisabledHelper: "บันทึกวิดีโอก่อนจึงเพิ่มคำถามได้ค่ะ",
  summary: (mmss: string, prompt: string, choiceCount: number, correctLabel: string) => `⏱ ${mmss} · ${prompt} · ${choiceCount} ตัวเลือก · เฉลย ${correctLabel}`,
  triggerLabel: "เวลาที่คำถามขึ้น",
  useCurrentTime: "ใช้เวลาปัจจุบัน",
  useCurrentTimeAnnounce: (mmss: string) => `ตั้งเวลาเป็น ${mmss} แล้วค่ะ`,
  useCurrentTimeDisabledPreview: "รอตัวอย่างโหลดก่อนค่ะ",
  useCurrentTimeDisabledZero: "เล่นตัวอย่างก่อนถึงจะใช้เวลาปัจจุบันได้ค่ะ",
  goToTime: "ไปที่เวลานี้",
  triggerHelper: (maxMmss: string) => `ต้องมากกว่า 0:00 และน้อยกว่า ${maxMmss}`,
  promptLabel: "คำถาม",
  promptCounter: (n: number) => `${n}/300`,
  choicesLabel: "ตัวเลือก (2–4 ข้อ) — เลือกข้อที่ถูก",
  choiceTextAriaLabel: (label: string) => `ข้อความตัวเลือก ${label}`,
  correctSr: "เฉลย",
  addChoice: "+ เพิ่มตัวเลือก",
  removeChoiceAriaLabel: "ลบตัวเลือกนี้",
  deleteQuestion: "ลบคำถาม",
  saveQuestion: "บันทึกคำถาม",
  dirty: "ยังไม่บันทึก",
  saved: "บันทึกคำถามแล้วค่ะ",
  deleteConfirm: { title: "ลบคำถามนี้?", body: "ลบแล้วกู้คืนไม่ได้ค่ะ", cancel: "ยกเลิก", confirm: "ลบคำถาม" },
  empty: { title: "ยังไม่มีคำถามในคลิปนี้ค่ะ", body: "เล่นตัวอย่างไปยังจุดที่ต้องการ แล้วกด “เพิ่มคำถาม”" },
  errors: {
    triggerRange: (maxMmss: string) => `เวลาต้องมากกว่า 0:00 และน้อยกว่า ${maxMmss}`,
    duplicateTrigger: "มีคำถามที่เวลานี้แล้ว เลือกเวลาอื่นค่ะ",
    emptyPrompt: "กรุณากรอกคำถาม",
    emptyChoiceText: "กรุณากรอกตัวเลือก",
    duplicateChoiceLabels: "ตัวเลือกซ้ำกัน กรุณาลองใหม่ค่ะ",
    noCorrectChoice: "เลือกข้อที่ถูกต้อง 1 ข้อ",
    locked: "คำถามนี้ถูกล็อกบางส่วนแล้ว เพราะมีผู้ชมเริ่มดูคลิปนี้ค่ะ",
    generic: "บันทึกไม่สำเร็จ กรุณาลองใหม่ค่ะ",
  },
};

export const users = {
  title: "ผู้ใช้",
  columns: { user: "ผู้ใช้", createdAt: "เริ่มใช้งาน", totalPoints: "แต้มสะสม", sessionCount: "จำนวนเซสชัน", lastActiveAt: "ใช้งานล่าสุด" },
  copyAriaLabel: "คัดลอก",
  copiedToast: "คัดลอกแล้วค่ะ",
  empty: "ยังไม่มีผู้ใช้ค่ะ",
  detail: {
    title: (shortId: string) => `ผู้ใช้ ${shortId}`,
    startedAt: (date: string) => `เริ่มใช้งาน ${date}`,
    tiles: { totalPoints: "แต้มสะสม", videosRewarded: "คลิปที่ได้แต้ม", totalSessions: "เซสชันทั้งหมด", flagged: "🚩" },
    ledgerTitle: "ประวัติแต้ม",
    ledgerColumns: { date: "วันที่", video: "คลิป", points: "แต้ม" },
    ledgerEmpty: "ยังไม่ได้รับแต้มค่ะ",
    viewSession: "ดูเซสชัน",
    sessionsTitle: "เซสชัน",
    notFound: "ไม่พบผู้ใช้นี้ค่ะ",
    back: "กลับ",
  },
};

export const sessions = {
  title: "เซสชัน",
  allVideos: "ทุกวิดีโอ",
  flaggedOnly: "เฉพาะที่ถูกแจ้งเตือน 🚩",
  columns: {
    flagged: "🚩",
    startedAt: "เริ่ม",
    user: "ผู้ใช้",
    video: "วิดีโอ",
    state: "สถานะ",
    progress: "ดูถึง",
    type: "ประเภท",
    playedWallSec: "เวลาเล่นจริง",
    points: "แต้ม",
  },
  flaggedSr: "ถูกแจ้งเตือน",
  typeFirst: "รอบแรก",
  typeReplay: "ดูทบทวน",
  stateBadge: { CREATED: "ยังไม่เริ่ม", PLAYING: "กำลังดู", PAUSED: "หยุดไว้", QUIZ_PENDING: "รอตอบคำถาม", ENDED: "ดูจบ" },
  rewardedTag: "รับแต้มแล้ว",
  empty: "ยังไม่มีเซสชันค่ะ",
  emptyFilter: "ไม่พบเซสชันตามตัวกรองนี้ค่ะ",
  clearFilter: "ล้างตัวกรอง",
  detail: {
    title: (shortId: string) => `เซสชัน ${shortId}`,
    flaggedPill: "ถูกแจ้งเตือน",
    replayTag: "ดูทบทวน",
    facts: {
      user: "ผู้ใช้",
      video: "วิดีโอ",
      startedEnded: "เริ่ม / จบ",
      position: "ตำแหน่งล่าสุด / ไกลสุด",
      playedWallSec: "เวลาเล่นจริง",
      questionsPassed: "คำถามที่ผ่าน",
      questionsPassedValue: (passed: number, total: number) => `ผ่าน ${passed}/${total}`,
      questionsPassedNone: "ไม่มีคำถาม",
      questionsPassedPending: "กำลังรอตอบ",
      bankSec: "เครดิตข้ามคงเหลือ",
      softRejectCount: "การปฏิเสธแบบนับสะสม",
      eventCount: "จำนวนเหตุการณ์",
      points: "แต้ม",
      pointsReplay: "ดูทบทวน (ไม่ได้แต้ม)",
      pointsNone: "ยังไม่ได้รับ",
    },
    timeline: {
      title: "ไทม์ไลน์เหตุการณ์",
      onlyRejected: "แสดงเฉพาะที่ถูกปฏิเสธ",
      collapseTicks: "รวม TICK ที่ต่อเนื่อง",
      nextRejected: "ไปยังรายการที่ถูกปฏิเสธถัดไป",
      collapsedTicks: (n: number, from: string, to: string) => `ความคืบหน้า ×${n} · ${from} → ${to}`,
      systemChip: "ระบบ",
      flagWorthy: "ทำให้ถูกแจ้งเตือน",
      benignSuffix: "(ปกติ ไม่นับ)",
      empty: "ยังไม่มีเหตุการณ์ในเซสชันนี้ค่ะ",
      columns: { time: "เวลา", seq: "seq", event: "เหตุการณ์", position: "ตำแหน่ง", state: "สถานะ", result: "ผล", detail: "รายละเอียด" },
    },
    notFound: "ไม่พบเซสชันนี้ค่ะ",
  },
  eventType: {
    PLAY: "เล่น",
    PAUSE: "หยุด",
    TICK: "ความคืบหน้า",
    SEEK: "ย้อน/ข้าม",
    TAB_HIDDEN: "ออกจากแท็บ",
    ENDED: "จบคลิป",
    ANSWER: "ตอบคำถาม",
    CLAIM: "รับแต้ม",
    RESUME: "กลับมาดูต่อ",
  },
  rejectReason: {
    SEEK_FORWARD: "ข้ามไปข้างหน้า",
    SPEED_EXCEEDED: "เร็วผิดปกติ",
    NOT_WATCHED: "ดูไม่ครบ",
    QUIZ_REQUIRED: "ต้องตอบคำถามก่อน",
    BATCH_ABORTED: "ยกเลิกทั้งชุด",
    INVALID_TRANSITION: "ลำดับไม่ถูกต้อง",
  },
};

export const pagination = {
  showing: (from: number, to: number, total: number) => `แสดง ${from}–${to} จาก ${total}`,
  prev: "หน้าก่อนหน้า",
  next: "หน้าถัดไป",
  pageOf: (page: number, pages: number) => `หน้า ${page} / ${pages}`,
};

export const common = {
  retry: "ลองใหม่",
  loading: "กำลังโหลด…",
};
