import { useCallback, useRef, useState } from "react";
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
import { ConfirmContext, type ConfirmOptions } from "./confirm-context";

interface DialogState {
  open: boolean;
  options: ConfirmOptions;
}

const DEFAULT_OPTIONS: ConfirmOptions = { title: "" };

// ConfirmProvider renders a single AlertDialog and exposes a confirm()
// function via useConfirm() (from confirm-context.ts). Call confirm(options)
// from any event handler inside the provider; it returns a promise that
// resolves true when the user confirms and false when they cancel or close.
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    options: DEFAULT_OPTIONS,
  });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  function handleConfirm() {
    resolverRef.current?.(true);
    resolverRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }

  function handleCancel() {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }

  function handleOpenChange(open: boolean) {
    if (!open) handleCancel();
  }

  const { options } = state;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={state.open} onOpenChange={handleOpenChange}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{options.title}</AlertDialogTitle>
            {options.description && (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>
              {options.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={options.destructive ? "destructive" : "default"}
              onClick={handleConfirm}
            >
              {options.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
