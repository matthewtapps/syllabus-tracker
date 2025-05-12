import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

  useEffect(() => {
    async function loadTechniques() {
      try {
        setLoading(true);
        const techniques = await getTechniquesForAssignment(studentId);
        setUnassignedTechniques(techniques);
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

  const filteredTechniques = unassignedTechniques.filter(
    technique => technique.name.toLowerCase().includes(filterText.toLowerCase())
  );

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
              <div className="mb-4">
                <Input
                  placeholder="Filter techniques..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {filteredTechniques.map(technique => (
                  <div key={technique.id} className="flex items-center space-x-2 p-2 border rounded">
                    <Checkbox
                      id={`technique-${technique.id}`}
                      checked={selectedTechniques.includes(technique.id)}
                      onCheckedChange={() => handleCheck(technique.id)}
                    />
                    <Label
                      htmlFor={`technique-${technique.id}`}
                      className="cursor-pointer flex-1"
                    >
                      {technique.name}
                    </Label>
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
