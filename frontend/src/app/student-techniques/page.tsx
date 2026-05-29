import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  GraduationCap,
  KeyRound,
  MoreVertical,
  Plus,
} from 'lucide-react';
import { ClaimLinkPanel } from '@/components/claim-link-panel';
import { toast } from 'sonner';
import {
  getAllTags,
  getStudentTechniques,
  removeTagFromTechnique,
  resetUserClaim,
  setStudentGraduated,
  updateTechnique,
  type InviteResponse,
} from '@/lib/api';
import type {
  StudentTechniques,
  Tag,
  Technique,
  TechniqueUpdate,
  User,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
import { GraduateConfirmDialog } from '@/components/graduate-confirm-dialog';
import TechniqueEditForm from '@/components/technique-edit-form';
import AssignTechniques from '@/components/assign-techniques';
import { TechniqueRow } from './components/technique-row';
import {
  TechniqueFilters,
  type FilterTab,
} from './components/technique-filters';
import { TagRemoveDialog } from './components/tag-remove-dialog';
import type { Status } from '@/lib/status';

interface StudentTechniquesProps {
  user: User;
}

export default function StudentTechniques({ user }: StudentTechniquesProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = (() => {
    const raw = searchParams.get('focus');
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const [data, setData] = useState<StudentTechniques | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [filterText, setFilterText] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // 'all' = no collection filter, 'other' = loose assignments only, or a
  // numeric collection id.
  const collectionFilter = searchParams.get('collection') ?? 'all';
  function setCollectionFilter(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') params.delete('collection');
      else params.set('collection', next);
      return params;
    }, { replace: true });
  }

  const [editingTechnique, setEditingTechnique] = useState<Technique | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [tagToRemove, setTagToRemove] = useState<{
    technique: Technique;
    tag: Tag;
  } | null>(null);
  const [graduateConfirmOpen, setGraduateConfirmOpen] = useState(false);
  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const studentId = parseInt(id || '0', 10);
        const [techniques, tagsResult] = await Promise.all([
          getStudentTechniques(studentId),
          getAllTags(),
        ]);
        if (cancelled) return;
        setData(techniques);
        setAllTags(tagsResult);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError('Failed to load techniques. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // When landing with ?focus=<id>, clear any filter that would hide the row,
  // scroll to the row, and consume the param so back/forward navigation behaves.
  useEffect(() => {
    if (focusId === null || !data) return;
    const target = data.techniques.find((t) => t.id === focusId);
    if (!target) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      }, { replace: true });
      return;
    }
    setFilterText('');
    setActiveTab('all');
    setSelectedTags([]);
    requestAnimationFrame(() => {
      const el = document.getElementById(`technique-row-${focusId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('focus');
      return next;
    }, { replace: true });
  }, [focusId, data, setSearchParams]);

  // Unique collections the student has assignments in (drives the selector
  // visibility). "Loose" is added if any technique has no collection.
  const studentCollections = useMemo(() => {
    if (!data) return [] as { id: number; name: string }[];
    const seen = new Map<number, string>();
    for (const t of data.techniques) {
      if (t.collection_id && !seen.has(t.collection_id)) {
        seen.set(t.collection_id, t.collection_name ?? 'Untitled');
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const hasLooseAssignments = useMemo(
    () => !!data && data.techniques.some((t) => !t.collection_id),
    [data],
  );

  const showCollectionSelector =
    studentCollections.length + (hasLooseAssignments ? 1 : 0) >= 2;

  function matchesCollection(t: Technique): boolean {
    if (collectionFilter === 'all') return true;
    if (collectionFilter === 'other') return !t.collection_id;
    const parsed = parseInt(collectionFilter, 10);
    if (!Number.isFinite(parsed)) return true;
    return t.collection_id === parsed;
  }

  const availableTags = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.techniques.forEach((t) => t.tags.forEach((tag) => set.add(tag.name)));
    return Array.from(set).sort();
  }, [data]);

  const counts = useMemo<Record<FilterTab, number>>(() => {
    const base: Record<FilterTab, number> = {
      all: 0,
      red: 0,
      amber: 0,
      green: 0,
      new_activity: 0,
    };
    if (!data) return base;
    for (const t of data.techniques) {
      if (!matchesCollection(t)) continue;
      base.all += 1;
      base[t.status as Status] += 1;
      if (t.has_new_student_activity) base.new_activity += 1;
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collectionFilter]);

  const filteredTechniques = useMemo<Technique[]>(() => {
    if (!data) return [];
    const needle = filterText.trim().toLowerCase();
    return data.techniques.filter((t) => {
      if (!matchesCollection(t)) return false;
      if (activeTab === 'new_activity' && !t.has_new_student_activity) return false;
      if (activeTab !== 'all' && activeTab !== 'new_activity' && t.status !== activeTab)
        return false;
      if (
        selectedTags.length > 0 &&
        !selectedTags.every((tag) => t.tags.some((tt) => tt.name === tag))
      )
        return false;
      if (!needle) return true;
      return (
        t.technique_name.toLowerCase().includes(needle) ||
        t.technique_description.toLowerCase().includes(needle) ||
        t.tags.some((tag) => tag.name.toLowerCase().includes(needle))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filterText, activeTab, selectedTags, collectionFilter]);

  function toggleTagFilter(tagName: string) {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  }

  function updateTechniqueLocally(updated: Technique) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            techniques: prev.techniques.map((t) =>
              t.id === updated.id ? updated : t,
            ),
          }
        : prev,
    );
  }

  function handleTagsChange(updated: Technique, _newTags: Tag[], allTagsAfter?: Tag[]) {
    updateTechniqueLocally(updated);
    if (allTagsAfter) setAllTags(allTagsAfter);
    toast.success('Tag added');
  }

  async function executeTagRemoval() {
    if (!tagToRemove) return;
    const { technique, tag } = tagToRemove;
    try {
      const response = await removeTagFromTechnique(technique.technique_id, tag.id);
      if (!response.ok) {
        toast.error('Failed to remove tag');
        return;
      }
      const updated: Technique = {
        ...technique,
        tags: technique.tags.filter((t) => t.id !== tag.id),
      };
      updateTechniqueLocally(updated);
      setSelectedTags((prev) => prev.filter((t) => t !== tag.name));
      toast.success(`Removed tag "${tag.name}"`);
    } finally {
      setTagToRemove(null);
    }
  }

  async function handleEditDefinitionSubmit(updates: TechniqueUpdate) {
    if (!editingTechnique) return;
    try {
      const response = await updateTechnique(editingTechnique.id, updates);
      if (!response.ok) {
        toast.error('Failed to save changes');
        return;
      }
      // Mirror name/description across all assigned student rows like the API does.
      setData((prev) =>
        prev
          ? {
              ...prev,
              techniques: prev.techniques.map((t) =>
                t.technique_id === editingTechnique.technique_id
                  ? { ...t, ...updates }
                  : t,
              ),
            }
          : prev,
      );
      toast.success('Changes saved');
      setEditingTechnique(null);
      setIsEditDialogOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save changes');
    }
  }

  async function handleIssueClaimLink() {
    if (!data) return;
    try {
      const response = await resetUserClaim(data.student.id);
      if (!response.ok) {
        toast.error('Failed to create link');
        return;
      }
      const invite: InviteResponse = await response.json();
      const url = `${window.location.origin}${invite.claim_path}`;
      setIssuedClaimUrl(url);
      // Reflect that the user is back in "unclaimed" state.
      setData((prev) =>
        prev ? { ...prev, student: { ...prev.student, claimed_at: undefined } } : prev,
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to create link');
    }
  }

  async function handleToggleGraduated() {
    if (!data) return;
    const wasGraduated = !!data.student.graduated_at;
    try {
      const response = await setStudentGraduated(data.student.id, !wasGraduated);
      if (!response.ok) {
        toast.error('Failed to update student');
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              student: {
                ...prev.student,
                graduated_at: wasGraduated ? undefined : new Date().toISOString(),
              },
            }
          : prev,
      );
      toast.success(wasGraduated ? 'Un-graduated' : 'Graduated 🎓');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update student');
    }
  }

  async function reloadAfterAssignment() {
    if (!id) return;
    const studentId = parseInt(id, 10);
    const refreshed = await getStudentTechniques(studentId);
    setData(refreshed);
    setIsAddDialogOpen(false);
  }

  const studentName = data?.student.display_name || data?.student.username || '';
  const isOwnView = !!data && user.id === data.student.id;
  const studentGraduatedAt = data?.student.graduated_at ?? null;
  const isGraduate = !!studentGraduatedAt;
  const headerTitle = !data
    ? 'Techniques'
    : isOwnView
      ? 'My techniques'
      : `${studentName}'s techniques`;

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      {!isOwnView && (
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm" className="-ml-3 h-8 gap-1.5 text-muted-foreground">
            <Link to="/students">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to students
            </Link>
          </Button>
        </div>
      )}

      {isGraduate && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-status-green/30 bg-status-green-bg px-4 py-3 text-sm">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden />
          <div className="space-y-0.5">
            {isOwnView ? (
              <>
                <p className="font-medium text-status-green">Congrats on graduating 🎓</p>
                <p className="text-muted-foreground">
                  Keep taking notes on your techniques.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-status-green">Graduated student</p>
                <p className="text-muted-foreground">
                  This student has been marked as graduated.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <PageHeader
        title={headerTitle}
        actions={
          data && (
            <div className="flex items-center gap-2">
              {data.can_edit_all_techniques && !isOwnView && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreVertical className="h-4 w-4" aria-hidden />
                      <span className="sr-only">More actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {data.student.claimed_at ? (
                      <DropdownMenuItem onClick={() => setResetConfirmOpen(true)}>
                        <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                        Reset password
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={handleIssueClaimLink}>
                        <Copy className="mr-2 h-4 w-4" aria-hidden />
                        Copy invite link
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setGraduateConfirmOpen(true)}>
                      <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
                      {isGraduate ? 'Un-graduate' : 'Graduate'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {data.can_assign_techniques && (
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" aria-hidden />
                      Add techniques
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
                    <DialogHeader>
                      <DialogTitle>Add techniques</DialogTitle>
                      <DialogDescription>
                        Assign existing techniques or create new ones for{' '}
                        {data.student.display_name || data.student.username}.
                        Collections are folders for a student's techniques: a
                        technique can sit in a collection or stay loose.
                      </DialogDescription>
                    </DialogHeader>
                    <AssignTechniques
                      studentId={data.student.id}
                      canCreateTechniques={data.can_create_techniques}
                      defaultCollectionId={
                        collectionFilter !== 'all' && collectionFilter !== 'other'
                          ? parseInt(collectionFilter, 10)
                          : null
                      }
                      onAssignComplete={reloadAfterAssignment}
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )
        }
      />

      {!loading && !error && data && (
        <div className="mb-6 space-y-4">
          {showCollectionSelector && (
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="collection-filter" className="text-sm font-medium">
                Showing
              </Label>
              <Select
                value={collectionFilter}
                onValueChange={setCollectionFilter}
              >
                <SelectTrigger id="collection-filter" className="w-auto min-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All techniques</SelectItem>
                  {studentCollections.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {hasLooseAssignments && (
                    <SelectItem value="other">Other (no collection)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <TechniqueFilters
            filterText={filterText}
            onFilterTextChange={setFilterText}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            availableTags={availableTags}
            selectedTags={selectedTags}
            onToggleTag={toggleTagFilter}
            counts={counts}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonListRow key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        ) : !data || data.techniques.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No techniques assigned"
            description={
              data?.can_assign_techniques
                ? 'Add techniques to get started.'
                : 'Your coach has not assigned any techniques yet.'
            }
            action={
              data?.can_assign_techniques && (
                <Button onClick={() => setIsAddDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  Add techniques
                </Button>
              )
            }
          />
        ) : filteredTechniques.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No techniques match your filters"
            description={`Try removing filters to see all ${data.techniques.length} techniques.`}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setFilterText('');
                  setSelectedTags([]);
                  setActiveTab('all');
                }}
              >
                Reset filters
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {filteredTechniques.map((technique) => (
              <TechniqueRow
                key={technique.id}
                technique={technique}
                canEditAll={data.can_edit_all_techniques}
                canManageTags={data.can_manage_tags}
                isOwnTechnique={user.id === data.student.id}
                defaultExpanded={technique.id === focusId}
                showCollectionChip={showCollectionSelector && collectionFilter === 'all'}
                allTags={allTags}
                selectedTagFilter={selectedTags}
                onTechniqueUpdate={updateTechniqueLocally}
                onTagsChange={handleTagsChange}
                onRequestTagRemoval={(t, tag) => setTagToRemove({ technique: t, tag })}
                onEditDefinition={(t) => {
                  setEditingTechnique(t);
                  setIsEditDialogOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-md overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit technique definition</DialogTitle>
            <DialogDescription>
              Changes to the name or description affect every student assigned this technique.
            </DialogDescription>
          </DialogHeader>
          {editingTechnique && data && (
            <TechniqueEditForm
              technique={editingTechnique}
              canEditAll={data.can_edit_all_techniques}
              currentUserId={user.id}
              studentId={data.student.id}
              onSubmit={handleEditDefinitionSubmit}
            />
          )}
        </DialogContent>
      </Dialog>

      <TagRemoveDialog
        open={!!tagToRemove}
        onOpenChange={(open) => !open && setTagToRemove(null)}
        tagName={tagToRemove?.tag.name ?? null}
        onConfirm={executeTagRemoval}
      />

      {data && (
        <GraduateConfirmDialog
          open={graduateConfirmOpen}
          onOpenChange={setGraduateConfirmOpen}
          mode={isGraduate ? 'ungraduate' : 'graduate'}
          studentName={studentName}
          onConfirm={() => {
            setGraduateConfirmOpen(false);
            handleToggleGraduated();
          }}
        />
      )}

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {studentName}'s password?</AlertDialogTitle>
            <AlertDialogDescription>
              This signs them out and clears their current password. You'll get a
              link to share so they can pick a new password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setResetConfirmOpen(false);
                handleIssueClaimLink();
              }}
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!issuedClaimUrl}
        onOpenChange={(next) => {
          if (!next) setIssuedClaimUrl(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Sign-in link ready</DialogTitle>
            <DialogDescription>
              Show this QR code to{' '}
              <span className="font-medium text-foreground">{studentName}</span>{' '}
              or send them the link. They'll pick a username and password.
              Valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          {issuedClaimUrl && <ClaimLinkPanel url={issuedClaimUrl} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIssuedClaimUrl(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
