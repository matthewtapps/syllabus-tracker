import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { initTelemetry, recordRouteChange } from '@/lib/telemetry';

interface TelemetryProviderProps {
  children: ReactNode;
}

export function TelemetryProvider({ children }: TelemetryProviderProps) {
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState<string | undefined>();

  useEffect(() => {
    initTelemetry();
  }, []);

  useEffect(() => {
    const currentPath = location.pathname;
    recordRouteChange(currentPath, previousPath);
    setPreviousPath(currentPath);
  }, [location, previousPath]);

  return <>{children}</>;
}
