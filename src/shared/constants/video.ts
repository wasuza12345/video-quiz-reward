// Shared by backend domain, API contracts and the admin client.

export const VIDEO_STATUSES = ["draft", "published", "archived"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** youtubeUrl VALIDATION_ERROR issue.message values video.service.ts can send — the admin client
 * (youtubeUrlIssueMessage) keys its Thai copy off these exact strings. */
export const VIDEO_ISSUE = {
  ALREADY_ADDED: "already added",
} as const;
