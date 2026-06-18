import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ExternalLink, GitBranch, Plus, Trophy, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFormWithValidation } from "@/components/hooks/useFormErrors";
import { TracedForm } from "@/components/traced-form";
import { useUser } from "@/lib/current-user-context";
import { isCoachOrAdmin } from "@/lib/api";
import type { CampTechnique, LibraryTechniqueRow, Match, MatchResult, MatchMethod, Video } from "@/lib/api";
import { uploadMatchVideo } from "@/lib/api";
import {
  useCamp,
  useCompetitions,
  useLibraryTechniques,
  useMatchTechniques,
  useMatchVideos,
  useRegistrationMatches,
  useThreadsForAnchor,
} from "@/lib/queries";
import {
  useAddCampTechnique,
  useArchiveCamp,
  useCreateCampTechnique,
  useCreateThread,
  useDeleteMatch,
  useLinkMatchTechnique,
  useLogMatch,
  usePromoteCampToCompetition,
  useRemoveCampTechnique,
  useUnlinkMatchTechnique,
} from "@/lib/mutations";
import { qk } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@/components/confirm-context";
import { TechniqueRow } from "@/components/technique-row/technique-row";
import { ThreadView } from "@/components/threads/thread-view";
import { ThreadComposer } from "@/components/threads/thread-composer";
import { CampVideoList } from "@/components/videos/camp-video-list";
import { VideoRow } from "@/components/videos/video-row";
import { VideoPlayerDialog } from "@/components/videos/video-player-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { FileVideoIcon, VideoIcon } from "lucide-react";
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS, formatBytes } from "@/components/videos/limits";
import { useListUrlState } from "@/lib/use-list-url-state";
import { cn } from "@/lib/utils";
import { PullFromPrevious } from "@/components/camps/pull-from-previous";

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

// ---------------------------------------------------------------------------
// Pick-existing sub-panel (original behaviour)
// ---------------------------------------------------------------------------

