// Shared by backend domain, API contracts and the admin client.

export const VIDEO_STATUSES = ["draft", "published", "archived"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
