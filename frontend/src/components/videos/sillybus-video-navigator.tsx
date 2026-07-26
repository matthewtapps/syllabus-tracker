import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, GraduationCap, Search, Tent, Video as VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { browseVideos, type BrowseParent, type BrowseVideo } from "@/lib/api";

type Source = "library" | "camps" | "syllabuses";

interface Level {
  kind: "sources";
}

interface Level2 {
  kind: "parents";
  source: Source;
}

interface Level3 {
  kind: "videos";
  source: Source;
  parent: BrowseParent;
}

interface LevelSearch {
  kind: "search";
  q: string;
}

type NavLevel = Level | Level2 | Level3 | LevelSearch;

interface SillybusVideoNavigatorProps {
  studentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (video: BrowseVideo) => void;
}

function videoDisplayTitle(video: BrowseVideo): string {
  if (video.title && video.title.trim()) return video.title;
  return video.provenance;
}

export function SillybusVideoNavigator({
  studentId,
  open,
  onOpenChange,
  onPick,
}: SillybusVideoNavigatorProps) {
  const [level, setLevel] = useState<NavLevel>({ kind: "sources" });
  const [parents, setParents] = useState<BrowseParent[]>([]);
  const [videos, setVideos] = useState<BrowseVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Reset state when sheet opens
  useEffect(() => {
    if (!open) return;
    setLevel({ kind: "sources" });
    setParents([]);
    setVideos([]);
    setError(null);
    setSearchInput("");
    setSearchQuery("");
  }, [open]);

  // Load data when level changes or search query changes
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (level.kind === "search" || searchQuery.trim()) {
          const result = await browseVideos({ studentId, q: searchQuery.trim() || undefined });
          if (cancelled) return;
          if (result.kind === "videos") {
            setVideos(result.videos);
            setParents([]);
          }
        } else if (level.kind === "parents") {
          const result = await browseVideos({ studentId, source: level.source });
          if (cancelled) return;
          if (result.kind === "parents") {
            setParents(result.parents);
            setVideos([]);
          }
        } else if (level.kind === "videos") {
          const result = await browseVideos({
            studentId,
            source: level.source,
            parentId: level.parent.id,
          });
          if (cancelled) return;
          if (result.kind === "videos") {
            setVideos(result.videos);
            setParents([]);
          }
        } else {
          // sources level: no fetch needed
          setLoading(false);
          return;
        }
      } catch {
        if (!cancelled) setError("Couldn't load videos. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, level, searchQuery, studentId]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      if (searchInput.trim()) {
        setLevel({ kind: "search", q: searchInput });
      } else if (level.kind === "search") {
        setLevel({ kind: "sources" });
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function goBack() {
    if (searchQuery) {
      setSearchInput("");
      setSearchQuery("");
      setLevel({ kind: "sources" });
      return;
    }
    if (level.kind === "videos") {
      setLevel({ kind: "parents", source: level.source });
    } else if (level.kind === "parents") {
      setLevel({ kind: "sources" });
    } else {
      setLevel({ kind: "sources" });
    }
  }

  function pickVideo(video: BrowseVideo) {
    onPick(video);
    onOpenChange(false);
  }

  const sourceItems: { source: Source; label: string; icon: React.ReactNode }[] = [
    {
      source: "library",
      label: "Global library",
      icon: <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    },
    {
      source: "camps",
      label: "Other camps",
      icon: <Tent className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    },
    {
      source: "syllabuses",
      label: "Syllabuses",
      icon: <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    },
  ];

  const showBack =
    level.kind !== "sources" || searchQuery.trim().length > 0;

  const sheetTitle = (() => {
    if (searchQuery.trim()) return "Search results";
    if (level.kind === "sources") return "Choose from Sillybus";
    if (level.kind === "parents") {
      const found = sourceItems.find((s) => s.source === level.source);
      return found?.label ?? "Choose from Sillybus";
    }
    if (level.kind === "videos") return level.parent.name;
    return "Choose from Sillybus";
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="px-4 pb-3 pt-4 text-left">
          <div className="flex items-center gap-2">
            {showBack && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={goBack}
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Button>
            )}
            <SheetTitle className="flex-1 text-base">{sheetTitle}</SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Browse your videos and pick one to link.
          </SheetDescription>
        </SheetHeader>

        {/* Search bar - always visible */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search videos…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 pb-6">
          {loading && (
            <div className="space-y-2 py-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="py-4 text-center text-sm text-destructive">{error}</p>
          )}

          {!loading && !error && level.kind === "sources" && !searchQuery && (
            <ul className="divide-y divide-border" role="list">
              {sourceItems.map(({ source, label, icon }) => (
                <li key={source}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-3 text-sm font-medium hover:text-foreground"
                    onClick={() => setLevel({ kind: "parents", source })}
                  >
                    {icon}
                    <span className="flex-1 text-left">{label}</span>
                    <span className="text-muted-foreground">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loading && !error && level.kind === "parents" && !searchQuery && (
            <>
              {parents.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No videos available.
                </p>
              )}
              <ul className="divide-y divide-border" role="list">
                {parents.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                      onClick={() => {
                        if (level.kind === "parents") {
                          setLevel({ kind: "videos", source: level.source, parent: p });
                        }
                      }}
                    >
                      <span className="flex-1 text-left font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.video_count} {p.video_count === 1 ? "video" : "videos"}
                      </span>
                      <span className="text-muted-foreground">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!loading && !error && (level.kind === "videos" || level.kind === "search") && (
            <>
              {videos.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {searchQuery ? "No videos match your search." : "No videos available."}
                </p>
              )}
              <ul className="divide-y divide-border" role="list">
                {videos.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 py-3 text-sm hover:text-foreground"
                      onClick={() => pickVideo(v)}
                    >
                      <VideoIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="flex-1 text-left">{videoDisplayTitle(v)}</span>
                      <span className="text-xs font-medium text-primary">Link</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
