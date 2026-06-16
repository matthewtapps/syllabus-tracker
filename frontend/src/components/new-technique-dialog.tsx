import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NewTechniqueForm } from './new-technique-form';

interface NewTechniqueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing library technique names, used for the duplicate nudge. */
  existingNames: string[];
}

export default function NewTechniqueDialog({
  open,
  onOpenChange,
  existingNames,
}: NewTechniqueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>New technique</DialogTitle>
          <DialogDescription>
            Adds a technique to the global library. Start typing the name to see
            if it already exists.
          </DialogDescription>
        </DialogHeader>

        <NewTechniqueForm
          existingNames={existingNames}
          formId="create_library_technique"
          onCreated={(created) => {
            toast.success(`Created "${created.name}"`);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
