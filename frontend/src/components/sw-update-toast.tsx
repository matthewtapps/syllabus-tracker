import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SwUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!needRefresh) return;
    if (toastIdRef.current != null) return;

    toastIdRef.current = toast("A new version is available", {
      description: "Reload to get the latest changes.",
      duration: Infinity,
      action: (
        <Button
          size="sm"
          onClick={() => {
            void updateServiceWorker(true);
          }}
        >
          Reload
        </Button>
      ),
      onDismiss: () => {
        toastIdRef.current = null;
        setNeedRefresh(false);
      },
      onAutoClose: () => {
        toastIdRef.current = null;
        setNeedRefresh(false);
      },
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
