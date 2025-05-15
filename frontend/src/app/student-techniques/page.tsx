import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getStudentTechniques, updateTechnique } from '@/lib/api';
import type { Technique, StudentTechniques, TechniqueUpdate, User } from "@/lib/api";
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
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

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

  // Function to toggle row expansion
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

  const getStatusBgStyles = (status: string) => {
    switch (status) {
      case 'red':
        return ''; // No background for 'red' status
      case 'amber':
        return 'bg-amber-50 dark:bg-amber-950/30';
      case 'green':
        return 'bg-green-50 dark:bg-green-950/30';
      default:
        return '';
    }
  };

  // Get border color based on status
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

  // Format date to a more readable format
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

      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-3/4 py-5 text-base font-medium">Technique Name</TableHead>
                <TableHead className="w-1/4 text-right py-5 text-base font-medium">Last Updated</TableHead>
                <TableHead className="w-10 py-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.techniques.map((technique: Technique) => (
                <React.Fragment key={technique.id}>
                  <TableRow
                    className={`hover:cursor-pointer [&>*]:transition-all [&>*]:duration-500 ${expandedRows.includes(technique.id) ? "bg-muted/20" : ""
                      } ${getStatusBgStyles(technique.status)} !border-l-4 ${getStatusBorderColor(technique.status)}`}
                    onClick={() => toggleRow(technique.id)}
                  >
                    <TableCell className="py-4 font-medium">{technique.technique_name}</TableCell>
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
                    <TableRow
                      className={`!border-l-4 ${getStatusBorderColor(technique.status)}`}
                    >
                      <TableCell
                        colSpan={3}
                        className={`p-6 animate-in slide-in-from-top-2 duration-500`}
                      >
                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
                          <p className="whitespace-pre-wrap">{technique.technique_description}</p>
                        </div>

                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Student Notes</h3>
                          <p className="whitespace-pre-wrap">{technique.student_notes || "No notes yet"}</p>
                        </div>

                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Coach Notes</h3>
                          <p className="whitespace-pre-wrap">{technique.coach_notes || "No notes yet"}</p>
                        </div>

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
              ))}
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
                    setIsAddDialogOpen(false); // Close the dialog after success
                  });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
