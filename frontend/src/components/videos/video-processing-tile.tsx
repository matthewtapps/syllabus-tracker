import { Loader2, TriangleAlert, Video as VideoIcon } from "lucide-react";
import type { Video } from "@/lib/api";
import { posterFor } from "./poster-frame";

/** Stands in for the player while a clip processes or after it fails, at the
 *  clip's own aspect ratio so nothing shifts once it becomes playable. The
 *  uploader sees the still their composer showed; everyone else sees the icon. */
export function VideoProcessingTile({
  video,
  state,
}: {
  video: Video;
  state: "processing" | "failed";
}) {
  const aspectRatio =
    video.width && video.height && video.width > 0 && video.height > 0
      ? video.width / video.height
      : 16 / 9;
  const isPortrait = aspectRatio < 1;
  const poster = state === "processing" ? posterFor(video.id) : null;
  const failed = state === "failed";

  return (
    <div
      style={{ aspectRatio }}
      className={`relative overflow-hidden rounded-md border ${
        isPortrait ? "mx-auto h-[50svh] w-auto max-w-full" : "w-full"
      } ${failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}
    >
      {poster && (
        <img
          src={poster}
          alt=""
          className="h-full w-full object-cover opacity-40 blur-[2px]"
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        {failed ? (
          <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden />
        ) : poster ? (
          <Loader2 className="h-6 w-6 animate-spin text-foreground/70" aria-hidden />
        ) : (
          <>
            <VideoIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          </>
        )}
        <span
          className={`text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
        >
          {failed ? "Processing failed. Re-upload to try again." : "Processing..."}
        </span>
      </div>
    </div>
  );
}
