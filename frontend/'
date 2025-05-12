import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudents, type User } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function StudentsList() {
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function loadStudents() {
      try {
        setLoading(true);
        const data = await getStudents();
        setStudents(data);
        setError(null);
      } catch (err) {
        setError('Failed to load students. Please try again.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadStudents();
  }, []);

  const filteredStudents = students.filter(student =>
    (student.display_name?.toLowerCase() || student.username.toLowerCase()).includes(filter.toLowerCase())
  );

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center min-h-[50vh] text-red-500">{error}</div>;
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <h1 className="text-3xl font-bold mb-6">Students</h1>

      <div className="mb-6">
        <Input
          placeholder="Filter students..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="grid gap-4">
        {filteredStudents.length > 0 ? (
          filteredStudents.map(student => (
            <Card key={student.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/student/${student.id}`)}>
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{student.display_name || student.username}</div>
                    {student.display_name && <div className="text-sm text-muted-foreground">{student.username}</div>}
                  </div>
                  <Button variant="outline" size="sm" onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/student/${student.id}`);
                  }}>
                    View Techniques
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-center text-muted-foreground">No students found</div>
        )}
      </div>
    </div>
  );
}
