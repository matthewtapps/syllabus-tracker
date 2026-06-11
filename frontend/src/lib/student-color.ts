// Deterministic, stateless per-student color. Seeded on the immutable user id
// (never the name) so a student is the same color forever. Color is a
// secondary identity cue (initials and name carry identity), so palette
// collisions past 12 students are acceptable and there is no legend.

export interface StudentColor {
  /** Low-opacity wash for the avatar background. */
  bg: string;
  /** Bright, legible foreground for the initials. */
  fg: string;
}

// Curated, dark-mode-tuned hues. Each entry is precomputed so we never emit a
// muddy or low-contrast color the way raw hashed HSL would.
export const STUDENT_COLOR_PALETTE: StudentColor[] = [
  { bg: "hsla(210, 65%, 55%, 0.20)", fg: "hsl(210, 80%, 74%)" },
  { bg: "hsla(160, 60%, 50%, 0.20)", fg: "hsl(160, 70%, 68%)" },
  { bg: "hsla(280, 60%, 60%, 0.22)", fg: "hsl(280, 75%, 80%)" },
  { bg: "hsla(35, 75%, 55%, 0.20)", fg: "hsl(35, 85%, 68%)" },
  { bg: "hsla(340, 70%, 58%, 0.20)", fg: "hsl(340, 80%, 76%)" },
  { bg: "hsla(20, 75%, 55%, 0.22)", fg: "hsl(20, 85%, 70%)" },
  { bg: "hsla(95, 55%, 48%, 0.22)", fg: "hsl(95, 65%, 66%)" },
  { bg: "hsla(250, 65%, 62%, 0.22)", fg: "hsl(250, 80%, 80%)" },
  { bg: "hsla(185, 65%, 48%, 0.22)", fg: "hsl(185, 75%, 66%)" },
  { bg: "hsla(310, 60%, 58%, 0.22)", fg: "hsl(310, 75%, 78%)" },
  { bg: "hsla(55, 70%, 50%, 0.20)", fg: "hsl(55, 80%, 68%)" },
  { bg: "hsla(225, 60%, 60%, 0.22)", fg: "hsl(225, 78%, 80%)" },
];

/** Knuth multiplicative hash to scatter sequential ids across the palette. */
export function studentColor(id: number): StudentColor {
  const hashed = Math.imul(id >>> 0, 2654435761) >>> 0;
  return STUDENT_COLOR_PALETTE[hashed % STUDENT_COLOR_PALETTE.length];
}
