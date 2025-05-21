import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { registerUser, type User } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

interface RegisterUserPageProps {
  user: User
};

interface RegistrationFormValues {
  username: string;
  display_name: string;
  password: string;
  confirm_password: string;
  role: string;
}

export default function RegisterUserPage({ user }: RegisterUserPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const form = useFormWithValidation<RegistrationFormValues>({
    defaultValues: {
      username: '',
      display_name: '',
      password: '',
      confirm_password: '',
      role: 'student'
    }
  });

  const handleSubmit = async (data: RegistrationFormValues) => {
    setIsSubmitting(true);

    try {
      const response = await registerUser(data);
      if (!response.ok) {
        const errorData = await response.json();

        if (errorData.status === 'error' && errorData.errors) {
          // Set field errors
          form.setFieldErrors(errorData.errors);

          // Show first error as toast
          const firstErrorField = Object.keys(errorData.errors)[0];
          const firstErrorMessage = errorData.errors[firstErrorField][0];
          toast.error(`${firstErrorField}: ${firstErrorMessage}`);

          throw new Error('Validation failed');
        } else {
          throw new Error('Registration failed');
        }
      }

      toast.success('User registered successfully');

      form.reset();

      // Redirect to students list if it was a student
      if (data.role === 'student') {
        navigate('/students');
      }
    } catch (err) {
      console.error('Registration error:', err);

      // Only show a generic error if it's not a validation error
      if (!(err instanceof Error && err.message === 'Validation failed')) {
        toast.error('Failed to register user');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'Admin';

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">Register New User</h1>

      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Create Account</CardTitle>
            <CardDescription>Add a new user to the system</CardDescription>
          </CardHeader>
          <TracedForm id="register_user" onSubmit={form.handleSubmit(handleSubmit)} setFieldErrors={form.setFieldErrors}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  {...form.register("username")}
                  placeholder="Enter username"
                  aria-invalid={!!form.formState.errors.username}
                />
                {form.formState.errors.username && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.username.message || "Invalid username")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  {...form.register("display_name")}
                  placeholder="Enter display name"
                  aria-invalid={!!form.formState.errors.display_name}
                />
                {form.formState.errors.display_name && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.display_name.message || "Invalid display name")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  {...form.register("password")}
                  placeholder="Enter password"
                  aria-invalid={!!form.formState.errors.password}
                />
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.password.message || "Invalid password")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirm Password</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  {...form.register("confirm_password")}
                  placeholder="Confirm password"
                  aria-invalid={!!form.formState.errors.confirm_password}
                />
                {form.formState.errors.confirm_password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.confirm_password.message || "Passwords must match")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={form.watch("role")}
                  onValueChange={(value) => form.setValue("role", value)}
                >
                  <SelectTrigger id="role" aria-invalid={!!form.formState.errors.role}>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                    {isAdmin && <SelectItem value="admin">Admin</SelectItem>}
                  </SelectContent>
                </Select>
                {form.formState.errors.role && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.role.message || "Invalid role")}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Registering...' : 'Register User'}
              </Button>
            </CardFooter>
          </TracedForm>
        </Card>
      </div>
    </div>
  );
}
