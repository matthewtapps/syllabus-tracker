import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, type RenderOptions } from "@testing-library/react";
import { CurrentUserProvider } from "@/lib/current-user";
import { ConfirmProvider } from "@/components/confirm-dialog";
import type { User } from "@/lib/api";

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: "test_user",
    display_name: "Test User",
    role: "student",
    archived: false,
    ...overrides,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  {
    user = buildUser(),
    initialEntries = ["/"],
    ...options
  }: RenderOptions & {
    user?: User | null;
    initialEntries?: string[];
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ConfirmProvider>
          {user ? (
            <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
          ) : (
            children
          )}
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient: client,
  };
}
