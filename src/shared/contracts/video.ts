// Response shapes for the public video endpoints (plan §4.1, §4.5). Backend services return
// these exact shapes; frontend imports them from here instead of the backend module.

export interface MeResponse {
  totalPoints: number;
  rewardedVideoIds: string[];
}

export interface PublicVideoItem {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  rewarded: boolean;
  questionCount: number;
}

export interface VideoListResponse {
  featured: PublicVideoItem | null;
  videos: PublicVideoItem[];
}
