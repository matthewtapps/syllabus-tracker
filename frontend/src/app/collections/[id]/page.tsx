import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  addTechniqueToCollection,
  deleteCollection,
  getCollection,
  getCollectionStudents,
  getTechniquesForAssignment,
  removeTechniqueFromCollection,
  updateCollection,
  type Collection,
  type LibraryTechnique,
  type User,
} from '@/lib/api';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { EmptyState } from '@/components/empty-state';

interface AllLibraryTechnique {
  id: number;
  name: string;
  description: string;
}

function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const collectionId = id ? parseInt(id, 10) : 0;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [allTechniques, setAllTechniques] = useState<AllLibraryTechnique[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  async function load() {
    try {
      const [c, studs] = await Promise.all([
        getCollection(collectionId),
        getCollectionStudents(collectionId),
      ]);
      setCollection(c);
      setStudents(studs);
      setName(c.name);
      setDescription(c.description);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load collection.');
    }
  }

  // Library techniques pool for the "Add technique" combobox. We fetch the
  // student-unassigned list for student id 0 as a cheap way to get the full
  // technique library; if that proves wrong, we can add a dedicated endpoint
  // later. For now, fall back to listing techniques on the collection plus
  // letting the user add any global techniques.
  useEffect(() => {
    async function loadLibrary() {
      try {
        // Use student id 0 to get all techniques (none assigned to that
        // non-existent student, so the unassigned list is the full library).
        const techs: any[] = await getTechniquesForAssignment(0);
        setAllTechniques(
          techs.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description || '',
          })),
        );
      } catch {
        // Best-effort; the page still works to remove techniques.
      }
    }
    loadLibrary();
  }, []);

  const assignedIds = useMemo(
    () => new Set(collection?.techniques.map((t) => t.id) ?? []),
    [collection],
  );
  const candidates = useMemo(
    () => allTechniques.filter((t) => !assignedIds.has(t.id)),
    [allTechniques, assignedIds],
  );

  async function handleSaveMeta() {
    if (!collection) return;
    setSavingMeta(true);
    try {
      const response = await updateCollection(collection.id, {
        name,
        description,
      });
      if (!response.ok) {
        toast.error('Failed to save');
        return;
      }
      setCollection({ ...collection, name, description });
      setEditingMeta(false);
      toast.success('Saved');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleAddTechnique(tech: AllLibraryTechnique) {
    if (!collection) return;
    try {
      const response = await addTechniqueToCollection(collection.id, tech.id);
      if (!response.ok) {
        toast.error('Failed to add');
        return;
      }
      const lib: LibraryTechnique = {
        id: tech.id,
        name: tech.name,
        description: tech.description,
        coach_id: 0,
        coach_name: '',
      };
      setCollection({
        ...collection,
        techniques: [...collection.techniques, lib],
        technique_count: collection.technique_count + 1,
      });
      setAddOpen(false);
      setAddSearch('');
      toast.success('Added to collection');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add');
    }
  }

  async function handleRemoveTechnique(techId: number) {
    if (!collection) return;
    try {
      const response = await removeTechniqueFromCollection(collection.id, techId);
      if (!response.ok) {
        toast.error('Failed to remove');
        return;
      }
      setCollection({
        ...collection,
        techniques: collection.techniques.filter((t) => t.id !== techId),
        technique_count: Math.max(0, collection.technique_count - 1),
      });
      toast.success('Removed');
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove');
    }
  }

  async function handleDelete() {
    if (!collection) return;
    try {
      const response = await deleteCollection(collection.id);
      if (!response.ok) {
        toast.error('Failed to delete');
        return;
      }
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
            {!editingMeta && (
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
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Plus className="h-4 w-4" aria-hidden />
                    Add technique
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Find a technique..."
                      value={addSearch}
                      onValueChange={setAddSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No matching techniques.</CommandEmpty>
                      <CommandGroup>
                        {candidates
                          .filter((t) =>
                            !addSearch.trim() ||
                            t.name
                              .toLowerCase()
                              .includes(addSearch.toLowerCase()),
                          )
                          .slice(0, 30)
                          .map((t) => (
                            <CommandItem
                              key={t.id}
                              value={t.name}
                              onSelect={() => handleAddTechnique(t)}
                            >
                              <Check
                                className="mr-2 h-3.5 w-3.5 opacity-0"
                                aria-hidden
                              />
                              {t.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        {t.description && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveTechnique(t.id)}
                      >
                        <X className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Remove {t.name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

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
        </>
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
