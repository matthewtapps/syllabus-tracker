import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getTechniquesForAssignment, assignTechniquesToStudent, createAndAssignTechnique } from '@/lib/api';

interface AssignTechniquesProps {
  studentId: number;
  canCreateTechniques: boolean;
  onAssignComplete: () => void;
}

export default function AssignTechniques({
  studentId,
  canCreateTechniques,
  onAssignComplete
}: AssignTechniquesProps) {
  const [unassignedTechniques, setUnassignedTechniques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTechniques, setSelectedTechniques] = useState<number[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTechniqueName, setNewTechniqueName] = useState('');
  const [newTechniqueDescription, setNewTechniqueDescription] = useState('');
  const [filterText, setFilterText] = useState('');

  // Add these new states for tag filtering
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    async function loadTechniques() {
      try {
        setLoading(true);
        const techniques = await getTechniquesForAssignment(studentId);
        setUnassignedTechniques(techniques);

        // Extract all unique tags
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
    setSelectedTechniques(prev =>
      prev.includes(id)
        ? prev.filter(t => t !== id)
        : [...prev, id]
    );
  };

  const handleAssignTechniques = async () => {
    try {
      if (selectedTechniques.length === 0) return;

      await assignTechniquesToStudent(studentId, selectedTechniques);
      setSelectedTechniques([]);
      onAssignComplete();
    } catch (err) {
      setError('Failed to assign techniques.');
      console.error(err);
    }
  };

  const handleCreateTechnique = async () => {
    try {
      if (!newTechniqueName.trim() || !newTechniqueDescription.trim()) return;

      await createAndAssignTechnique(
        studentId,
        newTechniqueName,
        newTechniqueDescription
      );

      setNewTechniqueName('');
      setNewTechniqueDescription('');
      setShowCreateForm(false);
      onAssignComplete();
    } catch (err) {
      setError('Failed to create technique.');
      console.error(err);
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

  // Add function to select/deselect all visible techniques
  const selectAllVisible = () => {
    const visibleIds = filteredTechniques.map(t => t.id);
    setSelectedTechniques(prev => {
      const newSelection = [...prev];
      visibleIds.forEach(id => {
        if (!newSelection.includes(id)) {
          newSelection.push(id);
        }
      });
      return newSelection;
    });
  };

  const deselectAllVisible = () => {
    const visibleIds = filteredTechniques.map(t => t.id);
    setSelectedTechniques(prev => prev.filter(id => !visibleIds.includes(id)));
  };

  // Update filtering logic
  const filteredTechniques = unassignedTechniques.filter(technique => {
    // Filter by search text
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
            <>
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
                      variant="outline"
                      size="sm"
                      onClick={selectAllVisible}
                      disabled={filteredTechniques.length === 0}
                      className="flex-1"
                    >
                      Select All Visible
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={deselectAllVisible}
                      disabled={filteredTechniques.length === 0 ||
                        !filteredTechniques.some(t => selectedTechniques.includes(t.id))}
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
                      checked={selectedTechniques.includes(technique.id)}
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
            </>
          ) : (
            <p>No unassigned techniques available.</p>
          )}
        </CardContent>
        {unassignedTechniques.length > 0 && (
          <CardFooter>
            <Button
              onClick={handleAssignTechniques}
              disabled={selectedTechniques.length === 0}
            >
              Assign Selected Techniques
              {selectedTechniques.length > 0 && ` (${selectedTechniques.length})`}
            </Button>
          </CardFooter>
        )}
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
              <div className="space-y-4">
                <div>
                  <Label htmlFor="new-technique-name" className="mb-2">Technique Name</Label>
                  <Input
                    id="new-technique-name"
                    value={newTechniqueName}
                    onChange={(e) => setNewTechniqueName(e.target.value)}
                    placeholder="Enter technique name"
                  />
                </div>
                <div>
                  <Label htmlFor="new-technique-description" className="mb-2">Description</Label>
                  <Textarea
                    id="new-technique-description"
                    value={newTechniqueDescription}
                    onChange={(e) => setNewTechniqueDescription(e.target.value)}
                    placeholder="Enter technique description"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Button onClick={handleCreateTechnique}>
                    Create & Assign
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
