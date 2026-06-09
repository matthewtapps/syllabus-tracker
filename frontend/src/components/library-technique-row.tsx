import { useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  PlayIcon,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { TracedForm } from '@/components/traced-form';
import {
  handleApiFormError,
  useFormWithValidation,
} from '@/components/hooks/useFormErrors';
import { AddVideoButton } from '@/components/videos/add-video-button';
import { VideoList } from '@/components/videos/video-list';
import { TagsEditor } from '@/app/student-techniques/components/tags-editor';
import {
  useAllTags,
  useLibraryTechniqueStats,
  useStudentPins,
} from '@/lib/queries';
import {
  usePinTechnique,
  useRemoveTagFromTechnique,
  useUnpinTechnique,
  useUpdateLibraryTechnique,
} from '@/lib/mutations';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type {
  LibraryTechniqueRow as LibraryTechniqueRowData,
  LibraryTechniqueStats,
  Tag,
  User,
} from '@/lib/api';
import { X as XIcon } from 'lucide-react';

/// Single expandable technique row used across the library, the Pinned tab,
/// and any other "list of techniques" surface that wants a consistent
/// expand-in-place feel. Context-specific info (pin button for students,
/// stats / syllabuses for coaches, etc.) layers as sections inside the
/// expanded body. The collapsed header morphs into the expanded body
/// instead of acting as a static dropdown trigger above the body.
export interface LibraryTechniqueRowProps {
  technique: LibraryTechniqueRowData;
  expanded: boolean;
  onToggle: () => void;
  user: User;
  /** Coach / admin: gets editing affordances + stats. */
  canEdit: boolean;
  /** Show "pinned · syllabus name" badges in the header chrome. */
  badges?: React.ReactNode;
  /** ID attribute on the outer <li>, for deep-link scroll-into-view. */
  rowId?: string;
  /** Video id to scroll into view once the video list mounts. */
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

export function LibraryTechniqueRow({
  technique,
  expanded,
  onToggle,
  user,
  canEdit,
  badges,
  rowId,
  scrollToVideoId,
  onVideoScrolled,
}: LibraryTechniqueRowProps) {
  const isStudentLike =
    user.role === 'student' || user.role === 'footage_submitter_student';

  return (
    <li
      id={rowId}
      className="border-l-4 border-l-transparent transition-colors data-[expanded=true]:border-l-primary data-[expanded=true]:bg-muted/20"
      data-expanded={expanded}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium leading-snug">
            {technique.name}
          </p>
          {!expanded && (
            <>
              <CollapsedMeta row={technique} />
              {technique.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {technique.tags.map((tag) => (
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
              {badges && <div className="flex flex-wrap gap-1 pt-0.5">{badges}</div>}
            </>
          )}
        </div>
        {expanded ? (
          <ChevronUpIcon
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronDownIcon
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
      </button>

      {expanded && (
        <ExpandedBody
          technique={technique}
          canEdit={canEdit}
          isStudentLike={isStudentLike}
          userId={user.id}
          badges={badges}
          scrollToVideoId={scrollToVideoId}
          onVideoScrolled={onVideoScrolled}
        />
      )}
    </li>
  );
}

function CollapsedMeta({ row }: { row: LibraryTechniqueRowData }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-xs text-muted-foreground">
      <Users className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.student_count}</span>
      <span aria-hidden>·</span>
      <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.syllabus_count}</span>
      <span aria-hidden>·</span>
      <PlayIcon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.video_count}</span>
    </span>
  );
}

export interface LibraryTechniqueExpandedBodyProps {
  technique: LibraryTechniqueRowData;
  canEdit: boolean;
  isStudentLike: boolean;
  userId: number;
  badges?: React.ReactNode;
  scrollToVideoId?: number | null;
  onVideoScrolled?: () => void;
}

/// The shared expanded-body of a library-technique row. Library + Pins use
/// it directly via `LibraryTechniqueRow`; the activity feed composes it inside
/// `ActivityFeedItem` so feed cards expand to show the full technique
/// context (description, tags, pin, videos) without leaving the feed.
export function LibraryTechniqueExpandedBody(
  props: LibraryTechniqueExpandedBodyProps,
) {
  return <ExpandedBody {...props} />;
}

function ExpandedBody({
  technique,
  canEdit,
  isStudentLike,
  userId,
  badges,
  scrollToVideoId,
  onVideoScrolled,
}: LibraryTechniqueExpandedBodyProps) {
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const statsQuery = useLibraryTechniqueStats(technique.id, canEdit);
  const stats = statsQuery.data ?? null;

  return (
    <div className="space-y-5 px-4 pb-5">
      {badges && (
        <div className="flex flex-wrap gap-1.5 -mt-1">{badges}</div>
      )}

      {editing && canEdit ? (
        <NameDescriptionEditor
          technique={technique}
          onDone={() => setEditing(false)}
        />
      ) : (
        <DescriptionBlock
          technique={technique}
          onEdit={canEdit ? () => setEditing(true) : undefined}
        />
      )}

      <TagsRow technique={technique} canEdit={canEdit} />

      {isStudentLike && (
        <PinSection studentId={userId} techniqueId={technique.id} />
      )}

      {canEdit && <SyllabusesRow stats={stats} />}

      {canEdit && <StatsStrip stats={stats} loading={statsQuery.isLoading} />}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Videos
            </h3>
            {canEdit && (
              <p className="text-[11px] text-muted-foreground">
                Order applies to every student.
              </p>
            )}
          </div>
          {canEdit && (
            <AddVideoButton
              techniqueId={technique.id}
              onAdded={() => setReloadKey((k) => k + 1)}
            />
          )}
        </div>
        <VideoList
          techniqueId={technique.id}
          canManage={canEdit}
          reloadKey={reloadKey}
          scrollToVideoId={scrollToVideoId}
          onVideoScrolled={onVideoScrolled}
          ctx="library"
        />
      </section>
    </div>
  );
}

function DescriptionBlock({
  technique,
  onEdit,
}: {
  technique: LibraryTechniqueRowData;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {technique.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {technique.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No description yet.
          </p>
        )}
      </div>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Edit name and description</span>
        </Button>
      )}
    </div>
  );
}

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name is too long'),
  description: z.string().min(1, 'Description is required'),
});
type EditValues = z.infer<typeof editSchema>;

