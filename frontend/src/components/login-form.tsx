import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { login } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { TracedForm } from "./traced-form";
import { useFormWithValidation } from "./hooks/useFormErrors";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps extends React.ComponentProps<"div"> {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess, className, ...props }: LoginFormProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const form = useFormWithValidation<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const handleSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      const response = await login(data);
      if (response.success) {
        onSuccess();
        navigate("/dashboard");
      } else {
        throw new Error(response.error || "Login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("w-full", className)} {...props}>
      <div className="grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2">
        <div className="hidden bg-muted md:block">
          <img
            src="/img/msb.jpg"
            alt=""
            className="h-full w-full object-cover"
          />
        </div>

        <Form {...form}>
          <TracedForm
            id="login"
            onSubmit={form.handleSubmit(handleSubmit)}
            setFieldErrors={form.setFieldErrors}
            className="flex flex-col justify-center gap-5 p-8"
          >
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-muted-foreground">
                Enter your credentials to continue.
              </p>
            </div>

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      autoComplete="username"
                      aria-invalid={!!form.formState.errors.username}
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
                  <div className="flex items-baseline justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      to="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={!!form.formState.errors.password}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              No account yet?{" "}
              <Link to="/register" className="font-medium text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </TracedForm>
        </Form>
      </div>
    </div>
  );
}
