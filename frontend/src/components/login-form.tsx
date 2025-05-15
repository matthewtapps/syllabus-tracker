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

interface LoginFormProps extends React.ComponentProps<"div"> {
  onSuccess: () => void;
}

export function LoginForm({
  className,
  onSuccess,
  ...props
}: LoginFormProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const response = await login({ username, password })

      if (response.success) {
        onSuccess();

        // Navigate based on user role
        if (response.user?.role === 'student' || response.user?.role === 'Student') {
          navigate(`/student/${response.user.id}`);
        } else {
          navigate('/dashboard');
        }
      } else {
        setError(response.error || "Login failed. Please try again.")
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden">
        <CardContent className="p-0 flex flex-col md:grid md:grid-cols-2">
          {/* Image section - appears at top on mobile, left side on desktop */}
          <div className="relative bg-muted aspect-square md:flex items-center justify-center">
            <div className="absolute inset-0">
              <img
                src="/static/msb.jpg"
                alt="Login"
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          {/* Form section */}
          <form onSubmit={handleSubmit} className="p-6">
            <div className="flex flex-col gap-6">
              <div className="grid gap-3">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="grid gap-3">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div className="p-3 text-sm font-medium text-destructive bg-destructive/10 rounded-md">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Logging in..." : "Login"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
