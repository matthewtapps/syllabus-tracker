import { useCallback, useEffect, useRef, useState } from "react";
import { getPlaybackUrl } from "@/lib/api";

interface State {
  url: string | null;
  loading: boolean;
  error: string | null;
}

const REFRESH_LEAD_MS = 5 * 60 * 1000;

export function useSignedPlaybackUrl(videoId: number, enabled: boolean) {
  const [state, setState] = useState<State>({
    url: null,
    loading: false,
    error: null,
  });
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const signed = await getPlaybackUrl(videoId);
      if (cancelledRef.current) return;
      setState({ url: signed.url, loading: false, error: null });
      const expiresAt = Date.parse(signed.expires_at);
      if (Number.isFinite(expiresAt)) {
        const wait = Math.max(15_000, expiresAt - Date.now() - REFRESH_LEAD_MS);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          if (!cancelledRef.current) load();
        }, wait);
      }
    } catch (err) {
      console.error(err);
      if (cancelledRef.current) return;
      setState({
        url: null,
        loading: false,
        error: "Could not get a playback link. Try again.",
      });
    }
  }, [videoId]);

  useEffect(() => {
    cancelledRef.current = false;
    if (enabled) load();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, load]);

  return { ...state, refresh: load };
}
