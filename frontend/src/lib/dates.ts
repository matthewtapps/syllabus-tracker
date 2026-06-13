const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const ABSOLUTE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME_ONLY = new Intl.DateTimeFormat([], {
  hour: "2-digit",
  minute: "2-digit",
});

// Naive datetime with no timezone designator, e.g. "2026-06-13 04:00:00" or
// "2026-06-13T04:00:00". The server stores and serialises these in UTC.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function parse(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  let value = input;
  // Without a timezone, new Date() reads the string as local time, which skews
  // every timestamp by the viewer's UTC offset. Treat naive values as UTC.
  if (typeof value === "string" && NAIVE_DATETIME.test(value.trim())) {
    value = value.trim().replace(" ", "T") + "Z";
  }
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function formatRelative(input: string | Date | null | undefined): string {
  const date = parse(input);
  if (!date) return "No activity";

  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 60) return RELATIVE.format(diffSec, "second");
  if (absSec < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86400) {
    const hours = Math.round(diffSec / 3600);
    if (Math.abs(hours) < 6) return RELATIVE.format(hours, "hour");
    return `Today at ${TIME_ONLY.format(date)}`;
  }
  if (absSec < 7 * 86400) {
    return RELATIVE.format(Math.round(diffSec / 86400), "day");
  }
  return ABSOLUTE.format(date);
}

export function formatAbsolute(input: string | Date | null | undefined): string {
  const date = parse(input);
  if (!date) return "—";
  return ABSOLUTE.format(date);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * Compact relative time for dense lists: "now", "5m", "3h", "2d", then a short
 * date ("Jun 1"). Distinct from formatRelative, which is wordier.
 */
/**
 * Format a video offset in seconds as a compact timestamp: "0:42", "1:05",
 * or "1:05:03" once past an hour. Floors fractional seconds, clamps negatives.
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

export function formatRelativeShort(input: string | Date | null | undefined): string {
  const date = parse(input);
  if (!date) return "";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d`;
  return SHORT_DATE.format(date);
}
