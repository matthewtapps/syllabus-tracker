/**
 * Poster frames grabbed from a local file, and the memory of which video each
 * one belongs to. The server stores no thumbnails, so a still only exists for
 * whoever picked the file, in the session they picked it in.
 */

const postersByVideoId = new Map<number, string>();

/** Ties a poster to the video the upload became, so the posted card can show
 *  the same still the composer did while the clip processes. */
export function rememberPoster(videoId: number, poster: string): void {
  postersByVideoId.set(videoId, poster);
}

export function posterFor(videoId: number): string | null {
  return postersByVideoId.get(videoId) ?? null;
}

/** Grabs a still frame from a local video File so an attachment can show a
 *  thumbnail before the clip has been uploaded or processed. */
export async function posterFromFile(file: File, size = 96): Promise<string | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    function finish(poster: string | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(poster);
    }

    // A codec the browser cannot decode never fires an event either way.
    const timer = setTimeout(() => finish(null), 4000);

    function draw() {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx || !video.videoWidth) return finish(null);
        const scale = Math.max(size / video.videoWidth, size / video.videoHeight);
        const w = video.videoWidth * scale;
        const h = video.videoHeight * scale;
        ctx.drawImage(video, (size - w) / 2, (size - h) / 2, w, h);
        finish(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        finish(null);
      }
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onerror = () => finish(null);
    video.onseeked = draw;
    video.onloadeddata = () => {
      if (video.currentTime > 0) draw();
      else video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.src = url;
  });
}
