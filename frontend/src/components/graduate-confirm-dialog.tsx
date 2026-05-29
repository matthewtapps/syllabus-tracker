import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface GraduateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "graduate" | "ungraduate";
  studentName: string;
  onConfirm: () => void;
}

export function GraduateConfirmDialog({
  open,
  onOpenChange,
  mode,
  studentName,
  onConfirm,
}: GraduateConfirmDialogProps) {
  const isGraduating = mode === "graduate";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isGraduating ? "Graduate student?" : "Un-graduate student?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isGraduating ? (
              <>
                Mark{" "}
                <span className="font-medium text-foreground">{studentName}</span>{" "}
                as graduated? They'll be hidden from your default students view.
                Their card stays intact and you can un-graduate them later.
              </>
            ) : (
              <>
                Restore{" "}
                <span className="font-medium text-foreground">{studentName}</span>{" "}
                to active status?
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {isGraduating ? "Graduate" : "Un-graduate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
