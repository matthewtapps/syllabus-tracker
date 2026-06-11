import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  /** Where to go when the page was loaded directly (no in-app history). */
  fallback: string;
  label?: string;
  className?: string;
}

/**
 * Returns to the previous page when there is in-app history, so "Back" always
 * means "where you came from" regardless of how you arrived. Falls back to a
 * route only on a fresh load (refresh / external link), detected via
 * react-router's location.key === "default".
 */
export function BackButton({ fallback, label = "Back", className }: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const handleBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate(fallback);
  };
  return (
    <Button variant="ghost" size="sm" className={className} onClick={handleBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
