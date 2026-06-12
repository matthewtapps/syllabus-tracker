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

function parse(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
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
