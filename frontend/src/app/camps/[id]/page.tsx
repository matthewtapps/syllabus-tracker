import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  useCamp,
  useCampTechniques,
  useInfiniteCampComponents,
  useLibraryTechniques,
} from "@/lib/queries";
import {
  useArchiveCamp,
  useAttachCampTechniques,
  useCreateCampTechnique,
  useCreateThread,
} from "@/lib/mutations";
import { RenameCampDialog } from "@/components/camps/rename-camp-dialog";
import { CampSearchSheet } from "@/components/camps/camp-search-sheet";
import { useConfirm } from "@/components/confirm-context";
import { CampComposer } from "@/components/camps/camp-composer";
import { CampComponentList } from "@/components/camps/camp-component-list";
import { useCampAnchors, type CampAnchors } from "./use-camp-anchors";
import { cn } from "@/lib/utils";
import type { CampComponent } from "@/lib/api";
import type { VideoAttachment } from "@/components/threads/reply-composer";

// ---------------------------------------------------------------------------
// Pick-existing sub-panel
// ---------------------------------------------------------------------------

function PickExistingPanel({
  campId,
  onAttach,
  onDone,
}: {
  campId: number;
  /** Attaches each selected technique id to the camp. */
  onAttach: (techniqueIds: number[]) => Promise<void>;
  onDone: () => void;
}) {
  const attachedQuery = useCampTechniques(campId);
  const attached = useMemo(
    () => new Set((attachedQuery.data ?? []).map((t) => t.id)),
    [attachedQuery.data],
  );
  const libraryQuery = useLibraryTechniques();
  const techniques = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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

  const selectable = useMemo(
    () => filtered.filter((t) => !attached.has(t.id)),
    [filtered, attached],
  );
  const visibleSelectedCount = useMemo(
    () => selectable.filter((t) => selected.has(t.id)).length,
    [selectable, selected],
  );
  const allVisibleSelected =
    selectable.length > 0 && visibleSelectedCount === selectable.length;

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
      selectable.forEach((t) => next.add(t.id));
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      selectable.forEach((t) => next.delete(t.id));
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setPending(true);
    try {
      await onAttach(ids);
      toast.success(
        ids.length === 1 ? "Added 1 technique" : `Added ${ids.length} techniques`,
      );
      onDone();
    } catch {
      toast.error("Failed to add techniques. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
          disabled={selectable.length === 0}
          onClick={allVisibleSelected ? deselectAllVisible : selectAllVisible}
        >
          {allVisibleSelected ? "Deselect all visible" : "Select all visible"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-card">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {techniques.length === 0
              ? "No techniques in the library yet."
              : "No techniques match the current filters."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => {
              const inCamp = attached.has(t.id);
              const checked = inCamp || selected.has(t.id);
              return (
                <li key={t.id}>
                  <label
                    htmlFor={`add-camp-tech-${t.id}`}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2 transition-colors",
                      inCamp
                        ? "cursor-default opacity-60"
                        : "cursor-pointer hover:bg-muted/40",
                    )}
                  >
                    <Checkbox
                      id={`add-camp-tech-${t.id}`}
                      checked={checked}
                      disabled={inCamp}
                      onCheckedChange={() => toggle(t.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t.name}
                        {inCamp && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            In camp
                          </span>
                        )}
                      </p>
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
          onClick={onDone}
          disabled={pending}
          className="w-full"
        >
          Cancel
        </Button>
        <Button
          onClick={handleAdd}
          disabled={selected.size === 0 || pending}
          className="w-full"
        >
          {pending
            ? "Adding..."
            : selected.size === 0
              ? "Add"
              : selected.size === 1
                ? "Add 1 technique"
                : `Add ${selected.size} techniques`}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-new sub-panel (coach-only)
// ---------------------------------------------------------------------------

function ScopeOption({
  value,
  selected,
  onSelect,
  label,
  description,
}: {
  value: "global" | "scoped";
  selected: boolean;
  onSelect: (v: "global" | "scoped") => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <p className="text-sm font-medium leading-tight">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

function CreateNewPanel({
  campId,
  onAttach,
  onDone,
}: {
  campId: number;
  /** Attaches the newly-created technique to the camp. */
  onAttach: (techniqueIds: number[]) => Promise<void>;
  onDone: () => void;
}) {
  const createMutation = useCreateCampTechnique(campId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"global" | "scoped" | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);

  async function handleCreate() {
    setNameError(null);
    setScopeError(null);
    let hasError = false;
    if (!name.trim()) {
      setNameError("Name is required.");
      hasError = true;
    }
    if (!scope) {
      setScopeError("Please choose where this technique should appear.");
      hasError = true;
    }
    if (hasError || !scope) return;

    let techniqueId: number;
    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        scope,
      });
      techniqueId = result.id;
    } catch {
      toast.error("Failed to create technique. Please try again.");
      return;
    }
    try {
      await onAttach([techniqueId]);
      toast.success("Technique created and added to camp.");
      onDone();
    } catch {
      toast.error(
        "Technique created, but couldn't add it to the camp. Try attaching it from Pick existing.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <label htmlFor="new-tech-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="new-tech-name"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(null); }}
          placeholder="e.g. Single leg X guard entry"
          aria-invalid={nameError != null}
        />
        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>

      <div className="space-y-1">
        <label htmlFor="new-tech-desc" className="text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="new-tech-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes or focus points for this technique"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Where should this technique appear?</p>
        <div
          role="radiogroup"
          aria-label="Technique scope"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <ScopeOption
            value="global"
            selected={scope === "global"}
            onSelect={setScope}
            label="Add to global library"
            description="Visible to all students and coaches, and can be assigned from the library."
          />
          <ScopeOption
            value="scoped"
            selected={scope === "scoped"}
            onSelect={setScope}
            label="Only this camp"
            description="Visible only inside this camp. Does not appear in the global library."
          />
        </div>
        {scopeError && <p className="text-xs text-destructive">{scopeError}</p>}
      </div>

      <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={createMutation.isPending}
          className="w-full"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="w-full"
        >
          {createMutation.isPending ? "Creating..." : "Create technique"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined technique picker dialog
// ---------------------------------------------------------------------------

function AddCampTechniqueDialog({
  open,
  onOpenChange,
  campId,
  isCoach,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  campId: number;
  isCoach: boolean;
  /** Attaches each selected technique id to the camp. */
  onAttach: (techniqueIds: number[]) => Promise<void>;
}) {
  const [tab, setTab] = useState<"pick" | "create">("pick");

  useEffect(() => {
    if (!open) setTab("pick");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] flex-col gap-3 sm:h-[80vh]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Attach technique</DialogTitle>
        </DialogHeader>

        {isCoach ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "pick" | "create")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="w-full">
              <TabsTrigger value="pick" className="flex-1">Pick existing</TabsTrigger>
              <TabsTrigger value="create" className="flex-1">Create new</TabsTrigger>
            </TabsList>

            <TabsContent value="pick" className="mt-3 flex min-h-0 flex-1 flex-col">
              <PickExistingPanel
                campId={campId}
                onAttach={onAttach}
                onDone={() => onOpenChange(false)}
              />
            </TabsContent>

            <TabsContent value="create" className="mt-3">
              <CreateNewPanel
                campId={campId}
                onAttach={onAttach}
                onDone={() => onOpenChange(false)}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <PickExistingPanel
              campId={campId}
              onAttach={onAttach}
              onDone={() => onOpenChange(false)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Component body
// ---------------------------------------------------------------------------

function CampComponentsBody({
  campId,
  studentId,
  listRef,
  components,
  isLoading,
  anchors,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: {
  campId: number;
  studentId: number;
  listRef: React.RefObject<HTMLDivElement | null>;
  components: CampComponent[];
  isLoading: boolean;
  anchors: CampAnchors;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div ref={listRef}>
      <CampComponentList
        campId={campId}
        studentId={studentId}
        components={components}
        isLoading={isLoading}
        highlightKey={anchors.highlightKey}
        anchorKey={anchors.anchorKey}
        videoId={anchors.videoId}
        resumeSeconds={anchors.resumeSeconds}
        isFetchingNextPage={isFetchingNextPage}
      />
      <div ref={sentinelRef} className="h-px" aria-hidden />
      {!hasNextPage && components.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          You're all caught up.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

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
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const campQuery = useCamp(campId);
  const camp = campQuery.data;

  const componentsQuery = useInfiniteCampComponents(campId);
  const components = useMemo(
    () => componentsQuery.data?.pages.flatMap((page) => page.components) ?? [],
    [componentsQuery.data],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const anchors = useCampAnchors(components, componentsQuery.isLoading, listRef);

  const createThread = useCreateThread();
  const attachTechniques = useAttachCampTechniques(campId);
  const archiveCamp = useArchiveCamp(camp?.student_id ?? 0);

  async function attachToCamp(techniqueIds: number[]) {
    await attachTechniques.mutateAsync(techniqueIds);
  }

  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  function invalidateCampComponents() {
    qc.invalidateQueries({ queryKey: qk.campComponentsAll(campId) });
  }

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

  async function startThread(body: string, attachment: VideoAttachment | null) {
    await createThread.mutateAsync({
      anchor_kind: "camp",
      anchor_id: campId,
      visibility: "private",
      scope_student_id: camp!.student_id,
      body,
      attached_video_id: attachment?.videoId ?? null,
      attached_video_is_reference: attachment?.isReference ?? null,
      attached_video_title: attachment?.title ?? null,
    });
    invalidateCampComponents();
  }

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

  return (
    <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6 md:py-8">
      {/* Camp header */}
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-base font-semibold">{camp.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label="Search camp"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
            </Button>
            {isCoach && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setRenameOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename
                </Button>
                {!camp.archived_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={handleArchive}
                    disabled={archiveCamp.isPending}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive camp
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        {camp.description && (
          <p className="text-sm text-muted-foreground">{camp.description}</p>
        )}
        {camp.archived_at && (
          <span className="text-xs text-muted-foreground">Archived</span>
        )}
      </header>

      {isCoach && (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <RenameCampDialog
            campId={campId}
            studentId={camp.student_id}
            currentName={camp.name}
            currentDescription={camp.description}
            onRenamed={() => setRenameOpen(false)}
          />
        </Dialog>
      )}

      {/* Unified composer pinned at the top */}
      {(viewerIsOwner || isCoach) && (
        <CampComposer
          campId={campId}
          studentId={camp.student_id}
          onSubmit={startThread}
          pending={createThread.isPending}
          onOpenTechniquePicker={() => setAddPickerOpen(true)}
        />
      )}

      {/* Technique picker dialog (triggered from composer) */}
      <AddCampTechniqueDialog
        open={addPickerOpen}
        onOpenChange={setAddPickerOpen}
        campId={campId}
        isCoach={isCoach}
        onAttach={attachToCamp}
      />

      {/* Camp search sheet */}
      <CampSearchSheet
        campId={campId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onJump={anchors.jumpToThread}
        onJumpVideo={anchors.jumpToVideo}
      />

      {/* The camp's content, newest touch first */}
      <CampComponentsBody
        campId={campId}
        studentId={camp.student_id}
        listRef={listRef}
        components={components}
        isLoading={componentsQuery.isLoading}
        anchors={anchors}
        fetchNextPage={componentsQuery.fetchNextPage}
        hasNextPage={componentsQuery.hasNextPage}
        isFetchingNextPage={componentsQuery.isFetchingNextPage}
      />
    </div>
  );
}
