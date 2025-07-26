import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addTagToTechnique, createTag, getAllTags, getStudentTechniques, removeTagFromTechnique, updateTechnique } from '@/lib/api';
import type { Technique, StudentTechniques, TechniqueUpdate, User, Tag } from "@/lib/api";
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import TechniqueEditForm from '@/components/technique-edit-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import AssignTechniques from '@/components/assign-techniques';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon, XIcon } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';
import { TracedForm } from '@/components/traced-form';

interface StudentNotesEditorProps {
  techniqueId: number;
  initialNotes: string;
  onSave: (notes: string) => void;
  onCancel: () => void;
}

function StudentNotesEditor({ techniqueId, initialNotes, onSave, onCancel }: StudentNotesEditorProps) {
  const form = useFormWithValidation<{ student_notes: string }>({
    defaultValues: { student_notes: initialNotes }
  });

  const handleSubmit = async (data: { student_notes: string }) => {
    const response = await updateTechnique(techniqueId, { student_notes: data.student_notes });

    if (!response.ok) {
      throw response;
    }

    onSave(data.student_notes);
  };

  return (
    <TracedForm
      id={`student_notes_${techniqueId}`}
      onSubmit={form.handleSubmit(handleSubmit)}
      setFieldErrors={form.setFieldErrors}
      className="space-y-2"
    >
      <Textarea
        {...form.register("student_notes")}
        className="min-h-[100px]"
        onClick={(e) => e.stopPropagation()}
        aria-invalid={!!form.formState.errors.student_notes}
      />
      {form.formState.errors.student_notes && (
        <p className="text-sm text-destructive mt-1">
          {String(form.formState.errors.student_notes.message || "Invalid notes")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </TracedForm>
  );
}

interface CoachNotesEditorProps {
  techniqueId: number;
  initialNotes: string;
  onSave: (notes: string) => void;
  onCancel: () => void;
}

function CoachNotesEditor({ techniqueId, initialNotes, onSave, onCancel }: CoachNotesEditorProps) {
  const form = useFormWithValidation<{ coach_notes: string }>({
    defaultValues: { coach_notes: initialNotes }
  });

  const handleSubmit = async (data: { coach_notes: string }) => {
    try {
      const response = await updateTechnique(techniqueId, { coach_notes: data.coach_notes });

      if (!response.ok) {
        throw response;
      }

      onSave(data.coach_notes);
    } catch (error) {
      throw error;
    }
  };

  return (
    <TracedForm
      id={`coach_notes_${techniqueId}`}
      onSubmit={form.handleSubmit(handleSubmit)}
      setFieldErrors={form.setFieldErrors}
      className="space-y-2"
    >
      <Textarea
        {...form.register("coach_notes")}
        className="min-h-[100px]"
        onClick={(e) => e.stopPropagation()}
        aria-invalid={!!form.formState.errors.coach_notes}
      />
      {form.formState.errors.coach_notes && (
        <p className="text-sm text-destructive mt-1">
          {String(form.formState.errors.coach_notes.message || "Invalid notes")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </TracedForm>
  );
}

interface TagEditorProps {
  techniqueId: number;
  allTags: Tag[];
  onTagAdded: (tag: Tag) => void;
  onCancel: () => void;
}

function TagEditor({ techniqueId, allTags, onTagAdded, onCancel }: TagEditorProps) {
  const form = useFormWithValidation<{ tag_name: string }>({
    defaultValues: { tag_name: '' }
  });

  const handleSubmit = async (data: { tag_name: string }) => {
    const existingTag = allTags.find(
      t => t.name.toLowerCase() === data.tag_name.toLowerCase()
    );

    if (existingTag) {
      const response = await addTagToTechnique(techniqueId, existingTag.id);
      if (!response.ok) throw response;
      onTagAdded(existingTag);
    } else if (data.tag_name.trim()) {
      const createResponse = await createTag(data.tag_name.trim());
      if (!createResponse.ok) throw createResponse;

      const updatedTags = await getAllTags();
      const newTag = updatedTags.find(t => t.name.toLowerCase() === data.tag_name.toLowerCase());
      if (newTag) {
        const addResponse = await addTagToTechnique(techniqueId, newTag.id);
        if (!addResponse.ok) throw addResponse;
        onTagAdded(newTag);
      }
    }
  };

  const watchedValue = form.watch("tag_name");

  return (
    <div className="relative flex items-center">
      <TracedForm
        id={`add_tag_${techniqueId}`}
        onSubmit={form.handleSubmit(handleSubmit)}
        setFieldErrors={form.setFieldErrors}
        className="flex items-center gap-1"
      >
        <Input
          {...form.register("tag_name")}
          placeholder="Tag name"
          className="text-xs h-7 px-2 py-1 w-40"
          autoFocus
          onClick={(e) => e.stopPropagation()}
          aria-invalid={!!form.formState.errors.tag_name}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-4 w-4 p-0"
          disabled={form.formState.isSubmitting}
        >
          <CheckIcon className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-4 w-4 p-0"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          <XIcon className="h-3 w-3" />
        </Button>
      </TracedForm>

      {/* Tag suggestions */}
      {watchedValue.trim() && (
        <div className="absolute left-0 top-full mt-1 w-full bg-popover rounded-md border shadow-md z-50 max-h-32 overflow-y-auto">
          {allTags
            .filter(tag =>
              tag.name.toLowerCase().includes(watchedValue.toLowerCase())
            )
            .map(tag => (
              <div
                key={tag.id}
                className="px-2 py-1 text-xs hover:bg-muted cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  form.setValue("tag_name", tag.name);
                  form.handleSubmit(handleSubmit)();
                }}
              >
                {tag.name}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

interface StudentTechniquesProps {
  user: User
}



export default function StudentTechniques({ user }: StudentTechniquesProps) {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StudentTechniques | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTechnique, setEditingTechnique] = useState<Technique | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<number[]>([]);

  const [editingStudentNotes, setEditingStudentNotes] = useState<number | null>(null);
  const [editingCoachNotes, setEditingCoachNotes] = useState<number | null>(null);
  const [isAddingTag, setIsAddingTag] = useState<number | null>(null);

  const [filterText, setFilterText] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagToRemove, setTagToRemove] = useState<{ technique: Technique, tag: Tag } | null>(null);
  const [isRemoveTagDialogOpen, setIsRemoveTagDialogOpen] = useState(false);

  const toggleRow = (techniqueId: number) => {
    if (expandedRows.includes(techniqueId)) {
      setExpandedRows(expandedRows.filter(id => id !== techniqueId));
    } else {
      setExpandedRows([...expandedRows, techniqueId]);
    }
  };

  useEffect(() => {
    async function loadTechniques() {
      try {
        setLoading(true);
        const studentId = parseInt(id || '0', 10);
        const result = await getStudentTechniques(studentId);
        setData(result);

        const uniqueTags = new Set<string>();
        result.techniques.forEach(technique => {
          technique.tags.forEach(tag => uniqueTags.add(tag.name));
        });
        setAvailableTags(Array.from(uniqueTags).sort());

        const tagsResult = await getAllTags();
        setAllTags(tagsResult);

        setError(null);
      } catch (err) {
        setError('Failed to load techniques. Please try again.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadTechniques();
  }, [id]);

  const handleUpdate = async (technique: Technique, updates: any) => {
    try {
      await updateTechnique(technique.id, updates);

      if (data) {
        const updatedTechniques = data.techniques.map((t: Technique) =>
          t.id === technique.id ? { ...t, ...updates } : t
        );

        setData({
          ...data,
          techniques: updatedTechniques
        });
      }

      toast("Your changes have been saved successfully");

      setEditingTechnique(null);
      setIsEditDialogOpen(false);
    } catch (err) {
      toast("There was a problem updating the technique");
    }
  };

  const handleNotesUpdate = (techniqueId: number, field: 'student_notes' | 'coach_notes', newNotes: string) => {
    if (data) {
      const updatedTechniques = data.techniques.map((t: Technique) =>
        t.id === techniqueId ? { ...t, [field]: newNotes } : t
      );

      setData({
        ...data,
        techniques: updatedTechniques
      });
    }

    toast.success("Notes updated successfully");

    if (field === 'student_notes') {
      setEditingStudentNotes(null);
    } else {
      setEditingCoachNotes(null);
    }
  };

  const handleTagAdded = (techniqueId: number, tag: Tag) => {
    if (data) {
      const updatedTechniques = data.techniques.map(t => {
        if (t.id === techniqueId) {
          const updatedTags = [...t.tags, tag].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          return { ...t, tags: updatedTags };
        }
        return t;
      });

      setData({
        ...data,
        techniques: updatedTechniques
      });

      if (!availableTags.includes(tag.name)) {
        setAvailableTags(prev => [...prev, tag.name].sort());
      }
    }

    setIsAddingTag(null);
    toast.success(`Added tag "${tag.name}" to technique`);
  };

  const toggleTagFilter = (tagName: string) => {
    setTagFilter(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const handleRemoveTag = async (technique: Technique, tag: Tag) => {
    try {
      await removeTagFromTechnique(technique.technique_id, tag.id);

      if (data) {
        const updatedTechniques = data.techniques.map(t => {
          if (t.id === technique.id) {
            return {
              ...t,
              tags: t.tags.filter(existingTag => existingTag.id !== tag.id)
            };
          }
          return t;
        });

        setData({
          ...data,
          techniques: updatedTechniques
        });

        const tagStillExists = updatedTechniques.some(t =>
          t.tags.some(t => t.name === tag.name)
        );

        if (!tagStillExists) {
          setAvailableTags(prev => prev.filter(t => t !== tag.name));
          setTagFilter(prev => prev.filter(t => t !== tag.name));
        }
      }

      toast.success(`Removed tag "${tag.name}" from technique`);
    } catch (err) {
      console.error('Failed to remove tag', err);
      toast.error('Failed to remove tag from technique');
    }
  };

  const confirmTagRemoval = (technique: Technique, tag: Tag, e: React.MouseEvent) => {
    e.stopPropagation();
    setTagToRemove({ technique, tag });
    setIsRemoveTagDialogOpen(true);
  };

  const executeTagRemoval = async () => {
    if (!tagToRemove) return;

    try {
      await handleRemoveTag(tagToRemove.technique, tagToRemove.tag);
    } finally {
      setIsRemoveTagDialogOpen(false);
      setTagToRemove(null);
    }
  };

  const getStatusBgStyles = (status: string) => {
    switch (status) {
      case 'red':
        return '';
      case 'amber':
        return 'bg-amber-50 dark:bg-amber-950/30';
      case 'green':
        return 'bg-green-50 dark:bg-green-950/30';
      default:
        return '';
    }
  };

  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'red':
        return '!border-l-muted-foreground/20';
      case 'amber':
        return '!border-l-amber-500';
      case 'green':
        return '!border-l-green-600';
      default:
        return '!border-l-muted-foreground/20';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(date);
    } catch (e) {
      return dateString;
    }
  };

  const filteredTechniques = data?.techniques.filter(technique => {
    const matchesText = filterText === "" ||
      technique.technique_name.toLowerCase().includes(filterText.toLowerCase()) ||
      technique.technique_description.toLowerCase().includes(filterText.toLowerCase()) ||
      technique.tags.some(tag => tag.name.toLowerCase().includes(filterText.toLowerCase()));

    const matchesTags = tagFilter.length === 0 ||
      tagFilter.every(tag => technique.tags.some(t => t.name === tag));

    return matchesText && matchesTags;
  }) || [];

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center min-h-screen text-red-500">{error}</div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center min-h-screen">No data available</div>;
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <h1 className="text-3xl font-bold mb-6">
        {data.student.display_name || data.student.username}'s Techniques
      </h1>

      {/* Add filter controls */}
      <div className="mb-6 space-y-4">
        <Input
          placeholder="Filter by technique name, description or tag..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="max-w-lg"
        />

        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Filter by tag:</span>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map(tag => (
                <Badge
                  variant={tagFilter.includes(tag) ? "default" : "outline"}
                  key={tag}
                  className="cursor-pointer"
                  onClick={() => toggleTagFilter(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <CardContent className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-3/4 py-5 text-base font-medium">Technique Name</TableHead>
                <TableHead className="w-1/4 text-right py-5 text-base font-medium">Last Updated</TableHead>
                <TableHead className="w-10 py-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTechniques.length > 0 ? (
                filteredTechniques.map((technique: Technique) => (
                  <React.Fragment key={technique.id}>
                    <TableRow
                      className={`[&>*]:transition-all [&>*]:duration-300 ${expandedRows.includes(technique.id) ? "bg-muted/20 [&>*]:py-4" : "[&>*]:py-2"
                        } ${getStatusBgStyles(technique.status)} !border-l-4 ${getStatusBorderColor(technique.status)}`}
                      onClick={() => toggleRow(technique.id)}
                    >
                      <TableCell className="py-4 font-medium">
                        <div className="flex flex-col">
                          <span className="text-wrap">{technique.technique_name}</span>
                          {/* Only show tags in the collapsed row if the row isn't expanded */}
                          {technique.tags.length > 0 && !expandedRows.includes(technique.id) && (
                            <div className="flex gap-1 flex-wrap mt-2">
                              {technique.tags.slice(0, 3).map(tag => (
                                <Badge key={tag.id} className="text-xs" variant={tagFilter.includes(tag.name) ? "default" : "outline"}>
                                  {tag.name}
                                </Badge>
                              ))}
                              {technique.tags.length > 3 && (
                                <Badge className="text-xs" variant='outline' >
                                  +{technique.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 text-right text-sm text-muted-foreground">
                        {formatDate(technique.updated_at)}
                      </TableCell>
                      <TableCell className="w-10 p-0 pr-4">
                        <Button variant="ghost" size="icon" onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(technique.id);
                        }}>
                          {expandedRows.includes(technique.id) ? (
                            <ChevronUpIcon className="h-4 w-4" />
                          ) : (
                            <ChevronDownIcon className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>

                    {expandedRows.includes(technique.id) && (
                      <TableRow className={`!border-l-4 ${getStatusBorderColor(technique.status)}`} >
                        <TableCell colSpan={3} >
                          {(data.can_edit_all_techniques) && (
                            <div className="mb-6">
                              <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</h3>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant={technique.status === 'red' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (technique.status !== 'red') {
                                        await updateTechnique(technique.id, { status: 'red' });
                                        if (data) {
                                          const updatedTechniques = data.techniques.map((t) =>
                                            t.id === technique.id ? { ...t, status: 'red' as const } : t
                                          );
                                          setData({
                                            ...data,
                                            techniques: updatedTechniques
                                          });
                                        }
                                        toast.success("Status updated to Not Started");
                                      }
                                    }}
                                  >
                                    New
                                  </Button>
                                  <Button
                                    variant={technique.status === 'amber' ? 'default' : 'outline'}
                                    size="sm"
                                    className="bg-amber-500 hover:bg-amber-600 data-[state=outline]:bg-transparent data-[state=outline]:text-amber-500 data-[state=outline]:hover:bg-amber-50 dark:data-[state=outline]:hover:bg-amber-950/20"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (technique.status !== 'amber') {
                                        await updateTechnique(technique.id, { status: 'amber' });
                                        if (data) {
                                          const updatedTechniques = data.techniques.map((t) =>
                                            t.id === technique.id ? { ...t, status: 'amber' as const } : t
                                          );
                                          setData({
                                            ...data,
                                            techniques: updatedTechniques
                                          });
                                        }
                                        toast.success("Status updated to In Progress");
                                      }
                                    }}
                                  >
                                    Doing
                                  </Button>
                                  <Button
                                    variant={technique.status === 'green' ? 'default' : 'outline'}
                                    size="sm"
                                    className="bg-green-500 hover:bg-green-600 data-[state=outline]:bg-transparent data-[state=outline]:text-green-500 data-[state=outline]:hover:bg-green-50 dark:data-[state=outline]:hover:bg-green-950/20"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (technique.status !== 'green') {
                                        await updateTechnique(technique.id, { status: 'green' });
                                        if (data) {
                                          const updatedTechniques = data.techniques.map((t) =>
                                            t.id === technique.id ? { ...t, status: 'green' as const } : t
                                          );
                                          setData({
                                            ...data,
                                            techniques: updatedTechniques
                                          });
                                        }
                                        toast.success("Status updated to Completed");
                                      }
                                    }}
                                  >
                                    Done
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Coach Notes Section */}
                          <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Coach Notes</h3>
                              {data.can_edit_all_techniques && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCoachNotes(technique.id);
                                  }}
                                >
                                  <PencilIcon className="h-4 w-4" />
                                  <span className="sr-only">Edit coach notes</span>
                                </Button>
                              )}
                            </div>

                            {editingCoachNotes === technique.id ? (
                              <CoachNotesEditor
                                techniqueId={technique.id}
                                initialNotes={technique.coach_notes}
                                onSave={(notes) => handleNotesUpdate(technique.id, 'coach_notes', notes)}
                                onCancel={() => setEditingCoachNotes(null)}
                              />
                            ) : (
                              <p className="whitespace-pre-wrap">{technique.coach_notes || "No notes yet"}</p>
                            )}
                          </div>

                          {/* Student Notes Section */}
                          <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Student Notes</h3>
                              {(user?.id === data.student.id || data.can_edit_all_techniques) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingStudentNotes(technique.id);
                                  }}
                                >
                                  <PencilIcon className="h-4 w-4" />
                                  <span className="sr-only">Edit student notes</span>
                                </Button>
                              )}
                            </div>

                            {editingStudentNotes === technique.id ? (
                              <StudentNotesEditor
                                techniqueId={technique.id}
                                initialNotes={technique.student_notes}
                                onSave={(notes) => handleNotesUpdate(technique.id, 'student_notes', notes)}
                                onCancel={() => setEditingStudentNotes(null)}
                              />
                            ) : (
                              <p className="whitespace-pre-wrap">{technique.student_notes || "No notes yet"}</p>
                            )}
                          </div>

                          {/* Description Section */}
                          <div className="mb-6">
                            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
                            <p className="whitespace-pre-wrap">{technique.technique_description}</p>
                          </div>

                          <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Tags</h3>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              {technique.tags.map(tag => (
                                <Badge
                                  key={tag.id}
                                  className="text-xs flex items-center gap-1"
                                >
                                  {tag.name}
                                  {(data.can_edit_all_techniques || data.can_manage_tags) && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-3 w-3 p-0 rounded-full opacity-70 hover:opacity-100"
                                      onClick={(e) => confirmTagRemoval(technique, tag, e)}
                                    >
                                      <XIcon className="h-2 w-2" />
                                      <span className="sr-only">Remove tag</span>
                                    </Button>
                                  )}
                                </Badge>
                              ))}

                              {/* "+" Tag for adding new tags */}
                              {(data.can_edit_all_techniques || data.can_manage_tags) && (
                                isAddingTag === technique.id ? (
                                  <TagEditor
                                    techniqueId={technique.technique_id}
                                    allTags={allTags}
                                    onTagAdded={(tag) => handleTagAdded(technique.id, tag)}
                                    onCancel={() => setIsAddingTag(null)}
                                  />
                                ) : (
                                  <Badge
                                    variant='outline'
                                    className="text-xs cursor-pointer flex items-center gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsAddingTag(technique.id);
                                    }}
                                  >
                                    <PlusIcon className="h-3 w-3" />
                                    <span>Add</span>
                                  </Badge>
                                )
                              )}
                            </div>
                          </div>

                          {/* Edit Technique Button */}
                          <div className="mt-4">
                            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingTechnique(technique);
                                    setIsEditDialogOpen(true);
                                  }}
                                >
                                  Edit Technique
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="w-[95vw] max-w-[600px] max-h-[80vh] overflow-y-auto p-4 sm:p-6">
                                <DialogHeader>
                                  <DialogTitle>Edit Technique</DialogTitle>
                                  <DialogDescription>
                                    Make changes to the technique below
                                  </DialogDescription>
                                </DialogHeader>

                                {editingTechnique && (
                                  <TechniqueEditForm
                                    technique={editingTechnique}
                                    canEditAll={data.can_edit_all_techniques}
                                    currentUserId={user?.id || 0}
                                    studentId={data.student.id}
                                    onSubmit={(updates: TechniqueUpdate) => handleUpdate(editingTechnique, updates)}
                                  />
                                )}
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    {filterText || tagFilter.length > 0
                      ? "No techniques match your filters"
                      : "No techniques found"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.can_assign_techniques && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Add Techniques</h2>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                Add Techniques
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-[600px] max-h-[80vh] overflow-y-auto p-4 sm:p-6">
              <DialogHeader>
                <DialogTitle>Add Techniques</DialogTitle>
                <DialogDescription>
                  Assign existing techniques or create new ones for {data.student.display_name || data.student.username}.
                </DialogDescription>
              </DialogHeader>
              <AssignTechniques
                studentId={data.student.id}
                canCreateTechniques={data.can_create_techniques}
                onAssignComplete={() => {
                  getStudentTechniques(parseInt(id || '0', 10)).then(result => {
                    setData(result);
                    setIsAddDialogOpen(false);
                  });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Dialog open={isRemoveTagDialogOpen} onOpenChange={setIsRemoveTagDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Tag</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove the tag "{tagToRemove?.tag.name}" from this technique?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsRemoveTagDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={executeTagRemoval}
            >
              Remove Tag
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
