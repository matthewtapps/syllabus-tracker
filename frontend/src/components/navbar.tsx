import { useNavigate, useLocation, Link } from "react-router-dom";
import { Download, LogOut, UserRound } from "lucide-react";
import type { User } from "@/lib/api";
import { isCoachOrAdmin, isAdmin } from "@/lib/api";
import { useInstallTrigger } from "@/lib/install";
import { Button } from "@/components/ui/button";
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
  const coachOrAdmin = isCoachOrAdmin(user);
  const isStudent = user.role === "student";

  const links: NavLink[] = [{ to: "/dashboard", label: "Dashboard" }];
  if (isStudent) links.push({ to: `/student/${user.id}`, label: "My techniques" });
  links.push({ to: "/library", label: "Library" });
  if (isStudent) links.push({ to: `/student/${user.id}/pinned`, label: "Pinned" });
  if (coachOrAdmin) links.push({ to: "/students", label: "Students" });
  if (coachOrAdmin) links.push({ to: "/register-user", label: "New user" });
  if (isAdmin(user)) links.push({ to: "/admin", label: "Admin" });
  return links;
}

export function NavBar({ user, onLogout }: NavBarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const install = useInstallTrigger();

  const links = user ? buildNavLinks(user) : [];
  const isActive = (path: string) => location.pathname === path;
  const handleProfile = () => navigate("/profile");

  // Mobile uses BottomNav; the top bar only renders on >=sm.
  return (
    <header className="sticky top-0 z-50 hidden border-b border-border bg-background/80 backdrop-blur-sm sm:block">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex h-full items-center gap-2">
          <Link
            to={user ? "/dashboard" : "/login"}
            className="flex items-center gap-2 font-bold text-lg"
          >
            <img src="/img/logo.png" alt="" className="h-7 w-7" aria-hidden />
            <span>Silly Bus</span>
          </Link>

          <nav className="ml-6 flex h-full items-center">
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
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="inline-flex h-10 items-center gap-2 px-2"
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
                {install.available && (
                  <DropdownMenuItem onSelect={() => setTimeout(install.trigger, 0)}>
                    <Download className="mr-2 h-4 w-4" aria-hidden />
                    Install app
                  </DropdownMenuItem>
                )}
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
            <Button variant="default" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
