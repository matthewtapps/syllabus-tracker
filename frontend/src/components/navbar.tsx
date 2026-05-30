import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { LogOut, Menu, UserRound } from "lucide-react";
import type { User } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface NavBarProps {
  user: User | null;
  onLogout: () => void;
}

interface NavLink {
  to: string;
  label: string;
}

function initials(user: Pick<User, "display_name" | "username">): string {
  const source = user.display_name?.trim() || user.username || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildNavLinks(user: User): NavLink[] {
  const isCoach = user.role === "coach" || user.role === "Coach";
  const isAdmin = user.role === "admin" || user.role === "Admin";
  const isStudent = user.role === "student" || user.role === "Student";

  const links: NavLink[] = [{ to: "/dashboard", label: "Dashboard" }];
  if (isStudent) links.push({ to: `/student/${user.id}`, label: "My techniques" });
  if (isCoach || isAdmin) links.push({ to: "/students", label: "Students" });
  if (isCoach || isAdmin) links.push({ to: "/collections", label: "Collections" });
  if (isCoach || isAdmin) links.push({ to: "/register-user", label: "New user" });
  if (isAdmin) links.push({ to: "/admin", label: "Admin" });
  return links;
}

export function NavBar({ user, onLogout }: NavBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const links = user ? buildNavLinks(user) : [];
  const isActive = (path: string) => location.pathname === path;
  const handleLogout = () => {
    setIsOpen(false);
    onLogout();
  };
  const handleProfile = () => {
    setIsOpen(false);
    navigate("/profile");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex h-full items-center gap-2">
          {/* Mobile hamburger (lives on the left, matches drawer side) */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="-ml-2 sm:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-72 flex-col gap-0 p-0 sm:hidden"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>

              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <img src="/img/logo.png" alt="" className="h-7 w-7" aria-hidden />
                <span className="font-bold text-lg">Silly Bus</span>
              </div>

              {user && (
                <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                  <Avatar size="default">
                    <AvatarFallback>{initials(user)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {user.display_name || user.username}
                    </div>
                    <div className="text-xs capitalize text-muted-foreground">
                      {user.role}
                    </div>
                  </div>
                </div>
              )}

              <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
                {links.map((link) => {
                  const active = isActive(link.to);
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setIsOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-accent text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
                {user ? (
                  <>
                    <Button
                      variant="ghost"
                      className="justify-start gap-2 text-sm"
                      onClick={handleProfile}
                    >
                      <UserRound className="h-4 w-4" aria-hidden />
                      My profile
                    </Button>
                    <Button
                      variant="ghost"
                      className="justify-start gap-2 text-sm"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4" aria-hidden />
                      Logout
                    </Button>
                  </>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => {
                      navigate("/login");
                      setIsOpen(false);
                    }}
                  >
                    Sign in
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Link
            to={user ? "/dashboard" : "/login"}
            className="flex items-center gap-2 font-bold text-lg"
          >
            <img src="/img/logo.png" alt="" className="h-7 w-7" aria-hidden />
            <span>Silly Bus</span>
          </Link>

          {/* Desktop nav */}
          <nav className="ml-6 hidden h-full items-center sm:flex">
            {links.map((link) => {
              const active = isActive(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-full items-center px-3 text-sm font-medium transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {link.label}
                  {active && (
                    <span
                      className="absolute inset-x-3 -bottom-px h-0.5 bg-primary"
                      aria-hidden
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Desktop user menu */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="hidden h-10 items-center gap-2 px-2 sm:inline-flex"
                >
                  <Avatar size="sm">
                    <AvatarFallback>{initials(user)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">
                    {user.display_name || user.username}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">
                    {user.display_name || user.username}
                  </div>
                  <div className="text-xs capitalize text-muted-foreground">
                    {user.role}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTimeout(handleProfile, 0)}>
                  <UserRound className="mr-2 h-4 w-4" aria-hidden />
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(onLogout, 0)}>
                  <LogOut className="mr-2 h-4 w-4" aria-hidden />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="default"
              onClick={() => navigate("/login")}
              className="hidden sm:flex"
            >
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
