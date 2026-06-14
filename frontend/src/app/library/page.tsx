import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigationType } from 'react-router-dom';
import { BookOpen, Search, X as XIcon } from 'lucide-react';
import { useListUrlState } from '@/lib/use-list-url-state';
import { scrollToTopWhenStable } from '@/lib/scroll-when-stable';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
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

  const navType = useNavigationType();
  const { search, setSearch, tags: activeTags, setTags, focus, setFocus, videoId } =
    useListUrlState();
  const [videoConsumed, setVideoConsumed] = useState(false);
  const scrollToVideoId = videoConsumed ? null : videoId;

  // Expansion lives in the URL (?focus=technique:<id>) so the view is shareable
  // and restored on back.
  const expandedValue = focus?.type === 'technique' ? String(focus.id) : '';
  const setExpandedValue = (value: string) =>
    setFocus(value ? { type: 'technique', id: Number(value) } : null);

  // On arrival with a focus token, scroll to that row once the data is ready.
  // Skip on POP: the scroll manager restores the prior pixel position there.
  const didScrollToFocus = useRef(false);
  useEffect(() => {
    if (didScrollToFocus.current || techniques.length === 0) return;
    if (!focus || focus.type !== 'technique') {
      didScrollToFocus.current = true;
      return;
    }
    if (!techniques.some((t) => t.id === focus.id)) return;
    didScrollToFocus.current = true;
    if (navType === 'POP') return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`technique-row-${focus.id}`);
      if (el) scrollToTopWhenStable(el);
    });
  }, [techniques, focus, navType]);

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

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <h1 className="mb-4 flex items-center gap-2 text-base font-semibold">
        <BookOpen className="h-4 w-4" aria-hidden />
        Global Technique Library
      </h1>
      {/* Legacy 'Collections' tab removed in PR 5; the /legacy/collections
       *  URL is still reachable for prod migration but not surfaced in
       *  navigation. */}

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
        <div className="mb-3 flex flex-wrap gap-1.5">
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
              <XIcon className="mr-1 h-3 w-3" aria-hidden />
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
            value={expandedValue}
            onValueChange={setExpandedValue}
          >
            {filtered.map((t) => {
              const value = String(t.id);
              const isOpen = expandedValue === value;
              return (
                <TechniqueRow
                  key={t.id}
                  technique={t}
                  context={{ kind: 'global-library' }}
                  value={value}
                  isOpen={isOpen}
                  scrollToVideoId={isOpen ? scrollToVideoId : null}
                  onVideoScrolled={() => setVideoConsumed(true)}
                />
              );
            })}
          </Accordion>
        )}
      </div>
    </div>
  );
}
