import { log } from "./log.js";
import type { YoutubeContentAlert } from "./types.js";
import {
  isYoutubeQuotaExceededError,
  isYoutubeQuotaPaused,
  pauseYoutubeQuotaUntilDailyReset,
  YoutubeQuotaExceededError,
} from "./youtube-quota.js";

export interface YoutubeChannelInfo {
  id: string;
  title: string;
}

export type YoutubeLiveStream = YoutubeContentAlert & { type: "live" };

export interface ChannelCheckResult {
  live: YoutubeLiveStream | null;
  upload: YoutubeContentAlert | null;
  post: YoutubeContentAlert | null;
}

interface YoutubeApiListResponse<T> {
  items?: T[];
}

interface YoutubeChannelItem {
  id: string;
  snippet?: { title?: string };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
}

interface YoutubePlaylistItem {
  snippet?: {
    resourceId?: { videoId?: string };
  };
}

interface YoutubeVideoItem {
  id: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: { high?: { url?: string }; default?: { url?: string } };
    liveBroadcastContent?: string;
  };
  contentDetails?: {
    duration?: string;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
  };
}

interface YoutubeActivityItem {
  id: string;
  snippet?: {
    type?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: { high?: { url?: string }; default?: { url?: string } };
  };
  contentDetails?: {
    bulletin?: {
      description?: string;
    };
  };
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  // Bypass EU consent redirect that blocks server-side /live scraping.
  Cookie: "CONSENT=YES+1; SOCS=CAI",
};

