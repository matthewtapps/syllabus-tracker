import { useEffect, useRef } from "react";
import type { PlayerController } from "../player-context";

/**
 * Seek a player to a starting position exactly once, as soon as it reports it
 * can seek. Used to resume a clip where the feed player left it: the surface
 * mounts a fresh player, so the seek has to wait for that player to register,
 * and must not fire again as the viewer scrubs around afterwards.
 *
 * A player that never registers a seek (an embed) never gets the position, the
 * same class of limitation as everywhere else seek is optional.
 */
export function useSeekOnce(
  controller: Pick<PlayerController, "canSeek" | "seekTo">,
  startAtSeconds: number | undefined | null,
): void {
  const doneRef = useRef(false);
  const { canSeek, seekTo } = controller;
  useEffect(() => {
    if (doneRef.current) return;
    if (startAtSeconds == null || startAtSeconds <= 0) return;
    if (!canSeek) return;
    doneRef.current = true;
    seekTo(startAtSeconds);
  }, [canSeek, seekTo, startAtSeconds]);
}
