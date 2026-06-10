import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

// Wraps the authenticated subtree. If useUser() ever throws (the
// CurrentUserProvider is missing, or the cached user vanishes mid-render),
// the boundary catches it and renders a recovery panel rather than letting
// React unmount the whole app. We treat a missing user as "auth or backend
// broke, recover by reload", not as a recoverable runtime state.
export class AuthErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== "undefined") {
      console.error("AuthErrorBoundary caught:", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-lg font-semibold">Session lost</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            We could not read your session. Refresh the page to log in again.
          </p>
          <Button onClick={() => window.location.reload()}>Refresh</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
