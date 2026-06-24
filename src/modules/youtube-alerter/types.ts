export type YoutubeAlertType = "live" | "video" | "post";

export interface YoutubeContentAlert {
  type: YoutubeAlertType;
  contentId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  url: string;
  isShort?: boolean;
}

export const ALERT_TYPE_LABELS: Record<YoutubeAlertType, string> = {
  live: "Live stream",
  video: "Video",
  post: "Community post",
};
