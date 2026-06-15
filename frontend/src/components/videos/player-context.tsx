import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";

export interface PlayerController {
  currentTime: number;
  duration: number;
  paused: boolean;
  canReadTime: boolean;
  canSeek: boolean;
  seekTo: (seconds: number) => void;
  isFullscreen: boolean;
  exitFullscreen: () => void;
}

export interface PlayerRegistration {
  registerSeek: (fn: (seconds: number) => void) => void;
  reportProgress: (currentTime: number, duration: number) => void;
  reportPaused: (paused: boolean) => void;
  registerExitFullscreen: (fn: () => void) => void;
  reportFullscreen: (fullscreen: boolean) => void;
}

const Ctx = createContext<PlayerController | null>(null);
const RegistrationCtx = createContext<PlayerRegistration | null>(null);

export function usePlayerController(): PlayerController {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayerController() must be used inside <PlayerControllerProvider>.");
  return ctx;
}

/** Players call this to wire their <video> element to the controller. */
export function usePlayerRegistration(): PlayerRegistration | null {
  return useContext(RegistrationCtx);
}

interface ProviderProps {
  children: ReactNode;
  /** Called once so a player (or a test) can register its imperative hooks. */
  onReady?: (register: PlayerRegistration) => void;
}

export function PlayerControllerProvider({ children, onReady }: ProviderProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [canReadTime, setCanReadTime] = useState(false);
  const [canSeek, setCanSeek] = useState(false);
  const seekRef = useRef<((s: number) => void) | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const exitFsRef = useRef<(() => void) | null>(null);

  const register = useMemo<PlayerRegistration>(() => ({
    registerSeek: (fn) => { seekRef.current = fn; setCanSeek(true); },
    reportProgress: (t, d) => { setCurrentTime(t); if (Number.isFinite(d)) setDuration(d); setCanReadTime(true); },
    reportPaused: (p) => setPaused(p),
    registerExitFullscreen: (fn) => { exitFsRef.current = fn; },
    reportFullscreen: (f) => setIsFullscreen(f),
  }), []);

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onReady?.(register);
  }, [onReady, register]);

  const seekTo = useCallback((seconds: number) => { seekRef.current?.(Math.max(0, seconds)); }, []);
  const exitFullscreen = useCallback(() => { exitFsRef.current?.(); }, []);

  const value = useMemo<PlayerController>(
    () => ({ currentTime, duration, paused, canReadTime, canSeek, seekTo, isFullscreen, exitFullscreen }),
    [currentTime, duration, paused, canReadTime, canSeek, seekTo, isFullscreen, exitFullscreen],
  );

  return (
    <Ctx.Provider value={value}>
      <RegistrationCtx.Provider value={register}>{children}</RegistrationCtx.Provider>
    </Ctx.Provider>
  );
}
