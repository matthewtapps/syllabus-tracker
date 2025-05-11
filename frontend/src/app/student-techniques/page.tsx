import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getStudentTechniques, updateTechnique } from '@/lib/api';
import type { Technique, StudentTechniques, TechniqueUpdate } from "@/lib/api";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import TechniqueEditForm from '@/components/technique-edit-form';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export default function StudentTechniques() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StudentTechniques | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTechnique, setEditingTechnique] = useState<Technique | null>(null);

  useEffect(() => {
    async function loadTechniques() {
      try {
        setLoading(true);
        const studentId = parseInt(id || '0', 10);
        const result = await getStudentTechniques(studentId);
        setData(result);
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

      // Update local state
      if (data) {
        const updatedTechniques = data.techniques.map((t: Technique) =>
          t.id === technique.id ? { ...t, ...updates } : t
        );

        setData({
          ...data,
          techniques: updatedTechniques
        });
      }

      toast(
        "Your changes have been saved successfully",
      );

      // Close edit form
      setEditingTechnique(null);
    } catch (err) {
      toast(
        "There was a problem updating the technique",
      );
    }
  };

  // UI for each status color
  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'red':
        return 'border-t-4 border-t-red-600 bg-red-50 dark:bg-red-950/30';
      case 'amber':
        return 'border-t-4 border-t-amber-500 bg-amber-50 dark:bg-amber-950/30';
      case 'green':
        return 'border-t-4 border-t-green-600 bg-green-50 dark:bg-green-950/30';
      default:
        return '';
    }
  };

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
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">
        {data.student.display_name || data.student.username}'s Techniques
      </h1>

      <div className="grid gap-6">
        {data.techniques.map((technique: Technique) => (
          <Card key={technique.id} className={`overflow-hidden ${getStatusStyles(technique.status)}`}>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value={`technique-${technique.id}`} className="border-none">
                <CardHeader className="p-4 pb-0">
                  <div className="flex justify-between items-center">
                    <AccordionTrigger className="hover:no-underline py-0">
                      <CardTitle>{technique.technique_name}</CardTitle>
                    </AccordionTrigger>

                    <Sheet>
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTechnique(technique);
                          }}
                        >
                          Edit
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Edit Technique</SheetTitle>
                          <SheetDescription>
                            Make changes to the technique below
                          </SheetDescription>
                        </SheetHeader>

                        {editingTechnique && (
                          <TechniqueEditForm
                            technique={editingTechnique}
                            canEditAll={data.can_edit_all_techniques}
                            onSubmit={(updates: TechniqueUpdate) => handleUpdate(editingTechnique, updates)}
                            onCancel={() => setEditingTechnique(null)}
                          />
                        )}
                      </SheetContent>
                    </Sheet>
                  </div>
                </CardHeader>

                <AccordionContent>
                  <CardContent className="p-4 pt-2">
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Description</h3>
                      <p className="mt-1">{technique.technique_description}</p>
                    </div>

                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Student Notes</h3>
                      <p className="mt-1">{technique.student_notes || "No notes yet"}</p>
                    </div>

                    <div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Coach Notes</h3>
                      <p className="mt-1">{technique.coach_notes || "No notes yet"}</p>
                    </div>
                  </CardContent>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        ))}
      </div>

      {data.can_assign_techniques && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Add Techniques</h2>
          {/* We'll implement this in the next step */}
          <Button>Add Techniques</Button>
        </div>
      )}
    </div>
  );
}
