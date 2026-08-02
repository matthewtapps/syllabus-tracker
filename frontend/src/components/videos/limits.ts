export const MAX_VIDEO_BYTES = 209_715_200; // 200 MiB
export const MAX_VIDEO_DURATION_SECONDS = 300;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Rejects what every upload route would reject anyway, before the bytes go up.
 *  Returns the message to show, or null when the file is acceptable. */
export async function validateVideoFile(file: File): Promise<string | null> {
  if (file.type && !file.type.startsWith("video/")) {
    return "That file isn't a video. Pick a video and try again.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `File is ${formatBytes(file.size)}; max allowed is ${formatBytes(MAX_VIDEO_BYTES)}.`;
  }
  try {
    const duration = await probeDurationSeconds(file);
    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      return `Video is ${Math.round(duration)}s long; max allowed is ${MAX_VIDEO_DURATION_SECONDS}s.`;
    }
  } catch {
    // Some browsers fail to read duration for mp4; let the server enforce it.
  }
  return null;
}

async function probeDurationSeconds(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration)) resolve(video.duration);
        else reject(new Error("Could not read duration"));
      };
      video.onerror = () => reject(new Error("Could not read duration"));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
