import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import {
  isCoachOrAdmin,
  type User,
} from '@/lib/api';
import {
  useSyllabuses,
  useLibraryTechniques,
} from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/empty-state';
import { LibraryTechniqueRow } from '@/components/library-technique-row';

interface LibraryPageProps {
  user: User;
}

export default function LibraryPage({ user }: LibraryPageProps) {
  const canEdit = isCoachOrAdmin(user);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const techniquesQuery = useLibraryTechniques();
  const techniques = useMemo(
    () => techniquesQuery.data ?? [],
    [techniquesQuery.data],
  );
  const loading = techniquesQuery.isLoading;
  const error = techniquesQuery.error ? 'Failed to load techniques.' : null;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scrollToVideoId, setScrollToVideoId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Honor `?technique=<id>&video=<id>` arriving from the dashboard "recently
  // watched" link: expand the technique, scroll its row into view, then hand
  // the video id to ExpandedPanel so VideoList can scroll to that row once it
  // loads. Runs once per arrival; the consumed params are stripped so
  // back/forward doesn't re-trigger. We wait for techniques to load so the
  // row exists before scrolling.
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
    setExpandedId(techId);
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
      const el = document.getElementById(`library-technique-row-${techId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [searchParams, setSearchParams, techniques]);
  // Multi-select with OR semantics, matching the bubble UX the user
  // described. `null` is the sentinel for "not in any syllabus".
  const [activeSyllabuses, setActiveSyllabuses] = useState<(number | null)[]>(
    [],
  );

  const syllabusesQuery = useSyllabuses();
  const syllabuses = syllabusesQuery.data ?? [];

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
      const matchesSyllabus =
        activeSyllabuses.length === 0 ||
        activeSyllabuses.some((s) =>
          s === null
            ? t.syllabus_ids.length === 0
            : t.syllabus_ids.includes(s),
        );
      return matchesText && matchesTags && matchesSyllabus;
    });
  }, [techniques, search, activeTags, activeSyllabuses]);

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
          if (v === 'syllabuses') navigate('/syllabuses');
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="library">All techniques</TabsTrigger>
          <TabsTrigger value="syllabuses">Syllabuses</TabsTrigger>
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
              Clear
            </Button>
          )}
        </div>
      )}

      {syllabuses.length > 0 && availableTags.length > 0 && (
        <Separator className="mb-3" />
      )}

      {syllabuses.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {syllabuses.map((s) => {
            const active = activeSyllabuses.includes(s.id);
            return (
              <Badge
                key={s.id}
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() =>
                  setActiveSyllabuses((prev) =>
                    active
                      ? prev.filter((x) => x !== s.id)
                      : [...prev, s.id],
                  )
                }
              >
                {s.name}
              </Badge>
            );
          })}
          {(() => {
            const active = activeSyllabuses.includes(null);
            return (
              <Badge
                key="__no_syllabus"
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() =>
                  setActiveSyllabuses((prev) =>
                    active
                      ? prev.filter((x) => x !== null)
                      : [...prev, null],
                  )
                }
              >
                No syllabus
              </Badge>
            );
          })()}
          {activeSyllabuses.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setActiveSyllabuses([])}
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
            description="Assign a technique to a student or build a syllabus to start the library."
          />
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No techniques match the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <LibraryTechniqueRow
                key={t.id}
                technique={t}
                expanded={expandedId === t.id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === t.id ? null : t.id))
                }
                user={user}
                canEdit={canEdit}
                rowId={`library-technique-row-${t.id}`}
                scrollToVideoId={expandedId === t.id ? scrollToVideoId : null}
                onVideoScrolled={() => setScrollToVideoId(null)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

