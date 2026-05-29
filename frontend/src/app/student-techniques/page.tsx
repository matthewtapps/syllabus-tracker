import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAllTags,
  getStudentTechniques,
  removeTagFromTechnique,
  updateTechnique,
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { SkeletonListRow } from '@/components/skeleton-row';
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
  const [data, setData] = useState<StudentTechniques | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [filterText, setFilterText] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [editingTechnique, setEditingTechnique] = useState<Technique | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [tagToRemove, setTagToRemove] = useState<{
    technique: Technique;
    tag: Tag;
  } | null>(null);

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
      base.all += 1;
      base[t.status as Status] += 1;
      if (t.has_new_student_activity) base.new_activity += 1;
    }
    return base;
  }, [data]);

  const filteredTechniques = useMemo<Technique[]>(() => {
    if (!data) return [];
    const needle = filterText.trim().toLowerCase();
    return data.techniques.filter((t) => {
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
  }, [data, filterText, activeTab, selectedTags]);

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

  async function reloadAfterAssignment() {
    if (!id) return;
    const studentId = parseInt(id, 10);
    const refreshed = await getStudentTechniques(studentId);
    setData(refreshed);
    setIsAddDialogOpen(false);
  }

  const studentName = data?.student.display_name || data?.student.username || '';
  const isOwnView = !!data && user.id === data.student.id;
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

      <PageHeader
        title={headerTitle}
        actions={
          data?.can_assign_techniques && (
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
                  </DialogDescription>
                </DialogHeader>
                <AssignTechniques
                  studentId={data.student.id}
                  canCreateTechniques={data.can_create_techniques}
                  onAssignComplete={reloadAfterAssignment}
                />
              </DialogContent>
            </Dialog>
          )
        }
      />

      {!loading && !error && data && (
        <div className="mb-6">
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
    </div>
  );
}
