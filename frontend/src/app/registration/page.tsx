import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerUser, type User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { TracedForm } from '@/components/traced-form';
import { useFormWithValidation } from '@/components/hooks/useFormErrors';

const baseSchema = z
  .object({
    username: z.string().min(1, 'Username is required'),
    display_name: z.string(),
    password: z.string().min(1, 'Password is required'),
    confirm_password: z.string().min(1, 'Please confirm the password'),
    role: z.enum(['student', 'coach', 'admin']),
  })
  .refine((data) => data.password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

type RegistrationFormValues = z.infer<typeof baseSchema>;

interface RegisterUserPageProps {
  user: User;
}

export default function RegisterUserPage({ user }: RegisterUserPageProps) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'Admin';

  const form = useFormWithValidation<RegistrationFormValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      username: '',
      display_name: '',
      password: '',
      confirm_password: '',
      role: 'student',
    },
  });

  async function handleSubmit(data: RegistrationFormValues) {
    setIsSubmitting(true);
    try {
      const response = await registerUser(data);
      if (!response.ok) throw response;
      toast.success('User registered');
      form.reset();
      if (data.role === 'student') navigate('/students');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        title="Register new user"
        subtitle="Add a student, coach, or admin to the system."
      />

      <div className="mx-auto max-w-md">
        <Form {...form}>
          <TracedForm
            id="register_user"
            onSubmit={form.handleSubmit(handleSubmit)}
            setFieldErrors={form.setFieldErrors}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="username"
                      placeholder="e.g. matt_tapps"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="How the user's name appears in the app"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="coach">Coach</SelectItem>
                      {isAdmin && <SelectItem value="admin">Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Registering...' : 'Register user'}
            </Button>
          </TracedForm>
        </Form>
      </div>
    </div>
  );
}
