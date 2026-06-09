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
  type Collection,
  type LibraryTechnique,
  type Tag,
  type User,
} from '@/lib/api';
import {
  useCollection,
  useCollectionStudents,
} from '@/lib/queries';
import {
  useDeleteCollection,
  useRemoveTechniqueFromCollection,
  useUpdateCollection,
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
import AddTechniquesToCollectionDialog from '@/components/add-techniques-to-collection-dialog';
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

interface CollectionDetailPageProps {
  user: User;
}

export default function CollectionDetailPage({ user }: CollectionDetailPageProps) {
  const canEdit = isCoachOrAdmin(user);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const collectionId = id ? parseInt(id, 10) : 0;
  const qc = useQueryClient();

  const collectionQuery = useCollection(collectionId);
  // Roster of students assigned this collection -- a privacy concern
  // for student viewers, so only fetched for coach / admin.
  const studentsQuery = useCollectionStudents(canEdit ? collectionId : 0);
  const collection = collectionQuery.data ?? null;
  const students = studentsQuery.data ?? [];
  const error = collectionQuery.error ? 'Failed to load collection.' : null;
  const updateMutation = useUpdateCollection();
  const removeTechniqueMutation = useRemoveTechniqueFromCollection();
  const deleteMutation = useDeleteCollection();

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

  // Sync local name/description form state when the collection arrives or refreshes.
  useEffect(() => {
    if (collection && !editingMeta) {
      setName(collection.name);
      setDescription(collection.description);
    }
  }, [collection, editingMeta]);

  function patchCollection(updater: (prev: Collection) => Collection) {
    qc.setQueryData<Collection>(qk.collection(collectionId), (prev) =>
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
    () => new Set(collection?.techniques.map((t) => t.id) ?? []),
    [collection],
  );

  const tagsByTechniqueId = useMemo(() => {
    const map = new Map<number, Tag[]>();
    library.forEach((t) => map.set(t.id, t.tags ?? []));
    return map;
  }, [library]);

  async function handleSaveMeta() {
    if (!collection) return;
    setSavingMeta(true);
    try {
      await updateMutation.mutateAsync({
        id: collection.id,
        data: { name, description },
      });
      patchCollection((prev) => ({ ...prev, name, description }));
      setEditingMeta(false);
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingMeta(false);
    }
  }

  function handleTechniquesAdded(added: LibraryTechnique[]) {
    if (!collection || added.length === 0) return;
    const existingIds = new Set(collection.techniques.map((t) => t.id));
    const fresh = added.filter((t) => !existingIds.has(t.id));
    if (fresh.length === 0) return;
    patchCollection((prev) => ({
      ...prev,
      techniques: [...prev.techniques, ...fresh],
      technique_count: prev.technique_count + fresh.length,
    }));
  }

  function handleTechniqueSaved(updated: LibraryTechnique) {
    patchCollection((prev) => ({
      ...prev,
      techniques: prev.techniques.map((t) =>
        t.id === updated.id ? { ...t, ...updated } : t,
      ),
    }));
    setDetailsTechnique(updated);
  }

  async function handleRemoveTechnique(techId: number) {
    if (!collection) return;
    try {
      await removeTechniqueMutation.mutateAsync({
        collectionId: collection.id,
        techniqueId: techId,
      });
      patchCollection((prev) => ({
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
    if (!collection) return;
    try {
      await deleteMutation.mutateAsync(collection.id);
      toast.success('Collection deleted');
      navigate('/collections');
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
          <Link to="/collections">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to collections
          </Link>
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {collection && (
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
                      setName(collection.name);
                      setDescription(collection.description);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {collection.name}
                </h1>
                {collection.description && (
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    {collection.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="h-3 w-3" aria-hidden />
                    {collection.technique_count}{' '}
                    {collection.technique_count === 1 ? 'technique' : 'techniques'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden />
                    {collection.student_count}{' '}
                    {collection.student_count === 1 ? 'student' : 'students'}
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
                Techniques in this collection
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
              {collection.techniques.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No techniques yet"
                  description="Add techniques to this collection from the library."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {collection.techniques.map((t) => (
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
                      {collection.can_edit_all_techniques && (
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
              Assigned students
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {students.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No students on this collection yet"
                  description="Open a student's techniques and use the Add techniques dialog to assign this collection to them."
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

      {collection && (
        <AddTechniquesToCollectionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          collectionId={collection.id}
          collectionName={collection.name}
          alreadyAssignedIds={assignedIds}
          canCreate={collection.can_create_techniques}
          onAdded={handleTechniquesAdded}
        />
      )}

      {collection && detailsTechnique && (
        <TechniqueDetailsDialog
          open={!!detailsTechnique}
          onOpenChange={(o) => {
            if (!o) setDetailsTechnique(null);
          }}
          technique={detailsTechnique}
          tags={tagsByTechniqueId.get(detailsTechnique.id) ?? []}
          canEdit={collection.can_edit_all_techniques}
          initialMode={detailsMode}
          onSaved={handleTechniqueSaved}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this collection?</AlertDialogTitle>
            <AlertDialogDescription>
              The collection will be removed. Students' assigned techniques
              stay where they are, just no longer grouped under this collection.
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