export class YoutubeApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly communityPostChecksEnabled = false,
  ) {}

  private async fetchApi<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    if (isYoutubeQuotaPaused()) {
      throw new YoutubeQuotaExceededError(
        "YouTube API quota pause is active until the daily reset",
      );
    }

    const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
    url.searchParams.set("key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403 && isQuotaExceededResponse(body)) {
        const resumeAt = pauseYoutubeQuotaUntilDailyReset();
        throw new YoutubeQuotaExceededError(
          `YouTube API daily quota exceeded — paused until ${resumeAt.toISOString()}`,
        );
      }

      throw new Error(`YouTube API error (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }

  async resolveChannel(input: string): Promise<YoutubeChannelInfo> {
    const trimmed = input.trim();

    const channelIdMatch = trimmed.match(
      /(?:youtube\.com\/channel\/)(UC[\w-]{22})/i,
    );
    if (channelIdMatch) {
      return this.getChannelById(channelIdMatch[1]);
    }

    const handleMatch = trimmed.match(/(?:youtube\.com\/@)([\w.-]+)/i);
    if (handleMatch) {
      return this.getChannelByHandle(handleMatch[1]);
    }

    if (/^UC[\w-]{22}$/i.test(trimmed)) {
      return this.getChannelById(trimmed);
    }

    if (trimmed.startsWith("@")) {
      return this.getChannelByHandle(trimmed.slice(1));
    }

    throw new Error(
      "Invalid YouTube channel. Use a channel URL, @handle, or channel ID (UC...).",
    );
  }

  private async getChannelById(channelId: string): Promise<YoutubeChannelInfo> {
    const data = await this.fetchApi<YoutubeApiListResponse<YoutubeChannelItem>>(
      "channels",
      { part: "snippet", id: channelId },
    );

    const channel = data.items?.[0];
    if (!channel) {
      throw new Error(`YouTube channel not found: ${channelId}`);
    }

    return {
      id: channel.id,
      title: channel.snippet?.title ?? channelId,
    };
  }

  private async getChannelByHandle(handle: string): Promise<YoutubeChannelInfo> {
    const data = await this.fetchApi<YoutubeApiListResponse<YoutubeChannelItem>>(
      "channels",
      { part: "snippet", forHandle: handle },
    );

    const channel = data.items?.[0];
    if (!channel) {
      throw new Error(`YouTube channel not found for handle: @${handle}`);
    }

    return {
      id: channel.id,
      title: channel.snippet?.title ?? handle,
    };
  }

  async checkChannel(channelId: string): Promise<ChannelCheckResult> {
    if (isYoutubeQuotaPaused()) {
      return this.checkChannelLiveOnly(channelId);
    }

    const result: ChannelCheckResult = {
      live: null,
      upload: null,
      post: null,
    };

    const [scrapedLiveVideoId, channelItem, activities] = await Promise.all([
      this.resolveLiveVideoId(channelId),
      this.fetchChannelContentDetails(channelId),
      this.communityPostChecksEnabled
        ? this.fetchActivities(channelId)
        : Promise.resolve([]),
    ]);

    for (const activity of activities) {
      const alert = this.mapActivityToPostAlert(activity, channelId);
      if (alert) {
        result.post = alert;
        break;
      }
    }

    const uploadsPlaylistId =
      channelItem?.contentDetails?.relatedPlaylists?.uploads ?? null;

    let playlistVideoIds: string[] = [];
    if (uploadsPlaylistId) {
      try {
        playlistVideoIds = await this.fetchPlaylistVideoIds(uploadsPlaylistId);
      } catch (error) {
        if (isYoutubeQuotaExceededError(error)) {
          throw error;
        }
        log.warn(
          { err: error, channelId },
          `Uploads playlist fetch failed: ${formatApiError(error)}`,
        );
      }
    }

    const videoIds = [
      ...new Set([
        ...(scrapedLiveVideoId ? [scrapedLiveVideoId] : []),
        ...playlistVideoIds,
      ]),
    ];

    const videosById = await this.fetchVideosById(videoIds, channelId);

    if (scrapedLiveVideoId) {
      const scrapedVideo = videosById.get(scrapedLiveVideoId);
      if (scrapedVideo) {
        result.live = this.mapVideoToLiveStream(scrapedVideo, channelId);
      } else {
        result.live = await this.tryConfirmLiveStream(
          scrapedLiveVideoId,
          channelId,
        );
      }
    }

    if (!result.live) {
      for (const videoId of playlistVideoIds) {
        const video = videosById.get(videoId);
        if (!video) {
          continue;
        }
        const stream = this.mapVideoToLiveStream(video, channelId);
        if (stream) {
          result.live = stream;
          break;
        }
      }
    }

    for (const videoId of playlistVideoIds) {
      const video = videosById.get(videoId);
      if (!video) {
        continue;
      }
      const alert = this.mapVideoToUploadAlert(video, channelId);
      if (alert) {
        result.upload = alert;
        break;
      }
    }

    return result;
  }

  /** Scrape /live and confirm via oEmbed only — no YouTube Data API quota. */
  async checkChannelLiveOnly(channelId: string): Promise<ChannelCheckResult> {
    const result: ChannelCheckResult = {
      live: null,
      upload: null,
      post: null,
    };

    const videoId = await this.resolveLiveVideoId(channelId);
    if (videoId) {
      result.live = await this.getLiveStreamFromOembed(videoId, channelId);
    }

    return result;
  }

  private async fetchChannelContentDetails(
    channelId: string,
  ): Promise<YoutubeChannelItem | null> {
    try {
      const data = await this.fetchApi<
        YoutubeApiListResponse<YoutubeChannelItem>
      >("channels", { part: "contentDetails", id: channelId });

      return data.items?.[0] ?? null;
    } catch (error) {
      if (isYoutubeQuotaExceededError(error)) {
        throw error;
      }
      log.warn(
        { err: error, channelId },
        `Channel metadata fetch failed: ${formatApiError(error)}`,
      );
      return null;
    }
  }

  private async fetchActivities(
    channelId: string,
  ): Promise<YoutubeActivityItem[]> {
    try {
      const data = await this.fetchApi<
        YoutubeApiListResponse<YoutubeActivityItem>
      >("activities", {
        part: "snippet,contentDetails",
        channelId,
        maxResults: "15",
      });

      return data.items ?? [];
    } catch (error) {
      if (isYoutubeQuotaExceededError(error)) {
        throw error;
      }
      log.warn(
        { err: error, channelId },
        `Community post check failed: ${formatApiError(error)}`,
      );
      return [];
    }
  }

  private async fetchPlaylistVideoIds(
    uploadsPlaylistId: string,
  ): Promise<string[]> {
    const playlistData = await this.fetchApi<
      YoutubeApiListResponse<YoutubePlaylistItem>
    >("playlistItems", {
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: "10",
    });

    return (
      playlistData.items
        ?.map((item) => item.snippet?.resourceId?.videoId)
        .filter((id): id is string => Boolean(id)) ?? []
    );
  }

  private async fetchVideosById(
    videoIds: string[],
    channelId: string,
  ): Promise<Map<string, YoutubeVideoItem>> {
    if (videoIds.length === 0) {
      return new Map();
    }

    try {
      const videosData = await this.fetchApi<
        YoutubeApiListResponse<YoutubeVideoItem>
      >("videos", {
        part: "snippet,contentDetails,liveStreamingDetails",
        id: videoIds.join(","),
      });

      return new Map(
        (videosData.items ?? []).map((video) => [video.id, video]),
      );
    } catch (error) {
      if (isYoutubeQuotaExceededError(error)) {
        throw error;
      }
      log.warn(
        { err: error, channelId },
        `Video metadata fetch failed: ${formatApiError(error)}`,
      );
      return new Map();
    }
  }

  private async tryConfirmLiveStream(
    videoId: string,
    channelId: string,
  ): Promise<YoutubeLiveStream | null> {
    try {
      return await this.getLiveStreamFromApi(videoId, channelId);
    } catch (error) {
      if (isYoutubeQuotaExceededError(error)) {
        throw error;
      }
      log.warn(
        { err: error, videoId },
        `videos.list failed, using oEmbed fallback: ${formatApiError(error)}`,
      );
      return this.getLiveStreamFromOembed(videoId, channelId);
    }
  }

  private async resolveLiveVideoId(channelId: string): Promise<string | null> {
    const response = await fetch(
      `https://www.youtube.com/channel/${channelId}/live`,
      { headers: FETCH_HEADERS, redirect: "manual" },
    );

    const redirectUrl = response.headers.get("location");
    if (redirectUrl) {
      if (redirectUrl.includes("consent.youtube.com")) {
        return this.resolveLiveVideoIdFromHtml(channelId);
      }

      const videoId = extractVideoId(redirectUrl);
      if (videoId) {
        return videoId;
      }
    }

    if (response.ok) {
      return this.extractLiveVideoIdFromHtml(
        await response.text(),
        channelId,
      );
    }

    return null;
  }

  private async resolveLiveVideoIdFromHtml(
    channelId: string,
  ): Promise<string | null> {
    const response = await fetch(
      `https://www.youtube.com/channel/${channelId}/live`,
      { headers: FETCH_HEADERS },
    );

    if (!response.ok) {
      return null;
    }

    return this.extractLiveVideoIdFromHtml(await response.text(), channelId);
  }

  private extractLiveVideoIdFromHtml(
    html: string,
    expectedChannelId: string,
  ): string | null {
    if (/"LIVE_STREAM_OFFLINE"/.test(html)) {
      return null;
    }

    const canonical = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    );
    if (canonical) {
      return canonical[1];
    }

    const ogUrl = html.match(
      /property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    );
    if (ogUrl) {
      return ogUrl[1];
    }

    const isLive =
      /"isLive":true/.test(html) ||
      /"isLiveContent":true/.test(html) ||
      /"liveBroadcastDetails"/.test(html);

    if (!isLive) {
      return null;
    }

    const videoDetailsStart = html.indexOf('"videoDetails":');
    if (videoDetailsStart !== -1) {
      const block = html.slice(videoDetailsStart, videoDetailsStart + 2000);
      const videoId = block.match(/"videoId":"([\w-]{11})"/)?.[1];
      const ownerChannelId = block.match(/"channelId":"(UC[\w-]{22})"/i)?.[1];

      if (videoId && ownerChannelId) {
        if (ownerChannelId !== expectedChannelId) {
          log.debug(
            { expectedChannelId, ownerChannelId, videoId },
            "Ignoring scraped live video from another channel",
          );
          return null;
        }
        return videoId;
      }

      if (videoId) {
        return videoId;
      }
    }

    return null;
  }

  private async getLiveStreamFromApi(
    videoId: string,
    channelId: string,
  ): Promise<YoutubeLiveStream | null> {
    const data = await this.fetchApi<YoutubeApiListResponse<YoutubeVideoItem>>(
      "videos",
      { part: "liveStreamingDetails,snippet", id: videoId },
    );

    const video = data.items?.[0];
    if (!video) {
      return null;
    }

    return this.mapVideoToLiveStream(video, channelId);
  }

  private mapVideoToLiveStream(
    video: YoutubeVideoItem,
    expectedChannelId: string,
  ): YoutubeLiveStream | null {
    const live = video.liveStreamingDetails;
    const isLive =
      live?.actualStartTime &&
      !live.actualEndTime &&
      video.snippet?.liveBroadcastContent === "live";

    if (!isLive) {
      return null;
    }

    const snippet = video.snippet;
    const ownerChannelId = snippet?.channelId;
    if (!ownerChannelId || ownerChannelId !== expectedChannelId) {
      if (ownerChannelId) {
        log.debug(
          { expectedChannelId, ownerChannelId, videoId: video.id },
          "Ignoring live stream from another channel",
        );
      }
      return null;
    }

    const thumbnail =
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

    return {
      type: "live",
      contentId: video.id,
      title: snippet?.title ?? "Live Stream",
      channelId: ownerChannelId,
      channelTitle: snippet?.channelTitle ?? "Unknown Channel",
      thumbnailUrl: thumbnail,
      url: `https://www.youtube.com/watch?v=${video.id}`,
    };
  }

  private mapVideoToUploadAlert(
    video: YoutubeVideoItem,
    fallbackChannelId: string,
  ): YoutubeContentAlert | null {
    const live = video.liveStreamingDetails;
    const broadcast = video.snippet?.liveBroadcastContent;

    if (
      broadcast === "live" ||
      (live?.actualStartTime && !live.actualEndTime)
    ) {
      return null;
    }

    const snippet = video.snippet;
    const thumbnail =
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

    const durationSeconds = parseIso8601Duration(
      video.contentDetails?.duration,
    );
    const isShort = durationSeconds > 0 && durationSeconds <= 60;

    return {
      type: "video",
      contentId: video.id,
      title: snippet?.title ?? "New video",
      channelId: snippet?.channelId ?? fallbackChannelId,
      channelTitle: snippet?.channelTitle ?? "Unknown Channel",
      thumbnailUrl: thumbnail,
      url: isShort
        ? `https://www.youtube.com/shorts/${video.id}`
        : `https://www.youtube.com/watch?v=${video.id}`,
      isShort,
    };
  }

  private mapActivityToPostAlert(
    activity: YoutubeActivityItem,
    fallbackChannelId: string,
  ): YoutubeContentAlert | null {
    const snippetType = activity.snippet?.type;
    const hasBulletin = Boolean(activity.contentDetails?.bulletin);

    if (snippetType !== "bulletin" && !hasBulletin) {
      return null;
    }

    const snippet = activity.snippet;

    const thumbnail =
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.default?.url ??
      "";

    return {
      type: "post",
      contentId: activity.id,
      title:
        activity.contentDetails?.bulletin?.description ??
        snippet?.description ??
        snippet?.title ??
        "Community post",
      channelId: snippet?.channelId ?? fallbackChannelId,
      channelTitle: snippet?.channelTitle ?? "Unknown Channel",
      thumbnailUrl: thumbnail,
      url: `https://www.youtube.com/channel/${snippet?.channelId ?? fallbackChannelId}/community?lb=${activity.id}`,
    };
  }

  private async getLiveStreamFromOembed(
    videoId: string,
    channelId: string,
  ): Promise<YoutubeLiveStream | null> {
    const url = new URL("https://www.youtube.com/oembed");
    url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
    url.searchParams.set("format", "json");

    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OEmbedResponse;
    const ownerChannelId = extractChannelIdFromAuthorUrl(data.author_url);
    if (!ownerChannelId || ownerChannelId !== channelId) {
      log.debug(
        { channelId, ownerChannelId, videoId },
        "Ignoring oEmbed live stream from another channel",
      );
      return null;
    }

    return {
      type: "live",
      contentId: videoId,
      title: data.title ?? "Live Stream",
      channelId: ownerChannelId,
      channelTitle: data.author_name ?? "Unknown Channel",
      thumbnailUrl:
        data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }
}

function formatApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isQuotaExceededResponse(body: string): boolean {
  return (
    body.includes("quotaExceeded") ||
    body.includes("youtube.quota") ||
    body.includes("exceeded your")
  );
}

function parseIso8601Duration(duration: string | undefined): number {
  if (!duration) {
    return 0;
  }

  const match = duration.match(
    /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/,
  );
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function extractChannelIdFromAuthorUrl(
  authorUrl: string | undefined,
): string | null {
  if (!authorUrl) {
    return null;
  }

  const match = authorUrl.match(/\/channel\/(UC[\w-]{22})/i);
  return match?.[1] ?? null;
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
