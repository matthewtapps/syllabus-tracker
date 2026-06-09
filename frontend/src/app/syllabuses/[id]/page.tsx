import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  Eye,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getTechniquesForAssignment,
  isCoachOrAdmin,
  type Syllabus,
  type LibraryTechnique,
  type Tag,
  type User,
} from '@/lib/api';
import {
  useSyllabus,
  useSyllabusStudents,
} from '@/lib/queries';
import {
  useDeleteSyllabus,
  useRemoveTechniqueFromSyllabus,
  useUpdateSyllabus,
} from '@/lib/mutations';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { EmptyState } from '@/components/empty-state';
import AddTechniquesToSyllabusDialog from '@/components/add-techniques-to-syllabus-dialog';
import TechniqueDetailsDialog from '@/components/technique-details-dialog';

interface LibraryRow {
  id: number;
  name: string;
  description: string;
  coach_id: number;
  coach_name: string;
  tags: Tag[];
}

function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface SyllabusDetailPageProps {
  user: User;
}

export default function SyllabusDetailPage({ user }: SyllabusDetailPageProps) {
  const canEdit = isCoachOrAdmin(user);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const syllabusId = id ? parseInt(id, 10) : 0;
  const qc = useQueryClient();

  const syllabusQuery = useSyllabus(syllabusId);
  // Roster of students subscribed to this syllabus -- a privacy concern
  // for student viewers, so only fetched for coach / admin.
  const studentsQuery = useSyllabusStudents(canEdit ? syllabusId : 0);
  const syllabus = syllabusQuery.data ?? null;
  const students = studentsQuery.data ?? [];
  const error = syllabusQuery.error ? 'Failed to load syllabus.' : null;
  const updateMutation = useUpdateSyllabus();
  const removeTechniqueMutation = useRemoveTechniqueFromSyllabus();
  const deleteMutation = useDeleteSyllabus();

  const [editingMeta, setEditingMeta] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [detailsTechnique, setDetailsTechnique] = useState<LibraryTechnique | null>(
    null,
  );
  const [detailsMode, setDetailsMode] = useState<'view' | 'edit'>('view');

  // Sync local name/description form state when the syllabus arrives or refreshes.
  useEffect(() => {
    if (syllabus && !editingMeta) {
      setName(syllabus.name);
      setDescription(syllabus.description);
    }
  }, [syllabus, editingMeta]);

  function patchSyllabus(updater: (prev: Syllabus) => Syllabus) {
    qc.setQueryData<Syllabus>(qk.syllabus(syllabusId), (prev) =>
      prev ? updater(prev) : prev,
    );
  }

  // Library pool. Fetch student id 0 to get the full unassigned list (no real
  // student has that id, so it returns everything). Used to look up tags for
  // the details dialog and to drive the picker in the add-techniques dialog.
  useEffect(() => {
    async function loadLibrary() {
      try {
        const techs: LibraryRow[] = await getTechniquesForAssignment(0);
        setLibrary(techs);
      } catch {
        // Best-effort; page still works for remove and edit.
      }
    }
    loadLibrary();
  }, []);

  const assignedIds = useMemo(
    () => new Set(syllabus?.techniques.map((t) => t.id) ?? []),
    [syllabus],
  );

  const tagsByTechniqueId = useMemo(() => {
    const map = new Map<number, Tag[]>();
    library.forEach((t) => map.set(t.id, t.tags ?? []));
    return map;
  }, [library]);

  async function handleSaveMeta() {
    if (!syllabus) return;
    setSavingMeta(true);
    try {
      await updateMutation.mutateAsync({
        id: syllabus.id,
        data: { name, description },
      });
      patchSyllabus((prev) => ({ ...prev, name, description }));
      setEditingMeta(false);
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingMeta(false);
    }
  }

  function handleTechniquesAdded(added: LibraryTechnique[]) {
    if (!syllabus || added.length === 0) return;
    const existingIds = new Set(syllabus.techniques.map((t) => t.id));
    const fresh = added.filter((t) => !existingIds.has(t.id));
    if (fresh.length === 0) return;
    patchSyllabus((prev) => ({
      ...prev,
      techniques: [...prev.techniques, ...fresh],
      technique_count: prev.technique_count + fresh.length,
    }));
  }

  function handleTechniqueSaved(updated: LibraryTechnique) {
    patchSyllabus((prev) => ({
      ...prev,
      techniques: prev.techniques.map((t) =>
        t.id === updated.id ? { ...t, ...updated } : t,
      ),
    }));
    setDetailsTechnique(updated);
  }

  async function handleRemoveTechnique(techId: number) {
    if (!syllabus) return;
    try {
      await removeTechniqueMutation.mutateAsync({
        syllabusId: syllabus.id,
        techniqueId: techId,
      });
      patchSyllabus((prev) => ({
        ...prev,
        techniques: prev.techniques.filter((t) => t.id !== techId),
        technique_count: Math.max(0, prev.technique_count - 1),
      }));
      toast.success('Removed');
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove');
    }
  }

  async function handleDelete() {
    if (!syllabus) return;
    try {
      await deleteMutation.mutateAsync(syllabus.id);
      toast.success('Syllabus deleted');
      navigate('/syllabuses');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 gap-1.5 text-muted-foreground"
        >
          <Link to="/syllabuses">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to syllabuses
          </Link>
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {syllabus && (
        <>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {editingMeta ? (
              <div className="w-full space-y-3">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  className="text-2xl font-semibold"
                />
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  className="min-h-20"
                />
                <div className="flex gap-2">
                  <Button onClick={handleSaveMeta} disabled={savingMeta}>
                    {savingMeta ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingMeta(false);
                      setName(syllabus.name);
                      setDescription(syllabus.description);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {syllabus.name}
                </h1>
                {syllabus.description && (
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    {syllabus.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="h-3 w-3" aria-hidden />
                    {syllabus.technique_count}{' '}
                    {syllabus.technique_count === 1 ? 'technique' : 'techniques'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden />
                    {syllabus.student_count}{' '}
                    {syllabus.student_count === 1 ? 'student' : 'students'}
                  </span>
                </div>
              </div>
            )}
            {!editingMeta && canEdit && (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingMeta(true)}
                  className="gap-2"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(true)}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </Button>
              </div>
            )}
          </div>

          <section className="mb-8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Techniques in this syllabus
              </h2>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add techniques
                </Button>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {syllabus.techniques.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No techniques yet"
                  description="Add techniques to this syllabus from the library."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {syllabus.techniques.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-1 px-4 py-3 sm:gap-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer text-left"
                        onClick={() => {
                          setDetailsTechnique(t);
                          setDetailsMode('view');
                        }}
                      >
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        {t.description && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {t.description}
                          </p>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => {
                          setDetailsTechnique(t);
                          setDetailsMode('view');
                        }}
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                        <span className="sr-only">View {t.name}</span>
                      </Button>
                      {syllabus.can_edit_all_techniques && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => {
                            setDetailsTechnique(t);
                            setDetailsMode('edit');
                          }}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Edit {t.name}</span>
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveTechnique(t.id)}
                        >
                          <X className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Remove {t.name}</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {canEdit && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Subscribed students
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {students.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No students on this syllabus yet"
                  description="Open a student's techniques and use the Add techniques dialog to assign this syllabus to them."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {students.map((s) => {
                    const display = s.display_name || s.username || `User ${s.id}`;
                    return (
                      <li key={s.id}>
                        <Link
                          to={`/student/${s.id}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                        >
                          <Avatar size="sm">
                            <AvatarFallback>{initials(display)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {display}
                            </p>
                            {s.display_name && s.username && (
                              <p className="truncate text-xs text-muted-foreground">
                                {s.username}
                              </p>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
          )}
        </>
      )}

      {syllabus && (
        <AddTechniquesToSyllabusDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          syllabusId={syllabus.id}
          syllabusName={syllabus.name}
          alreadyAssignedIds={assignedIds}
          canCreate={syllabus.can_create_techniques}
          onAdded={handleTechniquesAdded}
        />
      )}

      {syllabus && detailsTechnique && (
        <TechniqueDetailsDialog
          open={!!detailsTechnique}
          onOpenChange={(o) => {
            if (!o) setDetailsTechnique(null);
          }}
          technique={detailsTechnique}
          tags={tagsByTechniqueId.get(detailsTechnique.id) ?? []}
          canEdit={syllabus.can_edit_all_techniques}
          initialMode={detailsMode}
          onSaved={handleTechniqueSaved}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this syllabus?</AlertDialogTitle>
            <AlertDialogDescription>
              The syllabus will be removed. Students' assigned techniques
              stay where they are, just no longer grouped under this syllabus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
