import type { ReactNode } from "react";
import type { User } from "./api";
import { CurrentUserContext } from "./current-user-context";

export function CurrentUserProvider({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={user}>
      {children}
    </CurrentUserContext.Provider>
  );
}
