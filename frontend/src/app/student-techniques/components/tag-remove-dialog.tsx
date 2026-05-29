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

interface TagRemoveDialogProps {
  tagName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function TagRemoveDialog({
  tagName,
  open,
  onOpenChange,
  onConfirm,
}: TagRemoveDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove tag</AlertDialogTitle>
          <AlertDialogDescription>
            Remove the tag <span className="font-medium text-foreground">"{tagName}"</span>{" "}
            from this technique? It will stay available to assign elsewhere.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remove tag
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
