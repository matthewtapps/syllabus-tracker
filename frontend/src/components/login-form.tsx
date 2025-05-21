import { useState } from "react"
import { useNavigate } from "react-router-dom";
import { login } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TracedForm } from "./traced-form";
import { useFormWithValidation } from "./hooks/useFormErrors";

interface LoginFormProps extends React.ComponentProps<"div"> {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess, className, ...props }: LoginFormProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  interface LoginFormValues {
    username: string;
    password: string;
  }

  const form = useFormWithValidation<LoginFormValues>({
    defaultValues: {
      username: "",
      password: ""
    }
  });

  const handleSubmit = async (data: { username: string; password: string }) => {
    setIsLoading(true);
    try {
      const response = await login(data);
      if (response.success) {
        onSuccess();
        if (response.user?.role === 'student' || response.user?.role === 'Student') {
          navigate(`/student/${response.user.id}`);
        } else {
          navigate('/dashboard');
        }
      } else {
        throw new Error(response.error || "Login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="flex flex-col md:grid md:grid-cols-2 p-0">
          <div className="relative bg-muted aspect-square md:flex items-center justify-center">
            <div className="absolute">
              <img
                src="/img/msb.jpg"
                alt="Login"
                className="h-full w-full"
              />
            </div>
          </div>

          {/* Form section */}
          <TracedForm onSubmit={form.handleSubmit(handleSubmit)} className="md:aspect-square" id="login"
            setFieldErrors={form.setFieldErrors}
          >
            <div className="flex flex-col justify-center h-full p-6 space-y-4">
              <div>
                <Label className="mb-2 block" htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  required
                  {...form.register("username")}
                  aria-invalid={!!form.formState.errors.username}
                />
                {form.formState.errors.username && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.username.message || "Invalid username")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="password" className="mb-2 block">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  {...form.register("password")}
                  aria-invalid={!!form.formState.errors.password}
                />
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive mt-1">
                    {String(form.formState.errors.password.message || "Invalid password")}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </div>
          </TracedForm>
        </CardContent>
      </Card>
    </div>
  )
}
