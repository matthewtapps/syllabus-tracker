import { useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import { TechniqueFilters } from '@/components/technique-row/technique-filters';
import { useTechniqueListNav } from '@/components/technique-row/use-technique-list-nav';
import { useLibraryTechniques, useStudentLibrary } from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';

export default function LibraryPage() {
  const user = useUser();
  const isCoach = isCoachOrAdmin(user);

  // Coaches get the role-agnostic library; students get the same shape
  // augmented with is_pinned for the viewing student.
  const coachQuery = useLibraryTechniques();
  const studentQuery = useStudentLibrary(isCoach ? undefined : user.id);
  const techniquesQuery = isCoach ? coachQuery : studentQuery;
  const techniques = useMemo(
    () => techniquesQuery.data ?? [],
    [techniquesQuery.data],
  );
  const loading = techniquesQuery.isLoading;
  const error = techniquesQuery.error ? 'Failed to load techniques.' : null;

  const nav = useTechniqueListNav({
    items: techniques,
    kind: 'technique',
    rowId: (t) => t.id,
    rowElementId: (t) => `technique-row-${t.id}`,
    tagsOf: (t) => t.tags.map((tag) => tag.name),
    matchesSearch: (t, needle) =>
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle) ||
      t.tags.some((tag) => tag.name.toLowerCase().includes(needle)),
  });
  const { filtered } = nav;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <h1 className="mb-4 flex items-center gap-2 text-base font-semibold">
        <BookOpen className="h-4 w-4" aria-hidden />
        Global Technique Library
      </h1>
      {/* Legacy 'Collections' tab removed in PR 5; the /legacy/collections
       *  URL is still reachable for prod migration but not surfaced in
       *  navigation. */}

      <TechniqueFilters
        search={nav.search}
        onSearchChange={nav.setSearch}
        availableTags={nav.availableTags}
        activeTags={nav.tags}
        onToggleTag={nav.toggleTag}
        onClearTags={nav.clearTags}
      />

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
            description={
              isCoach
                ? 'Assign a technique to a student or build a collection to start the library.'
                : 'The library is empty. Check back later.'
            }
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={nav.expandedValue}
            onValueChange={nav.setExpandedValue}
          >
            {filtered.map((t) => {
              const value = String(t.id);
              const isOpen = nav.expandedValue === value;
              return (
                <TechniqueRow
                  key={t.id}
                  technique={t}
                  context={{ kind: 'global-library' }}
                  value={value}
                  isOpen={isOpen}
                  scrollToVideoId={isOpen ? nav.videoId : null}
                  onVideoScrolled={nav.consumeVideo}
                />
              );
            })}
          </Accordion>
        )}
      </div>
    </div>
  );
}
