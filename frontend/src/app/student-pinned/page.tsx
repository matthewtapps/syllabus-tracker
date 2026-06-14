import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate, useNavigationType } from 'react-router-dom';
import { Pin, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { useListUrlState } from '@/lib/use-list-url-state';
import { useScrollAnchor } from '@/lib/use-scroll-anchor';
import { scrollToTopWhenStable } from '@/lib/scroll-when-stable';
import { useAllUsers, useStudentPinnedTechniques } from '@/lib/queries';
import { usePinTechnique, useUnpinTechnique } from '@/lib/mutations';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';
import type { LibraryTechniqueRow } from '@/lib/api';
import { cn } from '@/lib/utils';

const EXIT_MS = 220;

export default function StudentPinnedPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id ? parseInt(params.id, 10) : NaN;
  const user = useUser();

  if (!Number.isFinite(studentId)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isOwner = user.id === studentId;
  const isCoach = isCoachOrAdmin(user);
  if (!isOwner && !isCoach) {
    return <Navigate to="/dashboard" replace />;
  }

  return <PinnedListing studentId={studentId} isOwnView={isOwner} />;
}

function PinnedListing({
  studentId,
  isOwnView,
}: {
  studentId: number;
  isOwnView: boolean;
}) {
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set());
  const navType = useNavigationType();
  const { search, setSearch, tags: activeTags, setTags, focus, setFocus, anchor } =
    useListUrlState();
  const query = useStudentPinnedTechniques(studentId);
  const usersQuery = useAllUsers();
  const pinMutation = usePinTechnique(studentId);
  const unpinMutation = useUnpinTechnique(studentId);
  const techniques = useMemo(() => query.data ?? [], [query.data]);
  const studentName = useMemo(() => {
    if (isOwnView) return null;
    const u = (usersQuery.data ?? []).find((u) => u.id === studentId);
    return u ? u.display_name || u.username : null;
  }, [isOwnView, usersQuery.data, studentId]);
  const loading = query.isLoading;
  const error = query.error ? 'Failed to load pinned techniques.' : null;

  // Expansion in the URL (?focus=technique:<id>): shareable + restored on back.
  const expandedValue = focus?.type === 'technique' ? String(focus.id) : '';
  const setExpandedValue = (value: string) =>
    setFocus(value ? { type: 'technique', id: Number(value) } : null);

  // Scroll to the focused (expanded) row, or the scroll anchor when none is
  // expanded, on arrival (not POP, where the scroll manager restores pixel
  // position). Runs once when the data is ready.
  const didScrollOnArrival = useRef(false);
  useEffect(() => {
    if (didScrollOnArrival.current || techniques.length === 0) return;
    const target = focus ?? anchor;
    if (!target || target.type !== 'technique') {
      didScrollOnArrival.current = true;
      return;
    }
    if (!techniques.some((t) => t.id === target.id)) return;
    didScrollOnArrival.current = true;
    if (navType === 'POP') return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`technique-row-${target.id}`);
      if (el) scrollToTopWhenStable(el);
    });
  }, [techniques, focus, anchor, navType]);

  const title = isOwnView
    ? 'My Pinned Techniques'
    : studentName
      ? `${studentName}'s Pinned Techniques`
      : 'Pinned Techniques';

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
    setTags(activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag]);
  }

  // Shareable scroll anchor (?at=) for the top-most visible row when none is expanded.
  const anchorRows = useMemo(
    () => filtered.map((t) => ({ elementId: `technique-row-${t.id}`, token: `technique:${t.id}` })),
    [filtered],
  );
  useScrollAnchor(anchorRows, !focus);

  // Two-phase unpin so the row can animate out: flag the row for exit
  // styling, wait for the transition to play, then fire the mutation. The
  // toast carries an Undo button that re-pins the technique; the optimistic
  // pin mutation slips the row back into the cache.
  const handleUnpinIntent = useCallback(
    (technique: LibraryTechniqueRow) => {
      setExitingIds((prev) => {
        if (prev.has(technique.id)) return prev;
        const next = new Set(prev);
        next.add(technique.id);
        return next;
      });
      window.setTimeout(async () => {
        try {
          await unpinMutation.mutateAsync(technique.id);
          toast.success(`Unpinned ${technique.name}`, {
            action: {
              label: 'Undo',
              onClick: () => {
                pinMutation.mutate(technique);
              },
            },
          });
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to unpin technique',
          );
        } finally {
          setExitingIds((prev) => {
            if (!prev.has(technique.id)) return prev;
            const next = new Set(prev);
            next.delete(technique.id);
            return next;
          });
        }
      }, EXIT_MS);
    },
    [pinMutation, unpinMutation],
  );

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4 flex items-end justify-between gap-2">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Pin className="h-4 w-4" aria-hidden />
          {title}
        </h1>
      </div>

      {techniques.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="relative">
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
            <div className="flex flex-wrap gap-1.5">
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
                  onClick={() => setTags([])}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {filtered.length === techniques.length
              ? `${techniques.length} ${
                  techniques.length === 1 ? 'technique' : 'techniques'
                }`
              : `${filtered.length} of ${techniques.length} techniques`}
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
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
          // animate-in fires every mount, so the empty state slides down
          // from the top after the last technique finishes sliding away
          // (rather than snapping into place).
          <div className="animate-in fade-in-0 slide-in-from-top-2 duration-300">
            <EmptyState
              icon={Pin}
              title="No pins yet"
              description={
                isOwnView
                  ? 'Pin techniques from the library to keep them within reach.'
                  : 'This student has not pinned anything from the library yet.'
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={expandedValue}
            onValueChange={setExpandedValue}
          >
            {filtered.map((t) => {
              const value = String(t.id);
              const exiting = exitingIds.has(t.id);
              // Wrapper owns the inter-row border. The AccordionItem
              // inside is the sole child of this wrapper, so its own
              // `border-b last:border-b-0` always strips itself out
              // (every item is the last child of its own wrapper).
              return (
                <div
                  key={t.id}
                  className={cn(
                    'grid border-b border-border transition-[grid-template-rows,opacity] duration-200 ease-out last:border-b-0',
                    exiting
                      ? 'grid-rows-[0fr] opacity-0 pointer-events-none'
                      : 'grid-rows-[1fr] opacity-100',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <TechniqueRow
                      technique={t}
                      context={{
                        kind: 'student-pinned',
                        studentId,
                        studentName,
                        onUnpinIntent: isOwnView ? handleUnpinIntent : undefined,
                      }}
                      value={value}
                      isOpen={expandedValue === value}
                    />
                  </div>
                </div>
              );
            })}
          </Accordion>
        )}
      </div>
    </div>
  );
}
