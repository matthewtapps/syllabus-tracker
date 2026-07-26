/**
 * Minimal shape required by the scrubber-pins and moment-overlay components.
 * Both `ThreadView` (legacy video-timestamp threads) and future comment-based
 * timestamped entries satisfy this interface.
 */
export interface TimestampedEntry {
  id: number;
  author_id: number;
  author_name: string;
  body: string | null;
  video_ts_seconds: number | null;
}
