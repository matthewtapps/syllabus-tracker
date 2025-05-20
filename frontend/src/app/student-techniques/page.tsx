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
  const [tempStudentNotes, setTempStudentNotes] = useState("");
  const [tempCoachNotes, setTempCoachNotes] = useState("");
  const [newTagInput, setNewTagInput] = useState("");

  // Add these new states for tag functionality
  const [filterText, setFilterText] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isAddingTag, setIsAddingTag] = useState<number | null>(null);
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

        // Extract all unique tags for filtering
        const uniqueTags = new Set<string>();
        result.techniques.forEach(technique => {
          technique.tags.forEach(tag => uniqueTags.add(tag.name));
        });
        setAvailableTags(Array.from(uniqueTags).sort());

        // Also load all possible tags for adding to techniques
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

  // Add function to toggle tags in filter
  const toggleTagFilter = (tagName: string) => {
    setTagFilter(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  // Add function to add a tag to a technique
  const handleAddTag = async (technique: Technique, tagId: number) => {
    try {
      // Find the tag from allTags
      const tagToAdd = allTags.find(t => t.id === tagId);
      if (!tagToAdd) return;

      // Check if technique already has this tag
      if (technique.tags.some(t => t.id === tagId)) {
        toast("This tag is already applied to this technique");
        return;
      }

      await addTagToTechnique(technique.technique_id, tagId);

      // Update local state
      if (data) {
        const updatedTechniques = data.techniques.map(t => {
          if (t.id === technique.id) {
            const updatedTags = [...t.tags, tagToAdd].sort((a, b) =>
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

        // Update available tags if needed
        if (!availableTags.includes(tagToAdd.name)) {
          setAvailableTags(prev => [...prev, tagToAdd.name].sort());
        }
      }

      setIsAddingTag(null);
      toast.success(`Added tag "${tagToAdd.name}" to technique`);
    } catch (err) {
      console.error('Failed to add tag', err);
      toast.error('Failed to add tag to technique');
    }
  };

  // Add function to remove a tag from a technique
  const handleRemoveTag = async (technique: Technique, tag: Tag) => {
    try {
      await removeTagFromTechnique(technique.technique_id, tag.id);

      // Update local state
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

        // Check if this was the last instance of this tag
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

  const handleCreateTag = async (tagName: string, techniqueId: number) => {
    try {
      const existingTags = await getAllTags();
      const existingTag = existingTags.find(
        t => t.name.toLowerCase() === tagName.toLowerCase()
      );

      if (existingTag) {
        await handleAddTag(
          data?.techniques.find(t => t.id === techniqueId)!,
          existingTag.id
        );
        return;
      }

      await createTag(tagName);

      const updatedTags = await getAllTags();
      setAllTags(updatedTags);

      const newTag = updatedTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());

      if (newTag) {
        const technique = data?.techniques.find(t => t.id === techniqueId);
        if (!technique) return;

        await addTagToTechnique(technique.technique_id, newTag.id);

        setData(prevData => {
          if (!prevData) return null;

          return {
            ...prevData,
            techniques: prevData.techniques.map(t => {
              if (t.id === techniqueId) {
                const updatedTags = [...t.tags, newTag].sort((a, b) =>
                  a.name.localeCompare(b.name)
                );
                return { ...t, tags: updatedTags };
              }
              return t;
            })
          };
        });

        if (!availableTags.includes(newTag.name)) {
          setAvailableTags(prev => [...prev, newTag.name].sort());
        }

        toast.success(`Added tag "${newTag.name}" to technique`);
      }
    } catch (err) {
      console.error('Failed to create and add tag', err);
      toast.error('Failed to create tag');
    }
  };

  const confirmTagRemoval = (technique: Technique, tag: Tag, e: React.MouseEvent) => {
    e.stopPropagation();
    setTagToRemove({ technique, tag });
    setIsRemoveTagDialogOpen(true);
  };

  // Execute the actual removal when confirmed
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

  // Add function to filter techniques
  const filteredTechniques = data?.techniques.filter(technique => {
    // Filter by text (name, description, or tag)
    const matchesText = filterText === "" ||
      technique.technique_name.toLowerCase().includes(filterText.toLowerCase()) ||
      technique.technique_description.toLowerCase().includes(filterText.toLowerCase()) ||
      technique.tags.some(tag => tag.name.toLowerCase().includes(filterText.toLowerCase()));

    // Filter by tags
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
                          <span>{technique.technique_name}</span>
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
                          {/* Tags Section - Now first */}
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
                                  <div className="relative flex items-center">
                                    <Input
                                      value={newTagInput}
                                      onChange={(e) => setNewTagInput(e.target.value)}
                                      placeholder="Tag name"
                                      className="text-xs h-7 px-2 py-1 w-40"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          // Find matching tag from allTags or create new one
                                          const existingTag = allTags.find(
                                            t => t.name.toLowerCase() === newTagInput.toLowerCase()
                                          );
                                          if (existingTag) {
                                            handleAddTag(technique, existingTag.id);
                                          } else if (newTagInput.trim()) {
                                            handleCreateTag(newTagInput.trim(), technique.id);
                                          }
                                          setIsAddingTag(null);
                                          setNewTagInput("");
                                        } else if (e.key === "Escape") {
                                          setIsAddingTag(null);
                                          setNewTagInput("");
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="absolute right-1 flex items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (newTagInput.trim()) {
                                            const existingTag = allTags.find(
                                              t => t.name.toLowerCase() === newTagInput.toLowerCase()
                                            );
                                            if (existingTag) {
                                              handleAddTag(technique, existingTag.id);
                                            } else {
                                              handleCreateTag(newTagInput.trim(), technique.id);
                                            }
                                          }
                                          setIsAddingTag(null);
                                          setNewTagInput("");
                                        }}
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
                                          setIsAddingTag(null);
                                          setNewTagInput("");
                                        }}
                                      >
                                        <XIcon className="h-3 w-3" />
                                      </Button>
                                    </div>

                                    {/* Tag suggestions - without "Press Enter" hint */}
                                    {newTagInput.trim() && (
                                      <div className="absolute left-0 top-full mt-1 w-full bg-popover rounded-md border shadow-md z-50 max-h-32 overflow-y-auto">
                                        {allTags
                                          .filter(tag =>
                                            tag.name.toLowerCase().includes(newTagInput.toLowerCase()) &&
                                            !technique.tags.some(t => t.id === tag.id)
                                          )
                                          .map(tag => (
                                            <div
                                              key={tag.id}
                                              className="px-2 py-1 text-xs hover:bg-muted cursor-pointer"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleAddTag(technique, tag.id);
                                                setIsAddingTag(null);
                                                setNewTagInput("");
                                              }}
                                            >
                                              {tag.name}
                                            </div>
                                          ))}
                                        {/* Removed the "Press Enter to create" hint */}
                                      </div>
                                    )}
                                  </div>
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
                                    if (editingCoachNotes !== technique.id) {
                                      setEditingCoachNotes(technique.id);
                                      setTempCoachNotes(technique.coach_notes);
                                    }
                                  }}
                                >
                                  <PencilIcon className="h-4 w-4" />
                                  <span className="sr-only">Edit coach notes</span>
                                </Button>
                              )}
                            </div>

                            {editingCoachNotes === technique.id ? (
                              <div className="space-y-2">
                                <Textarea
                                  value={tempCoachNotes}
                                  onChange={(e) => setTempCoachNotes(e.target.value)}
                                  className="min-h-[100px]"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCoachNotes(null);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await updateTechnique(technique.id, { coach_notes: tempCoachNotes });

                                        if (data) {
                                          const updatedTechniques = data.techniques.map((t: Technique) =>
                                            t.id === technique.id ? { ...t, coach_notes: tempCoachNotes } : t
                                          );
                                          setData({
                                            ...data,
                                            techniques: updatedTechniques
                                          });
                                        }

                                        toast.success("Coach notes updated");
                                        setEditingCoachNotes(null);
                                      } catch (err) {
                                        toast.error("Failed to update notes");
                                        console.error(err);
                                      }
                                    }}
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
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
                                    if (editingStudentNotes !== technique.id) {
                                      setEditingStudentNotes(technique.id);
                                      setTempStudentNotes(technique.student_notes);
                                    }
                                  }}
                                >
                                  <PencilIcon className="h-4 w-4" />
                                  <span className="sr-only">Edit student notes</span>
                                </Button>
                              )}
                            </div>

                            {editingStudentNotes === technique.id ? (
                              <div className="space-y-2">
                                <Textarea
                                  value={tempStudentNotes}
                                  onChange={(e) => setTempStudentNotes(e.target.value)}
                                  className="min-h-[100px]"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingStudentNotes(null);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await updateTechnique(technique.id, { student_notes: tempStudentNotes });

                                        if (data) {
                                          const updatedTechniques = data.techniques.map((t: Technique) =>
                                            t.id === technique.id ? { ...t, student_notes: tempStudentNotes } : t
                                          );
                                          setData({
                                            ...data,
                                            techniques: updatedTechniques
                                          });
                                        }

                                        toast.success("Student notes updated");
                                        setEditingStudentNotes(null);
                                      } catch (err) {
                                        toast.error("Failed to update notes");
                                        console.error(err);
                                      }
                                    }}
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap">{technique.student_notes || "No notes yet"}</p>
                            )}
                          </div>

                          {/* Description Section */}
                          <div className="mb-6">
                            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
                            <p className="whitespace-pre-wrap">{technique.technique_description}</p>
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
