import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderOpen,
  Pencil,
  PlayIcon,
  Search,
  Users,
  X as XIcon,
} from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type {
  AttemptWeekBucket,
  LibraryTechniqueRow,
  LibraryTechniqueStats,
  Tag,
} from '@/lib/api';
import {
  useAllTags,
  useLibraryTechniqueStats,
  useLibraryTechniques,
} from '@/lib/queries';
import {
  useRemoveTagFromTechnique,
  useUpdateLibraryTechnique,
} from '@/lib/mutations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TracedForm } from '@/components/traced-form';
import { EmptyState } from '@/components/empty-state';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';
import { TagsEditor } from '@/app/student-techniques/components/tags-editor';
import { AddVideoButton } from '@/components/videos/add-video-button';
import { VideoList } from '@/components/videos/video-list';
import { cn } from '@/lib/utils';

export default function LibraryPage() {
  const navigate = useNavigate();
  const techniquesQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => techniquesQuery.data ?? [],
    [techniquesQuery.data],
  );
  const loading = techniquesQuery.isLoading;
  const error = techniquesQuery.error ? 'Failed to load techniques.' : null;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

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

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <Tabs
        value="library"
        onValueChange={(v) => {
          if (v === 'collections') navigate('/collections');
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="library">All techniques</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder="Search techniques"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {availableTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {availableTags.map((tag) => {
            const active = activeTags.includes(tag);
            return (
              <Badge
                key={tag}
                variant={active ? 'default' : 'outline'}
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

      <p className="mb-2 text-xs text-muted-foreground">
        {filtered.length === techniques.length
          ? `${techniques.length} ${techniques.length === 1 ? 'technique' : 'techniques'}`
          : `${filtered.length} of ${techniques.length} techniques`}
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : techniques.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No techniques yet"
            description="Assign a technique to a student or build a collection to start the library."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => {
              const expanded = expandedId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((prev) => (prev === t.id ? null : t.id))
                    }
                    aria-expanded={expanded}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <CollapsedMeta row={t} />
                      </p>
                      {t.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
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
                    {expanded ? (
                      <ChevronUpIcon
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <ChevronDownIcon
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </button>
                  {expanded && <ExpandedPanel technique={t} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function CollapsedMeta({ row }: { row: LibraryTechniqueRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap">
      <Users className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.student_count}</span>
      <span aria-hidden>·</span>
      <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.collection_count}</span>
      <span aria-hidden>·</span>
      <PlayIcon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{row.video_count}</span>
    </span>
  );
}

interface ExpandedPanelProps {
  technique: LibraryTechniqueRow;
}

function ExpandedPanel({ technique }: ExpandedPanelProps) {
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const statsQuery = useLibraryTechniqueStats(technique.id);
  const stats = statsQuery.data ?? null;

  return (
    <div className="space-y-5 border-t border-border bg-muted/20 px-4 py-4">
      {editing ? (
        <NameDescriptionEditor
          technique={technique}
          onDone={() => setEditing(false)}
        />
      ) : (
        <NameDescriptionDisplay
          technique={technique}
          onEdit={() => setEditing(true)}
        />
      )}

      <TagsRow technique={technique} />

      <CollectionsRow stats={stats} />

      <StatsStrip stats={stats} loading={statsQuery.isLoading} />

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Videos
          </h3>
          <AddVideoButton
            techniqueId={technique.id}
            onAdded={() => setReloadKey((k) => k + 1)}
          />
        </div>
        <VideoList
          techniqueId={technique.id}
          canManage
          reloadKey={reloadKey}
        />
      </section>
    </div>
  );
}

function NameDescriptionDisplay({
  technique,
  onEdit,
}: {
  technique: LibraryTechniqueRow;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-base font-semibold">{technique.name}</h2>
        {technique.description && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {technique.description}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onEdit}
        aria-label="Edit name and description"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().min(1, 'Description is required'),
});
type EditValues = z.infer<typeof editSchema>;

function NameDescriptionEditor({
  technique,
  onDone,
}: {
  technique: LibraryTechniqueRow;
  onDone: () => void;
}) {
  const updateMutation = useUpdateLibraryTechnique();
  const form = useFormWithValidation<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: technique.name,
      description: technique.description,
    },
  });

  async function handleSubmit(values: EditValues) {
    try {
      await updateMutation.mutateAsync({
        techniqueId: technique.id,
        data: values,
      });
      toast.success('Technique updated');
      onDone();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update technique');
    }
  }

  return (
    <Form {...form}>
      <TracedForm
        id="edit_library_technique"
        onSubmit={form.handleSubmit(handleSubmit)}
        setFieldErrors={form.setFieldErrors}
        className="space-y-3"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} autoFocus />
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} className="min-h-24" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </TracedForm>
    </Form>
  );
}

function TagsRow({ technique }: { technique: LibraryTechniqueRow }) {
  const removeTagMutation = useRemoveTagFromTechnique();
  const allTagsQuery = useAllTags();
  const allTags = allTagsQuery.data ?? [];

  // Optimistic local list so add/remove feels instant. Seeded from the
  // technique's own tags; re-seeded whenever the parent's expandedId
  // changes (a fresh ExpandedPanel mount).
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
        {localTags.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1 pr-1 text-xs"
          >
            {tag.name}
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
          </Badge>
        ))}
        <TagsEditor
          techniqueId={technique.id}
          assignedTags={localTags}
          allTags={allTags}
          onTagAdded={handleTagAdded}
        />
      </div>
    </section>
  );
}

function CollectionsRow({ stats }: { stats: LibraryTechniqueStats | null }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Collections
      </h3>
      {stats === null ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : stats.collections.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          Not in any collection yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {stats.collections.map((c) => (
            <Badge key={c.id} variant="outline" asChild>
              <Link to={`/collections/${c.id}`} className="cursor-pointer">
                <FolderOpen className="mr-1 h-3 w-3" aria-hidden />
                {c.name}
              </Link>
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
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Usage
      </h3>
      {loading || !stats ? (
        <div className="h-16 animate-pulse rounded bg-muted/40" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusMix counts={stats.status_counts} />
          <AttemptsStat
            total={stats.attempts_30d}
            buckets={stats.attempts_weekly_buckets}
          />
          <PlaysStat plays={stats.video_plays} />
        </div>
      )}
    </section>
  );
}

function StatusMix({
  counts,
}: {
  counts: LibraryTechniqueStats['status_counts'];
}) {
  const total = counts.red + counts.amber + counts.green;
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Status mix</p>
      {total === 0 ? (
        <p className="mt-1 text-sm italic text-muted-foreground">
          Not assigned
        </p>
      ) : (
        <div className="mt-1.5 flex items-center gap-3">
          <Donut counts={counts} />
          <div className="space-y-0.5 text-xs">
            <StatusLine color="bg-status-red" label="Red" value={counts.red} />
            <StatusLine color="bg-status-amber" label="Amber" value={counts.amber} />
            <StatusLine color="bg-status-green" label="Green" value={counts.green} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusLine({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <p className="flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1 font-medium tabular-nums">{value}</span>
    </p>
  );
}

function Donut({
  counts,
}: {
  counts: LibraryTechniqueStats['status_counts'];
}) {
  const total = counts.red + counts.amber + counts.green;
  const size = 48;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  if (total === 0) return null;
  const segments = [
    { color: 'var(--status-red)', value: counts.red },
    { color: 'var(--status-amber)', value: counts.amber },
    { color: 'var(--status-green)', value: counts.green },
  ];
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={stroke}
      />
      {segments.map((seg, i) => {
        const length = (seg.value / total) * circumference;
        const dashArray = `${length} ${circumference - length}`;
        const rotate = (offset / circumference) * 360 - 90;
        offset += length;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={dashArray}
            transform={`rotate(${rotate} ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

function AttemptsStat({
  total,
  buckets,
}: {
  total: number;
  buckets: AttemptWeekBucket[];
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Attempts · 30d</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{total}</p>
        <Sparkline buckets={buckets} />
      </div>
    </div>
  );
}

function Sparkline({ buckets }: { buckets: AttemptWeekBucket[] }) {
  const weeks = 8;
  const series = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of buckets) counts.set(b.date, b.count);
    const out: { count: number; key: string }[] = [];
    const monday = isoMondayUtc(new Date());
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, count: counts.get(key) ?? 0 });
    }
    return out;
  }, [buckets]);

  const max = Math.max(1, ...series.map((s) => s.count));
  const barW = 4;
  const gap = 2;
  const totalW = weeks * (barW + gap) - gap;
  const totalH = 28;
  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      role="img"
      aria-label={`Attempts per week over the last ${weeks} weeks`}
      className="shrink-0 text-primary"
    >
      {series.map((s, i) => {
        const h = s.count === 0 ? 2 : Math.max(3, (s.count / max) * totalH);
        const x = i * (barW + gap);
        const y = totalH - h;
        return (
          <rect
            key={s.key}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={1}
            className={s.count > 0 ? 'fill-current' : 'fill-muted'}
          />
        );
      })}
    </svg>
  );
}

function isoMondayUtc(d: Date): Date {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

function PlaysStat({ plays }: { plays: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">Video plays</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums">
        {plays}
        <PlayIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </p>
    </div>
  );
}
