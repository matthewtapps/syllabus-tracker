import type { User } from "./api";

export type TriageCategory = "active" | "coach_led" | "quiet";

export const TRIAGE_THRESHOLD_DAYS = 14;
const THRESHOLD_MS = TRIAGE_THRESHOLD_DAYS * 86400 * 1000;

function isRecent(ts: string | null | undefined, now: number): boolean {
  if (!ts) return false;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) && now - parsed <= THRESHOLD_MS;
}

/** Active iff the student has recent activity of their own (coach activity is
 *  irrelevant here). Otherwise coach-led if the coach updated them recently,
 *  else quiet. */
export function categorizeStudent(student: User, now: number): TriageCategory {
  if (isRecent(student.last_student_activity_at, now)) return "active";
  if (isRecent(student.last_coach_activity_at, now)) return "coach_led";
  return "quiet";
}

/** Refinement of Active: student active, coach not recently involved. */
export function isStudentLed(student: User, now: number): boolean {
  return (
    isRecent(student.last_student_activity_at, now) &&
    !isRecent(student.last_coach_activity_at, now)
  );
}
