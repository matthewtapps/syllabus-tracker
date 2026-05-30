export interface PlayerEvents {
  onPlay?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onOpened?: () => void;
}
