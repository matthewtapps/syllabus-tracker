import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudents, type User } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronRightIcon, Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export default function StudentsList() {
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<string>('recent_update'); // Default sort is by recent activity
  const navigate = useNavigate();

  useEffect(() => {
    loadStudents();
  }, [sortBy]);

  async function loadStudents() {
    try {
      setLoading(true);
      const sortParam = sortBy === 'recent_update' ? 'recent_update' : undefined;
      const data = await getStudents(sortParam);
      setStudents(data);
      setError(null);
    } catch (err) {
      setError('Failed to load students. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  let filteredStudents = students.filter(student =>
    !student.archived &&
    (student.display_name?.toLowerCase() || student.username.toLowerCase()).includes(filter.toLowerCase())
  );

  if (sortBy === 'alphabetical') {
    filteredStudents = [...filteredStudents].sort((a, b) => {
      const nameA = a.display_name || a.username;
      const nameB = b.display_name || b.username;
      return nameA.localeCompare(nameB);
    });
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'No activity';

    try {
      const date = new Date(dateString);

      if (isNaN(date.getTime())) {
        return 'No activity';
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString();
      }
    } catch (e) {
      return 'No activity';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center min-h-[50vh] text-red-500">{error}</div>;
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <h1 className="text-3xl font-bold mb-6">Students</h1>

      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <Input
          placeholder="Filter students..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />

        <Select
          value={sortBy}
          onValueChange={setSortBy}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent_update">Recently active</SelectItem>
            <SelectItem value="alphabetical">Alphabetical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {filteredStudents.length > 0 ? (
          <div className="divide-y">
            {filteredStudents.map(student => (
              <div
                key={student.id}
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => navigate(`/student/${student.id}`)}
              >
                <div className="flex flex-col gap-1">
                  <div className="font-medium">{student.display_name || student.username}</div>
                  {student.display_name && <div className="text-sm text-muted-foreground">{student.username}</div>}
                </div>

                <div className="flex items-center gap-2">
                  {sortBy === 'recent_update' && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mr-2">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{formatDate(student.last_update)}</span>
                    </div>
                  )}
                  <Button variant="ghost" size="icon" className="text-muted-foreground">
                    <ChevronRightIcon className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground p-8">No students found</div>
        )}
      </div>
    </div>
  );
}
