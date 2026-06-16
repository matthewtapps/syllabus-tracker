import { createContext, useContext } from "react";
import type { User } from "./api";

export const CurrentUserContext = createContext<User | null>(null);

// Throws when called outside a CurrentUserProvider. The authenticated
// subtree is the only caller; if the provider is missing or the user
// vanishes mid-session, the error boundary in <AuthedAppShell> renders
// the recovery panel instead of crashing the whole tree.
export function useUser(): User {
  const u = useContext(CurrentUserContext);
  if (!u) {
    throw new Error("useUser() must be used inside CurrentUserProvider");
  }
  return u;
}
