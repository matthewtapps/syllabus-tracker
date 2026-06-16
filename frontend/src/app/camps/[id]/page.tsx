import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, Plus } from "lucide-react";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import type { CampTechnique, LibraryTechniqueRow } from "@/lib/api";
import { useCamp, useLibraryTechniques, useThreadsForAnchor } from "@/lib/queries";
import { useAddCampTechnique, useArchiveCamp, useCreateThread, useRemoveCampTechnique } from "@/lib/mutations";
import { useConfirm } from "@/components/confirm-context";
import { TechniqueRow } from "@/components/technique-row/technique-row";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { CampVideoList } from "@/components/videos/camp-video-list";
import { useListUrlState } from "@/lib/use-list-url-state";
import { cn } from "@/lib/utils";

/**
 * Adapt a CampTechnique into the LibraryTechniqueRow shape that TechniqueRow
 * expects. Tags and video_count come from the backend payload. Aggregates not
 * shown on the camp surface (collection_count, student_count) are zeroed.
 */
function toCampLibraryShape(t: CampTechnique): LibraryTechniqueRow {
  return {
    id: t.technique_id,
    name: t.name,
    description: t.description ?? "",
    tags: t.tags,
    collection_ids: [],
    collection_count: 0,
    student_count: 0,
    video_count: t.video_count,
    last_activity_at: null,
    is_pinned: false,
  };
}

