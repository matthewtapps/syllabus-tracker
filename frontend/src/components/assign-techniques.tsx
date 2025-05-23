import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getTechniquesForAssignment, assignTechniquesToStudent, createAndAssignTechnique } from '@/lib/api';
import { useFormWithValidation } from './hooks/useFormErrors';
import { TracedForm } from './traced-form';

interface AssignTechniquesProps {
  studentId: number;
  canCreateTechniques: boolean;
  onAssignComplete: () => void;
}

interface CreateTechniqueFormValues {
  name: string;
  description: string;
}

interface AssignTechniquesFormValues {
  selected_technique_ids: number[];
}

export default function AssignTechniques({
  studentId,
  canCreateTechniques,
  onAssignComplete
}: AssignTechniquesProps) {
  const [unassignedTechniques, setUnassignedTechniques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filterText, setFilterText] = useState('');

  // Add these new states for tag filtering
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  const createTechniqueForm = useFormWithValidation<CreateTechniqueFormValues>({
    defaultValues: {
      name: '',
      description: ''
    }
  });

  const assignForm = useFormWithValidation<AssignTechniquesFormValues>({
    defaultValues: {
      selected_technique_ids: []
    }
  });

  useEffect(() => {
    async function loadTechniques() {
      try {
        setLoading(true);
        const techniques = await getTechniquesForAssignment(studentId);
        setUnassignedTechniques(techniques);

        const uniqueTags = new Set<string>();
        techniques.forEach((technique: any) => {
          if (technique.tags) {
            technique.tags.forEach((tag: any) => uniqueTags.add(tag.name));
          }
        });
        setAvailableTags(Array.from(uniqueTags).sort());

        setError(null);
      } catch (err) {
        setError('Failed to load available techniques.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadTechniques();
  }, [studentId]);

  const handleCheck = (id: number) => {
    const currentSelected = assignForm.watch("selected_technique_ids");
    const newSelected = currentSelected.includes(id)
      ? currentSelected.filter(t => t !== id)
      : [...currentSelected, id];

    assignForm.setValue("selected_technique_ids", newSelected);
  };

  const handleAssignTechniques = async (data: AssignTechniquesFormValues) => {
    if (data.selected_technique_ids.length === 0) return;

    const response = await assignTechniquesToStudent(studentId, data.selected_technique_ids);

    if (!response.ok) {
      throw response;
    }

    assignForm.reset();
    onAssignComplete();
  };

  const handleCreateTechnique = async (data: CreateTechniqueFormValues) => {
    if (!data.name.trim() || !data.description.trim()) return;

    const response = await createAndAssignTechnique(
      studentId,
      data.name,
      data.description
    );

    if (!response.ok) {
      throw response;
    }

    createTechniqueForm.reset();
    setShowCreateForm(false);
    onAssignComplete();
  };

  const toggleTagFilter = (tagName: string) => {
    setTagFilter(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const selectAllVisible = () => {
    const visibleIds = filteredTechniques.map(t => t.id);
    const currentSelected = assignForm.watch("selected_technique_ids");
    const newSelection = [...new Set([...currentSelected, ...visibleIds])];
    assignForm.setValue("selected_technique_ids", newSelection);
  };

  const deselectAllVisible = () => {
    const visibleIds = filteredTechniques.map(t => t.id);
    const currentSelected = assignForm.watch("selected_technique_ids");
    const newSelection = currentSelected.filter(id => !visibleIds.includes(id));
    assignForm.setValue("selected_technique_ids", newSelection);
  };

  const filteredTechniques = unassignedTechniques.filter(technique => {
    const matchesText =
      !filterText ||
      technique.name.toLowerCase().includes(filterText.toLowerCase()) ||
      technique.description.toLowerCase().includes(filterText.toLowerCase()) ||
      (technique.tags && technique.tags.some((tag: any) =>
        tag.name.toLowerCase().includes(filterText.toLowerCase())
      ));

    // Filter by selected tags
    const matchesTags =
      tagFilter.length === 0 ||
      tagFilter.every(tag =>
        technique.tags && technique.tags.some((t: any) => t.name === tag)
      );

    return matchesText && matchesTags;
  });

  if (loading) {
    return <div>Loading available techniques...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Assign Existing Techniques</CardTitle>
        </CardHeader>
        <CardContent>
          {unassignedTechniques.length > 0 ? (
            <TracedForm
              id="assign_techniques"
              onSubmit={assignForm.handleSubmit(handleAssignTechniques)}
              setFieldErrors={assignForm.setFieldErrors}
              className="space-y-4"
            >
              <div className="mb-4 space-y-3">
                <Input
                  placeholder="Filter techniques..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />

                {/* Tag filters */}
                {availableTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-sm text-muted-foreground">Filter by tag:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map(tag => (
                        <Badge
                          key={tag}
                          variant={tagFilter.includes(tag) ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => toggleTagFilter(tag)}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Select/Deselect buttons */}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAllVisible}
                      disabled={filteredTechniques.length === 0}
                      className="flex-1"
                    >
                      Select All Visible
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={deselectAllVisible}
                      disabled={filteredTechniques.length === 0 ||
                        !filteredTechniques.some(t => assignForm.getValues('selected_technique_ids').includes(t.id))}
                      className="flex-1"
                    >
                      Deselect All Visible
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {filteredTechniques.length} of {unassignedTechniques.length} techniques
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {filteredTechniques.map(technique => (
                  <div key={technique.id} className="flex items-center space-x-2 p-2 border rounded">
                    <Checkbox
                      id={`technique-${technique.id}`}
                      checked={assignForm.getValues('selected_technique_ids').includes(technique.id)}
                      onCheckedChange={() => handleCheck(technique.id)}
                    />
                    <div>
                      <Label
                        htmlFor={`technique-${technique.id}`}
                        className="cursor-pointer flex-1"
                      >
                        {technique.name}
                      </Label>

                      {/* Display tags */}
                      {technique.tags && technique.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {technique.tags.map((tag: any) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="text-xs px-1.5 py-0 h-5"
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Submit button */}
              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  disabled={assignForm.getValues('selected_technique_ids').length === 0 || assignForm.formState.isSubmitting}
                >
                  {assignForm.formState.isSubmitting ? "Assigning..." : "Assign Selected Techniques"}
                  {assignForm.getValues('selected_technique_ids').length > 0 && ` (${assignForm.getValues('selected_technique_ids').length})`}
                </Button>
              </div>
            </TracedForm>
          ) : (
            <p>No unassigned techniques available.</p>
          )}
        </CardContent>
      </Card>

      {canCreateTechniques && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Technique</CardTitle>
          </CardHeader>
          <CardContent>
            {!showCreateForm ? (
              <Button variant="outline" onClick={() => setShowCreateForm(true)}>
                Create New Technique
              </Button>
            ) : (
              <TracedForm
                id="create_technique"
                onSubmit={createTechniqueForm.handleSubmit(handleCreateTechnique)}
                setFieldErrors={createTechniqueForm.setFieldErrors}
                className="space-y-4"
              >
                <div>
                  <Label htmlFor="new-technique-name" className="mb-2">Technique Name</Label>
                  <Input
                    id="new-technique-name"
                    {...createTechniqueForm.register("name")}
                    placeholder="Enter technique name"
                    aria-invalid={!!createTechniqueForm.formState.errors.name}
                  />
                  {createTechniqueForm.formState.errors.name && (
                    <p className="text-sm text-destructive mt-1">
                      {String(createTechniqueForm.formState.errors.name.message || "Technique name is required")}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="new-technique-description" className="mb-2">Description</Label>
                  <Textarea
                    id="new-technique-description"
                    {...createTechniqueForm.register("description")}
                    placeholder="Enter technique description"
                    aria-invalid={!!createTechniqueForm.formState.errors.description}
                  />
                  {createTechniqueForm.formState.errors.description && (
                    <p className="text-sm text-destructive mt-1">
                      {String(createTechniqueForm.formState.errors.description.message || "Description is required")}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    type="submit"
                    disabled={createTechniqueForm.formState.isSubmitting}
                  >
                    {createTechniqueForm.formState.isSubmitting ? "Creating..." : "Create & Assign"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </TracedForm>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
