// Endpoints that may legitimately return 401 without meaning "session expired"
// (auth probes, anonymous flows). For these, surface the 401 to the caller
// instead of redirecting.
const ANONYMOUS_API_PATHS = [
  "/api/login",
  "/api/logout",
  "/api/me",
  "/api/capabilities",
  "/api/forgot_password",
  "/api/register/self",
];

const ANONYMOUS_API_PREFIXES = ["/api/invite/"];

// Routes where the user is already unauthenticated; redirecting would loop.
const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/invite/",
];

function shouldRedirectFor(url: string): boolean {
  let path: string;
  try {
    path = new URL(url, window.location.origin).pathname;
  } catch {
    return false;
  }
  if (!path.startsWith("/api/")) return false;
  if (ANONYMOUS_API_PATHS.includes(path)) return false;
  if (ANONYMOUS_API_PREFIXES.some((p) => path.startsWith(p))) return false;
  const here = window.location.pathname;
  if (PUBLIC_ROUTES.some((p) => here === p || here.startsWith(p))) return false;
  return true;
}

let redirecting = false;

export function installAuthRedirect(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status === 401) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (shouldRedirectFor(url) && !redirecting) {
        redirecting = true;
        window.location.href = "/login";
      }
    }
    return response;
  };
}
