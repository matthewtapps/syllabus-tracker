import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Search, X as XIcon } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/empty-state';
import { TechniqueRow } from '@/components/technique-row';
import {
  useCollections,
  useLibraryTechniques,
  useStudentLibrary,
} from '@/lib/queries';
import { useUser } from '@/lib/current-user-context';
import { isCoachOrAdmin } from '@/lib/api';

export default function LibraryPage() {
  const navigate = useNavigate();
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

  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedValue, setExpandedValue] = useState<string>('');
  const [scrollToVideoId, setScrollToVideoId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Multi-select with OR semantics. `null` is the sentinel for "not in any
  // collection". Coach-only filter; students see no collections control.
  const [activeCollections, setActiveCollections] = useState<(number | null)[]>(
    [],
  );

  // Honor `?technique=<id>&video=<id>` arriving from the dashboard "recently
  // watched" link. Runs once per arrival; the consumed params are stripped
  // so back/forward doesn't re-trigger.
  const didConsumeFocusRef = useRef(false);
  useEffect(() => {
    if (didConsumeFocusRef.current) return;
    if (techniques.length === 0) return;
    const rawTech = searchParams.get('technique');
    if (!rawTech) return;
    const techId = parseInt(rawTech, 10);
    if (!Number.isFinite(techId)) return;
    if (!techniques.some((t) => t.id === techId)) return;
    didConsumeFocusRef.current = true;
    setExpandedValue(String(techId));
    const rawVid = searchParams.get('video');
    const vidId = rawVid ? parseInt(rawVid, 10) : NaN;
    if (Number.isFinite(vidId)) setScrollToVideoId(vidId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('technique');
      next.delete('video');
      return next;
    }, { replace: true });
    requestAnimationFrame(() => {
      const el = document.getElementById(`technique-row-${techId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [searchParams, setSearchParams, techniques]);

  const collectionsQuery = useCollections();
  const collections = isCoach ? collectionsQuery.data ?? [] : [];

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
      const matchesCollection =
        activeCollections.length === 0 ||
        activeCollections.some((c) =>
          c === null
            ? t.collection_ids.length === 0
            : t.collection_ids.includes(c),
        );
      return matchesText && matchesTags && matchesCollection;
    });
  }, [techniques, search, activeTags, activeCollections]);

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      {isCoach && (
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
      )}

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
              onClick={() => setActiveTags([])}
            >
              <XIcon className="mr-1 h-3 w-3" aria-hidden />
              Clear
            </Button>
          )}
        </div>
      )}

      {isCoach && collections.length > 0 && availableTags.length > 0 && (
        <Separator className="mb-3" />
      )}

      {isCoach && collections.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {collections.map((c) => {
            const active = activeCollections.includes(c.id);
            return (
              <Badge
                key={c.id}
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() =>
                  setActiveCollections((prev) =>
                    active
                      ? prev.filter((x) => x !== c.id)
                      : [...prev, c.id],
                  )
                }
              >
                {c.name}
              </Badge>
            );
          })}
          {(() => {
            const active = activeCollections.includes(null);
            return (
              <Badge
                key="__no_collection"
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() =>
                  setActiveCollections((prev) =>
                    active
                      ? prev.filter((x) => x !== null)
                      : [...prev, null],
                  )
                }
              >
                No collection
              </Badge>
            );
          })()}
          {activeCollections.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setActiveCollections([])}
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
                  onVideoScrolled={() => setScrollToVideoId(null)}
                />
              );
            })}
          </Accordion>
        )}
      </div>
    </div>
  );
}