function AddCampTechniqueDialog({
  open,
  onOpenChange,
  campId,
  existingTechniqueIds,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  campId: number;
  existingTechniqueIds: Set<number>;
}) {
  const libraryQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => (libraryQuery.data ?? []).filter((t) => !existingTechniqueIds.has(t.id)),
    [libraryQuery.data, existingTechniqueIds],
  );
  const addMutation = useAddCampTechnique(campId);
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
      setActiveTags([]);
    }
  }, [open]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    techniques.forEach((t) => t.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [techniques]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return techniques.filter((t) => {
      const matchesText =
        !needle ||
        t.name.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.name.toLowerCase().includes(needle));
      const matchesTags =
        activeTags.length === 0 ||
        activeTags.every((tag) => t.tags.some((x) => x.name === tag));
      return matchesText && matchesTags;
    });
  }, [techniques, search, activeTags]);

  const visibleSelectedCount = useMemo(
    () => filtered.filter((t) => selected.has(t.id)).length,
    [filtered, selected],
  );
  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.add(t.id));
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.delete(t.id));
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => addMutation.mutateAsync(id)));
      toast.success(
        ids.length === 1 ? "Added 1 technique" : `Added ${ids.length} techniques`,
      );
      onOpenChange(false);
    } catch {
      toast.error("Failed to add techniques. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] flex-col gap-3 sm:h-[80vh]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Add techniques</DialogTitle>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search techniques"
        />

        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => {
              const on = activeTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant={on ? "default" : "outline"}
                  className="cursor-pointer select-none"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              );
            })}
            {activeTags.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setActiveTags([])}
              >
                Clear
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{selected.size}</span>{" "}
            selected · {filtered.length} of {techniques.length} shown
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={filtered.length === 0}
            onClick={allVisibleSelected ? deselectAllVisible : selectAllVisible}
          >
            {allVisibleSelected ? "Deselect all visible" : "Select all visible"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {techniques.length === 0
                ? "Every library technique is already in this camp."
                : "No techniques match the current filters."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((t) => {
                const checked = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <label
                      htmlFor={`add-camp-tech-${t.id}`}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        id={`add-camp-tech-${t.id}`}
                        checked={checked}
                        onCheckedChange={() => toggle(t.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        {t.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.tags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={addMutation.isPending}
            className="w-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={selected.size === 0 || addMutation.isPending}
            className="w-full"
          >
            {addMutation.isPending
              ? "Adding..."
              : selected.size === 0
                ? "Add"
                : selected.size === 1
                  ? "Add 1 technique"
                  : `Add ${selected.size} techniques`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CampDetailPage() {
  const params = useParams<{ id: string }>();
  const campId = params.id ? parseInt(params.id, 10) : NaN;
  const viewer = useUser();

  if (!Number.isFinite(campId)) return <Navigate to="/dashboard" replace />;

  return <CampDetail campId={campId} viewerId={viewer.id} isCoach={isCoachOrAdmin(viewer)} />;
}

function CampDetail({
  campId,
  viewerId,
  isCoach,
}: {
  campId: number;
  viewerId: number;
  isCoach: boolean;
}) {
  // URL-backed focus state: opening/closing a row writes ?focus=technique:<id>
  // back to the URL, matching the library/syllabus pages. Deep-link IN (reading
  // ?focus on mount) still works because useListUrlState reads it on first render.
  const { focus, setFocus, videoId: urlVideoId } = useListUrlState();

  // ?video=<id> targets camp-level videos when ?focus is absent.
  // When ?focus=technique:<id>&video=<id> is present, the video is inside
  // a technique row and handled by TechniqueRow's scrollToVideoId.
  const focusVideoId = urlVideoId;
  const campVideoId = !focus && focusVideoId != null ? focusVideoId : null;

  // Derive accordion open value from the URL focus token.
  const openValue = focus?.type === "technique" ? `tech-${focus.id}` : "";

  function setOpenValue(value: string) {
    if (!value) {
      setFocus(null);
      return;
    }
    // accordion values are "tech-<id>"
    const id = Number(value.replace(/^tech-/, ""));
    if (Number.isFinite(id)) setFocus({ type: "technique", id });
  }

  const navigate = useNavigate();
  const confirm = useConfirm();

  const campQuery = useCamp(campId);
  const camp = campQuery.data;

  const threadsQuery = useThreadsForAnchor("camp", campId);
  const createThread = useCreateThread();
  const removeTechnique = useRemoveCampTechnique(campId);

  // studentId is stable once camp loads; the hook is curried for cache invalidation.
  // We pass 0 as a placeholder until camp loads — the button is hidden until then anyway.
  const archiveCamp = useArchiveCamp(camp?.student_id ?? 0);

  const [addPickerOpen, setAddPickerOpen] = useState(false);

  async function handleArchive() {
    const ok = await confirm({
      title: "Archive this camp?",
      description:
        "The camp stays referenceable but drops out of active views. This cannot be undone.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      await archiveCamp.mutateAsync(campId);
      toast.success("Camp archived.");
      navigate(`/student/${camp!.student_id}/camps`);
    } catch {
      toast.error("Failed to archive the camp. Please try again.");
    }
  }

  // Consumed flag: only scroll to the focus video once so re-opening a row
  // doesn't re-trigger the scroll.
  const [videoConsumed, setVideoConsumed] = useState(false);
  const [campVideoConsumed, setCampVideoConsumed] = useState(false);

  // B3: ?thread=<id> deep-link — scroll to and briefly highlight that thread.
  // Mirrors the logic in discussion-block.tsx for technique-row discussion tabs.
  const [searchParams, setSearchParams] = useSearchParams();
  const discussionListRef = useRef<HTMLDivElement>(null);
  const [highlightThreadId, setHighlightThreadId] = useState<number | null>(null);
  const threadFocusConsumed = useRef(false);
  const targetThreadId = (() => {
    const raw = searchParams.get("thread");
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);

  useEffect(() => {
    if (threadFocusConsumed.current || targetThreadId == null || threadsQuery.isLoading) return;
    if (!threads.some((t) => t.id === targetThreadId)) return;
    const el = discussionListRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${targetThreadId}"]`,
    );
    if (!el) return;
    threadFocusConsumed.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightThreadId(targetThreadId);
    const timer = setTimeout(() => setHighlightThreadId(null), 2200);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        return next;
      },
      { replace: true },
    );
    return () => clearTimeout(timer);
  }, [targetThreadId, threadsQuery.isLoading, threads, setSearchParams]);

  if (campQuery.isError) return <Navigate to="/dashboard" replace />;

  if (campQuery.isLoading || !camp) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const viewerIsOwner = viewerId === camp.student_id;
  if (!viewerIsOwner && !isCoach) return <Navigate to="/dashboard" replace />;

  async function startThread(body: string) {
    try {
      await createThread.mutateAsync({
        anchor_kind: "camp",
        anchor_id: campId,
        visibility: "private",
        scope_student_id: camp!.student_id,
        body,
      });
    } catch {
      toast.error("Couldn't post your thread.");
    }
  }

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 md:py-8">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-base font-semibold">{camp.name}</h1>
          {isCoach && !camp.archived_at && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={handleArchive}
              disabled={archiveCamp.isPending}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive camp
            </Button>
          )}
        </div>
        {camp.description && (
          <p className="text-sm text-muted-foreground">{camp.description}</p>
        )}
        {camp.archived_at && (
          <span className="text-xs text-muted-foreground">Archived</span>
        )}
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Techniques
          </h2>
          {isCoach && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setAddPickerOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add techniques
            </Button>
          )}
        </div>
        {isCoach && (
          <AddCampTechniqueDialog
            open={addPickerOpen}
            onOpenChange={setAddPickerOpen}
            campId={campId}
            existingTechniqueIds={
              new Set(camp.techniques.map((t) => t.technique_id))
            }
          />
        )}
        {camp.techniques.length === 0 ? (
          <p className="text-sm text-muted-foreground">No techniques yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Accordion
              type="single"
              collapsible
              value={openValue}
              onValueChange={setOpenValue}
            >
              {camp.techniques.map((t) => {
                const value = `tech-${t.technique_id}`;
                const isOpen = value === openValue;
                return (
                  <TechniqueRow
                    key={t.technique_id}
                    technique={toCampLibraryShape(t)}
                    context={{
                      kind: "camp",
                      campId,
                      studentId: camp.student_id,
                      onRemove: isCoach
                        ? () => removeTechnique.mutate(t.technique_id)
                        : undefined,
                    }}
                    value={value}
                    isOpen={isOpen}
                    scrollToVideoId={
                      isOpen && !videoConsumed && focusVideoId != null
                        ? focusVideoId
                        : null
                    }
                    onVideoScrolled={() => setVideoConsumed(true)}
                  />
                );
              })}
            </Accordion>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Videos
        </h2>
        <CampVideoList
          campId={campId}
          studentId={camp.student_id}
          canManage={isCoach}
          scrollToVideoId={campVideoConsumed ? null : campVideoId}
          onVideoScrolled={() => setCampVideoConsumed(true)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Discussion
        </h2>
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {threadsQuery.isLoading ? (
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          ) : threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discussion yet.</p>
          ) : (
            <div ref={discussionListRef} className="divide-y divide-border">
              {threads.map((t) => (
                <div
                  key={t.id}
                  data-thread-id={t.id}
                  className={cn(
                    "rounded-md py-4 transition-colors first:pt-0 last:pb-0",
                    highlightThreadId === t.id && "bg-muted/60 ring-2 ring-ring/50",
                  )}
                >
                  <ThreadView
                    thread={t}
                    anchorKind="camp"
                    anchorId={campId}
                  />
                </div>
              ))}
            </div>
          )}
          <ThreadComposer
            placeholder="Start a thread..."
            submitLabel="Post"
            pending={createThread.isPending}
            onSubmit={startThread}
          />
        </div>
      </section>
    </div>
  );
}
