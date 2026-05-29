import { LoginForm } from "@/components/login-form"

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <img src="/img/logo.png" alt="" className="h-7 w-7" aria-hidden />
          Silly Bus
        </a>
        <LoginForm onSuccess={onLoginSuccess} />
      </div>
    </div>
  )
}
