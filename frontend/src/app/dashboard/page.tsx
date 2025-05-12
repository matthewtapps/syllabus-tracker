import type { User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

interface DashboardProps {
  user: User | null;
}

export default function Dashboard({ user }: DashboardProps) {
  const navigate = useNavigate();

  if (!user) {
    return <div>Loading...</div>;
  }

  const isCoach = user.role === 'coach' || user.role === 'Coach';
  const isAdmin = user.role === 'admin' || user.role === 'Admin';
  const isStudent = user.role === 'student' || user.role === 'Student';

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 md:py-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isStudent && (
          <Card>
            <CardHeader>
              <CardTitle>My Techniques</CardTitle>
              <CardDescription>View and manage your techniques</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Access your assigned techniques, update your progress and add notes.</p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => navigate(`/student/${user.id}`)}>View Techniques</Button>
            </CardFooter>
          </Card>
        )}

        {(isCoach || isAdmin) && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Students</CardTitle>
                <CardDescription>Manage student techniques</CardDescription>
              </CardHeader>
              <CardContent>
                <p>View all students, assign techniques, and track their progress.</p>
              </CardContent>
              <CardFooter>
                <Button onClick={() => navigate('/students')}>View Students</Button>
              </CardFooter>
            </Card>

            {/* <Card> */}
            {/*   <CardHeader> */}
            {/*     <CardTitle>Techniques</CardTitle> */}
            {/*     <CardDescription>Manage all techniques</CardDescription> */}
            {/*   </CardHeader> */}
            {/*   <CardContent> */}
            {/*     <p>Create, edit and organize the technique library.</p> */}
            {/*   </CardContent> */}
            {/*   <CardFooter> */}
            {/*     <Button onClick={() => navigate('/techniques')}>Manage Techniques</Button> */}
            {/*   </CardFooter> */}
            {/* </Card> */}
          </>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Administration</CardTitle>
              <CardDescription>System administration</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Manage users, roles, and system settings.</p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => navigate('/admin')}>Admin Panel</Button>
            </CardFooter>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>My Profile</CardTitle>
            <CardDescription>Update your profile</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Update your display name, password, and other settings.</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => navigate('/profile')}>Edit Profile</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
