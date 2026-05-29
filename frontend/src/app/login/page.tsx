import { LoginForm } from "@/components/login-form";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <img src="/img/logo.png" alt="" className="h-8 w-8" aria-hidden />
          <span className="text-xl font-semibold tracking-tight">Silly Bus</span>
        </div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Dominance MMA Jiu Jitsu Syllabus Tracker
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <LoginForm onSuccess={onLoginSuccess} />
      </div>
    </div>
  );
}
