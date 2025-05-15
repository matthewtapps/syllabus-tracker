import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { User } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BusFrontIcon, Menu } from "lucide-react";
import { ModeToggle } from "./theme/mode-toggle";

interface NavBarProps {
  user: User | null;
  onLogout: () => void;
}

export function NavBar({ user, onLogout }: NavBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const isCoach = user?.role === "coach" || user?.role === "Coach";
  const isAdmin = user?.role === "admin" || user?.role === "Admin";
  const isStudent = user?.role === "student" || user?.role === "Student";

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const NavItem = ({ to, label }: { to: string; label: string }) => (
    <Button
      variant={isActive(to) ? "secondary" : "ghost"}
      onClick={() => {
        navigate(to);
        setIsOpen(false);
      }}
      className="justify-start w-full sm:w-auto"
    >
      {label}
    </Button>
  );

  return (
    <header className="border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="flex items-center font-bold text-lg"
            onClick={() => navigate(user ? "/dashboard" : "/login")}
          >
            <BusFrontIcon className="size-6 mx-2" />
            <div>
              Silly Bus
            </div>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden sm:flex items-center ml-6 space-x-2">
            {user && (
              <>
                <NavItem to="/dashboard" label="Dashboard" />

                {isStudent && (
                  <NavItem to={`/student/${user.id}`} label="My Techniques" />
                )}

                {(isCoach || isAdmin) && (
                  <NavItem to="/students" label="Students" />
                )}

                {(isCoach || isAdmin) && (
                  <NavItem to="/register-user" label="New User" />
                )}

                {isAdmin && (
                  <NavItem to="/admin" label="Admin" />
                )}
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ModeToggle />

          {user ? (
            <div className="hidden sm:flex items-center gap-4">
              <div className="text-sm font-medium bg-muted px-3 py-1.5 rounded-md">
                {user.display_name || user.username}
              </div>
              <Button variant="outline" onClick={onLogout}>
                Logout
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              onClick={() => navigate("/login")}
              className="hidden sm:flex"
            >
              Login
            </Button>
          )}

          {/* Mobile Menu Button */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="sm:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="sm:hidden">
              <div className="flex flex-col h-full py-4">
                <div className="px-2 py-4 mb-2 bg-muted/50 rounded-md">
                  <div className="font-medium mb-1">
                    {user ? user.display_name || user.username : "Menu"}
                  </div>
                  {user && (
                    <div className="text-sm text-muted-foreground">
                      {user.role}
                    </div>
                  )}
                </div>

                <nav className="flex flex-col space-y-1 px-2 mt-4">
                  {user && (
                    <>
                      <NavItem to="/dashboard" label="Dashboard" />

                      {isStudent && (
                        <NavItem to={`/student/${user.id}`} label="My Techniques" />
                      )}

                      {(isCoach || isAdmin) && (
                        <NavItem to="/students" label="Students" />
                      )}

                      {(isCoach || isAdmin) && (
                        <NavItem to="/register-user" label="New User" />
                      )}

                      {isAdmin && (
                        <NavItem to="/admin" label="Admin" />
                      )}
                    </>
                  )}
                </nav>

                <div className="mt-auto pt-4 px-2">
                  {user ? (
                    <Button
                      variant="outline"
                      className="w-full justify-center"
                      onClick={() => {
                        onLogout();
                        setIsOpen(false);
                      }}
                    >
                      Logout
                    </Button>
                  ) : (
                    <Button
                      className="w-full justify-center"
                      onClick={() => {
                        navigate("/login");
                        setIsOpen(false);
                      }}
                    >
                      Login
                    </Button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