function NameDescriptionEditor({
  technique,
  onDone,
}: {
  technique: LibraryTechniqueRowData;
  onDone: () => void;
}) {
  const updateMutation = useUpdateLibraryTechnique();
  const form = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: technique.name, description: technique.description },
  });

  async function handleSubmit(values: EditValues) {
    try {
      await updateMutation.mutateAsync({
        techniqueId: technique.id,
        data: values,
      });
      toast.success('Saved');
      onDone();
    } catch (err) {
      const handled = await handleApiFormError(
        err,
        form.setError,
        Object.keys(form.getValues()),
      );
      if (!handled) toast.error('Failed to save');
    }
  }

  return (
    <Form {...form}>
      <TracedForm
        id="edit_library_technique"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-3"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input {...field} placeholder="Technique name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea {...field} placeholder="Description" className="min-h-24" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}

function TagsRow({
  technique,
  canEdit,
}: {
  technique: LibraryTechniqueRowData;
  canEdit: boolean;
}) {
  const removeTagMutation = useRemoveTagFromTechnique();
  const allTagsQuery = useAllTags();
  const allTags = allTagsQuery.data ?? [];

  // Optimistic local list so add / remove feels instant.
  const [localTags, setLocalTags] = useState<Tag[]>(technique.tags);

  async function handleRemoveTag(tag: Tag) {
    setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));
    try {
      await removeTagMutation.mutateAsync({
        techniqueId: technique.id,
        tagId: tag.id,
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove tag');
      setLocalTags((prev) =>
        [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
  }

  function handleTagAdded(tag: Tag) {
    setLocalTags((prev) =>
      [...prev.filter((t) => t.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tags
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {localTags.length === 0 && !canEdit && (
          <p className="text-xs italic text-muted-foreground">No tags yet.</p>
        )}
        {localTags.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1 pr-1 text-xs"
          >
            {tag.name}
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => handleRemoveTag(tag)}
              >
                <XIcon className="h-3 w-3" aria-hidden />
                <span className="sr-only">Remove {tag.name}</span>
              </Button>
            )}
          </Badge>
        ))}
        {canEdit && (
          <TagsEditor
            techniqueId={technique.id}
            assignedTags={localTags}
            allTags={allTags}
            onTagAdded={handleTagAdded}
          />
        )}
      </div>
    </section>
  );
}

function PinSection({
  studentId,
  techniqueId,
}: {
  studentId: number;
  techniqueId: number;
}) {
  const pinsQuery = useStudentPins(studentId);
  const isPinned = (pinsQuery.data ?? []).some(
    (p) => p.technique_id === techniqueId,
  );
  const pinMutation = usePinTechnique();
  const unpinMutation = useUnpinTechnique();
  const busy = pinMutation.isPending || unpinMutation.isPending;

  return (
    <section className="flex items-center gap-3">
      <Button
        type="button"
        variant={isPinned ? 'secondary' : 'outline'}
        size="sm"
        className="gap-2"
        disabled={busy || pinsQuery.isLoading}
        onClick={() => {
          if (isPinned) {
            unpinMutation.mutate(
              { studentId, techniqueId },
              {
                onSuccess: () => toast.success('Unpinned'),
                onError: () => toast.error('Failed to unpin'),
              },
            );
          } else {
            pinMutation.mutate(
              { studentId, techniqueId },
              {
                onSuccess: () => toast.success('Pinned to your working list'),
                onError: () => toast.error('Failed to pin'),
              },
            );
          }
        }}
      >
        {isPinned ? (
          <>
            <PinOff className="h-4 w-4" aria-hidden /> Unpin
          </>
        ) : (
          <>
            <Pin className="h-4 w-4" aria-hidden /> Pin to working list
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        {isPinned
          ? 'On your Pinned tab.'
          : 'Adds this technique to your Pinned tab without making it part of a syllabus.'}
      </p>
    </section>
  );
}

function SyllabusesRow({ stats }: { stats: LibraryTechniqueStats | null }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Syllabuses
      </h3>
      {stats === null ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : stats.syllabuses.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          Not in any syllabus yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stats.syllabuses.map((s) => (
            <Badge key={s.id} variant="outline">
              <FolderOpen className="mr-1 h-3 w-3" aria-hidden />
              {s.name}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

function StatsStrip({
  stats,
  loading,
}: {
  stats: LibraryTechniqueStats | null;
  loading: boolean;
}) {
  if (loading && !stats) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </section>
    );
  }
  if (!stats) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Activity
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-status-red" />
          {stats.status_counts.red}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-status-amber" />
          {stats.status_counts.amber}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-status-green" />
          {stats.status_counts.green}
        </span>
        <span aria-hidden>·</span>
        <span>{stats.attempts_30d} attempts (30d)</span>
        <span aria-hidden>·</span>
        <span>{stats.video_plays} video plays</span>
      </div>
    </section>
  );
}
