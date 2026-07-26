import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StudentAvatar } from "@/components/student-avatar";
import { formatRelativeShort, formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface TeaserLineProps {
  authorId: number;
  authorName: string;
  createdAt: string;
  body: string | null;
  /** Anchor seconds for a video_timestamp comment. Rendered as a plain span:
   *  the whole teaser region is one button, so it can hold no chip button. */
  tsSeconds?: number | null;
  /** Italic muted stand-in for a null body: "video reply" on a reply line,
   *  "video post" on a thread root. */
  fallback?: string;
  /** 3 for a thread tile's root post, 2 everywhere else. */
  clamp?: 2 | 3;
}

/**
 * One previewed comment inside a teaser tile: avatar, author, relative time and
 * a clamped body. Carries no interactive children by design, so a tile can wrap
 * several of these in a single button without nesting one button in another.
 */
export function TeaserLine({
  authorId,
  authorName,
  createdAt,
  body,
  tsSeconds,
  fallback = "video reply",
  clamp = 2,
}: TeaserLineProps) {
  return (
    <div className="flex items-start gap-2">
      <StudentAvatar id={authorId} name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{authorName}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatRelativeShort(createdAt)}
          </span>
        </p>
        <p
          className={cn(
            "text-sm text-foreground/90",
            clamp === 3 ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {tsSeconds != null && (
            <span className="mr-1 font-medium text-primary">{formatTimestamp(tsSeconds)}</span>
          )}
          {body ?? <span className="italic text-muted-foreground">{fallback}</span>}
        </p>
      </div>
    </div>
  );
}

/** Last line of a teaser region: how much more the detail sheet holds. */
export function ViewAllLine({
  count,
  noun,
}: {
  count: number;
  noun: "comment" | "reply";
}) {
  const label =
    count === 1 ? noun : noun === "reply" ? "replies" : "comments";
  return <p className="text-sm text-muted-foreground">{`View all ${count} ${label}`}</p>;
}

/**
 * The tap target around a tile's teaser lines: one link to the subject in its
 * real surface, no interactive descendants, at least 44px tall, with press-dim
 * feedback so a tap reads as handled before the route changes.
 *
 * A link rather than a button because the destination is a real page. That
 * buys middle-click, long-press and the browser's own affordances for free,
 * and Back returns to the feed with its scroll position restored.
 */
export function TeaserRegion({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={href}
      className={cn(
        "flex min-h-11 w-full flex-col gap-2 px-4 py-3 text-left outline-none transition-colors",
        "hover:bg-muted/30 focus-visible:bg-muted/50 active:bg-muted/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}