function PickExistingPanel({
  campId,
  existingTechniqueIds,
  onDone,
}: {
  campId: number;
  existingTechniqueIds: Set<number>;
  onDone: () => void;
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
      onDone();
    } catch {
      toast.error("Failed to add techniques. Please try again.");
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
          onClick={onDone}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-new sub-panel (CC-009/010)
// ---------------------------------------------------------------------------

/**
 * Scope option displayed as a selectable card. No default is pre-selected so
 * the coach must make an explicit choice (per the CC-010 concept doc).
 */
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
  onDone,
}: {
  campId: number;
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

    try {
      await createMutation.mutateAsync({ name: name.trim(), description: description.trim(), scope });
      toast.success("Technique created and added to camp.");
      onDone();
    } catch {
      toast.error("Failed to create technique. Please try again.");
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
// Combined dialog: tab between "Pick existing" and "Create new"
// ---------------------------------------------------------------------------

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
          <DialogTitle>Add technique</DialogTitle>
        </DialogHeader>

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
              existingTechniqueIds={existingTechniqueIds}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="create" className="mt-3">
            <CreateNewPanel
              campId={campId}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Promote-to-competition dialog
// ---------------------------------------------------------------------------

function PromoteDialog({
  open,
  onOpenChange,
  campId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  campId: number;
}) {
  const competitionsQuery = useCompetitions();
  const competitions = competitionsQuery.data ?? [];
  const promote = usePromoteCampToCompetition(campId);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!open) setSelectedId("");
  }, [open]);

  async function handleLink() {
    if (!selectedId) return;
    try {
      await promote.mutateAsync(Number(selectedId));
      toast.success("Camp linked to competition.");
      onOpenChange(false);
    } catch {
      toast.error("Failed to link competition. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Link to competition</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pick an existing competition to associate with this camp. You can create
          competitions from the{" "}
          <Link to="/competitions" className="underline underline-offset-2">
            Competitions page
          </Link>
          .
        </p>
        {competitionsQuery.isLoading ? (
          <div className="h-9 animate-pulse rounded bg-muted" />
        ) : competitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No competitions yet.</p>
        ) : (
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a competition" />
            </SelectTrigger>
            <SelectContent>
              {competitions.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  {c.date ? ` (${c.date})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={promote.isPending}
            className="w-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={!selectedId || promote.isPending || competitions.length === 0}
            className="w-full"
          >
            {promote.isPending ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Log-match dialog
// ---------------------------------------------------------------------------

const logMatchSchema = z.object({
  result: z.enum(["win", "loss", "draw"]),
  method: z.enum(["none", "submission", "points", "decision", "dq", "other"]).optional(),
  method_detail: z.string().max(200).optional(),
  occurred_at: z.string().optional(),
});
type LogMatchValues = z.infer<typeof logMatchSchema>;

function LogMatchDialog({
  open,
  onOpenChange,
  registrationId,
  campStudentId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  registrationId: number;
  campStudentId: number;
}) {
  const logMatch = useLogMatch(registrationId);

  const form = useFormWithValidation<LogMatchValues>({
    resolver: zodResolver(logMatchSchema),
    defaultValues: { result: "win", method: "none", method_detail: "", occurred_at: "" },
  });

  useEffect(() => {
    if (!open) {
      form.reset({ result: "win", method: "none", method_detail: "", occurred_at: "" });
    }
  }, [open, form]);

  async function handleSubmit(values: LogMatchValues) {
    try {
      await logMatch.mutateAsync({
        result: values.result as MatchResult,
        method: (values.method && values.method !== "none" ? values.method : null) as MatchMethod | null,
        method_detail: values.method_detail?.trim() || null,
        occurred_at: values.occurred_at?.trim() || null,
      });
      toast.success("Match added.");
      onOpenChange(false);
    } catch {
      toast.error("Failed to log match. Please try again.");
    }
  }

  // campStudentId is used for authz context; the component renders only for
  // coach or the camp's own student, so no further gate needed here.
  void campStudentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add match</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <TracedForm
            id="log_match"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="result"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Result</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="win">Win</SelectItem>
                        <SelectItem value="loss">Loss</SelectItem>
                        <SelectItem value="draw">Draw</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method (optional)</FormLabel>
                  <FormControl>
                    <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="submission">Submission</SelectItem>
                        <SelectItem value="points">Points</SelectItem>
                        <SelectItem value="decision">Decision</SelectItem>
                        <SelectItem value="dq">DQ</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method_detail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method detail (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. rear naked choke" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="occurred_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-none sm:justify-stretch">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={logMatch.isPending}
                className="w-full"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={logMatch.isPending} className="w-full">
                {logMatch.isPending ? "Adding..." : "Add"}
              </Button>
            </DialogFooter>
          </TracedForm>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Result badge
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: MatchResult }) {
  const map: Record<MatchResult, { label: string; cls: string }> = {
    win: { label: "W", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    loss: { label: "L", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
    draw: { label: "D", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  };
  const { label, cls } = map[result];
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
        cls,
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Match video upload sheet (reuses the same pattern as CampUploadSheet)
// ---------------------------------------------------------------------------

const matchUploadSchema = z.object({
  title: z.string().min(1, "Title is required").max(120, "Title is too long"),
});
type MatchUploadValues = z.infer<typeof matchUploadSchema>;

function MatchUploadSheet({
  matchId,
  open,
  onOpenChange,
  onUploaded,
}: {
  matchId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const form = useFormWithValidation<MatchUploadValues>({
    resolver: zodResolver(matchUploadSchema),
    defaultValues: { title: "" },
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setFileError(null);
      setProgressPct(null);
      form.reset({ title: "" });
    }
  }, [open, form]);

  function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) { setFile(null); return; }
    if (picked.type && picked.type !== "video/mp4") {
      setFileError("Only mp4 files are supported.");
      setFile(null);
      return;
    }
    if (picked.size > MAX_VIDEO_BYTES) {
      setFileError(`File is ${formatBytes(picked.size)}; max is ${formatBytes(MAX_VIDEO_BYTES)}.`);
      setFile(null);
      return;
    }
    setFile(picked);
  }

  async function handleSubmit(values: MatchUploadValues) {
    if (!file) { setFileError("Pick an mp4 file to upload."); return; }
    setProgressPct(0);
    try {
      await uploadMatchVideo(
        matchId,
        file,
        { title: values.title.trim() },
        (loaded, total) => {
          if (total > 0) setProgressPct(Math.round((loaded / total) * 100));
        },
      );
      qc.invalidateQueries({ queryKey: qk.matchVideos(matchId) });
      toast.success("Upload received. Processing now...");
      onUploaded();
    } catch (err) {
      setProgressPct(null);
      toast.error(err instanceof Error ? err.message : "Failed to upload video");
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
      >
        <SheetHeader className="space-y-1 p-0 text-left">
          <SheetTitle>Add match video</SheetTitle>
          <SheetDescription>Upload an mp4 clip for this match.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <TracedForm
            id="match_video_upload"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <input
                ref={galleryRef}
                type="file"
                accept="video/mp4"
                className="sr-only"
                onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                disabled={isSubmitting}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="video/mp4"
                capture="environment"
                className="sr-only"
                onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                disabled={isSubmitting}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => galleryRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <FileVideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
                  Choose video
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => cameraRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <VideoIcon className="mr-1.5 h-4 w-4" aria-hidden />
                  Record video
                </Button>
              </div>
              {file ? (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {formatBytes(file.size)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  mp4 only, up to {MAX_VIDEO_DURATION_SECONDS / 60} minutes and{" "}
                  {formatBytes(MAX_VIDEO_BYTES)}.
                </p>
              )}
              {fileError && (
                <p className="text-sm font-medium text-destructive">{fileError}</p>
              )}
            </div>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Match 1 footage" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {progressPct !== null && (
              <div className="space-y-1">
                <Progress value={progressPct} />
                <p className="text-xs text-muted-foreground">Uploading... {progressPct}%</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !file}>
                {isSubmitting ? "Uploading..." : "Upload video"}
              </Button>
            </div>
          </TracedForm>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Match card
// ---------------------------------------------------------------------------

function MatchCard({
  match,
  registrationId,
  campStudentId,
  campTechniques,
  isCoach,
  viewerIsOwner,
}: {
  match: Match;
  registrationId: number;
  campStudentId: number;
  campTechniques: CampTechnique[];
  isCoach: boolean;
  viewerIsOwner: boolean;
}) {
  const confirm = useConfirm();
  const deleteMatch = useDeleteMatch();
  const linkTech = useLinkMatchTechnique(match.id);
  const unlinkTech = useUnlinkMatchTechnique(match.id);
  const matchTechsQuery = useMatchTechniques(match.id);
  const matchTechs = matchTechsQuery.data ?? [];
  const videosQuery = useMatchVideos(match.id);
  const videos = videosQuery.data ?? [];

  const [uploadOpen, setUploadOpen] = useState(false);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [showTechPicker, setShowTechPicker] = useState(false);

  const canManage = isCoach || viewerIsOwner;

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this match?",
      description: "This removes the match and all its videos. This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMatch.mutateAsync({
        matchId: match.id,
        registrationId,
        studentId: campStudentId,
      });
      toast.success("Match deleted.");
    } catch {
      toast.error("Failed to delete match.");
    }
  }

  const methodLabel: Record<string, string> = {
    submission: "Sub",
    points: "Points",
    decision: "Decision",
    dq: "DQ",
    other: "Other",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ResultBadge result={match.result} />
          {match.method && (
            <span className="text-xs text-muted-foreground">
              {methodLabel[match.method] ?? match.method}
              {match.method_detail ? ` (${match.method_detail})` : ""}
            </span>
          )}
          {match.occurred_at && (
            <span className="text-xs text-muted-foreground">{match.occurred_at}</span>
          )}
        </div>
        {isCoach && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteMatch.isPending}
            aria-label="Delete match"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Videos */}
      {videos.length > 0 && (
        <ul className="divide-y divide-white/15 overflow-hidden rounded-md border border-white/20 bg-card shadow-sm">
          {videos.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              techniqueId={0}
              canManage={canManage}
              onPlay={() => setPlaying(v)}
              onDeleted={() => {
                videosQuery.refetch();
              }}
            />
          ))}
        </ul>
      )}

      {canManage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setUploadOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add video
        </Button>
      )}

      {/* Linked techniques (coach only) */}
      {isCoach && (
        <div className="space-y-1.5">
          {matchTechs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {matchTechs.map((t) => (
                <Badge
                  key={t.technique_id}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs"
                >
                  {t.name}
                  <button
                    type="button"
                    aria-label={`Unlink ${t.name}`}
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    onClick={() =>
                      unlinkTech.mutate(t.technique_id, {
                        onError: () => toast.error("Failed to unlink technique."),
                      })
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {showTechPicker ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Link a camp technique to this match:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {campTechniques
                  .filter((ct) => !matchTechs.some((mt) => mt.technique_id === ct.technique_id))
                  .map((ct) => (
                    <Button
                      key={ct.technique_id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() =>
                        linkTech.mutate(ct.technique_id, {
                          onError: () => toast.error("Failed to link technique."),
                        })
                      }
                      disabled={linkTech.isPending}
                    >
                      {ct.name}
                    </Button>
                  ))}
                {campTechniques.filter(
                  (ct) => !matchTechs.some((mt) => mt.technique_id === ct.technique_id),
                ).length === 0 && (
                  <p className="text-xs text-muted-foreground">All camp techniques linked.</p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setShowTechPicker(false)}
              >
                Done
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowTechPicker(true)}
            >
              Link techniques
            </Button>
          )}
        </div>
      )}

      <MatchUploadSheet
        matchId={match.id}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => setUploadOpen(false)}
      />

      <VideoPlayerDialog
        video={playing}
        onClose={() => setPlaying(null)}
        surface={{ kind: "student", studentId: campStudentId }}
        context={{ label: "Match video" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matches section
// ---------------------------------------------------------------------------

function MatchesSection({
  registrationId,
  campStudentId,
  campTechniques,
  isCoach,
  viewerIsOwner,
}: {
  registrationId: number;
  campStudentId: number;
  campTechniques: CampTechnique[];
  isCoach: boolean;
  viewerIsOwner: boolean;
}) {
  const matchesQuery = useRegistrationMatches(registrationId);
  const matches = matchesQuery.data ?? [];
  const [logOpen, setLogOpen] = useState(false);

  const canLog = isCoach || viewerIsOwner;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Matches
        </h2>
        {canLog && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setLogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            match
          </Button>
        )}
      </div>

      {matchesQuery.isLoading ? (
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches logged yet.</p>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              registrationId={registrationId}
              campStudentId={campStudentId}
              campTechniques={campTechniques}
              isCoach={isCoach}
              viewerIsOwner={viewerIsOwner}
            />
          ))}
        </div>
      )}

      <LogMatchDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        registrationId={registrationId}
        campStudentId={campStudentId}
      />
    </section>
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
  const [promoteOpen, setPromoteOpen] = useState(false);

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

      {/* Competition section */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Competition
        </h2>
        {camp.competition_id != null ? (
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" />
            <Link
              to={`/competitions/${camp.competition_id}`}
              className="text-sm font-medium hover:underline underline-offset-2 flex items-center gap-1"
            >
              {camp.competition_name ?? `Competition #${camp.competition_id}`}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Link>
          </div>
        ) : isCoach ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setPromoteOpen(true)}
          >
            <Trophy className="h-3.5 w-3.5" />
            Link to competition
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Not linked to a competition.</p>
        )}
      </section>

      {/* Builds-on section (only when this camp references a prior one) */}
      {camp.references_camp_id != null && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Builds on
          </h2>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <Link
              to={`/camps/${camp.references_camp_id}`}
              className="text-sm font-medium hover:underline underline-offset-2 flex items-center gap-1"
            >
              {camp.references_camp_name ?? `Camp #${camp.references_camp_id}`}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Link>
          </div>
        </section>
      )}

      {/* Techniques section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Techniques
          </h2>
          {isCoach && (
            <div className="flex items-center gap-2">
              <PullFromPrevious
                currentCampId={campId}
                studentId={camp.student_id}
                referencesCampId={camp.references_camp_id}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setAddPickerOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add techniques
              </Button>
            </div>
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

      {/* Matches section (only when linked to a comp with a known registration) */}
      {camp.competition_id != null && camp.registration_id != null && (
        <MatchesSection
          registrationId={camp.registration_id}
          campStudentId={camp.student_id}
          campTechniques={camp.techniques}
          isCoach={isCoach}
          viewerIsOwner={viewerIsOwner}
        />
      )}

      {/* Camp-level videos */}
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

      <PromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        campId={campId}
      />
    </div>
  );
}
