/**
 * CampSearchSheet — full-screen bottom sheet for searching within a camp.
 *
 * Opens from the search button in the camp header. Shows three groups:
 * Techniques, Videos, Threads & replies. Kind chips (All / Techniques /
 * Videos / Threads) toggle which groups render.
 *
 * Tapping a result calls onJump(threadId) and closes the sheet.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCampSearch } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { CampTechniqueHit, CampVideoHit, CampThreadHit } from "@/lib/api";

// ---------------------------------------------------------------------------
// Kind chips
// ---------------------------------------------------------------------------

type KindFilter = "all" | "technique" | "video" | "thread";

const KIND_LABELS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "technique", label: "Techniques" },
  { value: "video", label: "Videos" },
  { value: "thread", label: "Threads" },
];

function KindChips({
  active,
  onChange,
}: {
  active: KindFilter;
  onChange: (k: KindFilter) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {KIND_LABELS.map(({ value, label }) => (
        <Badge
          key={value}
          variant={active === value ? "default" : "outline"}
          className="cursor-pointer select-none whitespace-nowrap"
          onClick={() => onChange(value)}
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

function TechniqueRow({
  hit,
  onSelect,
}: {
  hit: CampTechniqueHit;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    >
      <span className="font-medium">{hit.technique_name}</span>
    </button>
  );
}

function VideoRow({
  hit,
  onSelect,
}: {
  hit: CampVideoHit;
  onSelect: () => void;
}) {
  const title = hit.title.trim() ? hit.title : "(untitled clip)";
  return (
    <button
      type="button"
      className={cn(
        "w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !hit.title.trim() && "text-muted-foreground",
      )}
      onClick={onSelect}
      // Only jumpable when there's a thread; camp-only footage without a thread
      // has no feed tile to scroll to (best-effort no-op).
      disabled={hit.thread_id == null}
    >
      <span className="font-medium">{title}</span>
    </button>
  );
}

function ThreadRow({
  hit,
  onSelect,
}: {
  hit: CampThreadHit;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    >
      {hit.is_comment && (
        <span className="mr-1.5 text-xs text-muted-foreground">Reply:</span>
      )}
      <span className="text-muted-foreground">{hit.snippet}</span>
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="sticky top-0 bg-background px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main sheet
// ---------------------------------------------------------------------------

export interface CampSearchSheetProps {
  campId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user taps a result. Sheet closes after this. */
  onJump: (threadId: number) => void;
}

export function CampSearchSheet({
  campId,
  open,
  onOpenChange,
  onJump,
}: CampSearchSheetProps) {
  const [rawQ, setRawQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when the sheet closes.
  useEffect(() => {
    if (!open) {
      setRawQ("");
      setKind("all");
    }
  }, [open]);

  // Autofocus the input after the sheet animation settles.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Map our local KindFilter to the API's optional kind param.
  const apiKind =
    kind === "all" ? undefined : (kind as "technique" | "video" | "thread");

  const { data, isFetching, isLoading } = useCampSearch(campId, rawQ, apiKind);

  const techniques = data?.techniques ?? [];
  const videos = data?.videos ?? [];
  const threads = data?.threads ?? [];

  const showTechniques = kind === "all" || kind === "technique";
  const showVideos = kind === "all" || kind === "video";
  const showThreads = kind === "all" || kind === "thread";

  const hasResults =
    (showTechniques && techniques.length > 0) ||
    (showVideos && videos.length > 0) ||
    (showThreads && threads.length > 0);

  const hasQuery = rawQ.trim().length > 0;

  function handleJump(threadId: number) {
    onOpenChange(false);
    onJump(threadId);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] flex-col gap-0 rounded-t-xl p-0"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-border px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            Search camp
          </SheetTitle>
          <SheetDescription className="sr-only">
            Search techniques, videos, and threads in this camp.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="relative">
            <Input
              ref={inputRef}
              value={rawQ}
              onChange={(e) => setRawQ(e.target.value)}
              placeholder="Search techniques, videos, threads..."
              className="pr-8"
              aria-label="Search query"
            />
            {isFetching && (
              <Loader2
                className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
          <KindChips active={kind} onChange={setKind} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasQuery ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Start typing to search.
            </p>
          ) : isLoading ? (
            <div className="flex justify-center px-4 py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : !hasResults ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No matches found.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {showTechniques && techniques.length > 0 && (
                <>
                  <SectionHeading>Techniques</SectionHeading>
                  {techniques.map((hit) => (
                    <li key={`tech-${hit.thread_id}`}>
                      <TechniqueRow
                        hit={hit}
                        onSelect={() => handleJump(hit.thread_id)}
                      />
                    </li>
                  ))}
                </>
              )}
              {showVideos && videos.length > 0 && (
                <>
                  <SectionHeading>Videos</SectionHeading>
                  {videos.map((hit) => (
                    <li key={`video-${hit.video_id}`}>
                      <VideoRow
                        hit={hit}
                        onSelect={() => {
                          if (hit.thread_id != null) handleJump(hit.thread_id);
                        }}
                      />
                    </li>
                  ))}
                </>
              )}
              {showThreads && threads.length > 0 && (
                <>
                  <SectionHeading>Threads &amp; replies</SectionHeading>
                  {threads.map((hit, i) => (
                    // thread hits can duplicate thread_id (comment vs root), key by index
                    <li key={`thread-${hit.thread_id}-${i}`}>
                      <ThreadRow
                        hit={hit}
                        onSelect={() => handleJump(hit.thread_id)}
                      />
                    </li>
                  ))}
                </>
              )}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
