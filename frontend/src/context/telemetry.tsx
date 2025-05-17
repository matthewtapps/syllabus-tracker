import { createContext, useContext, type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { type Span } from '@opentelemetry/api';
import { createSpan, initTelemetry, recordRouteChange, tracedFetch } from '@/lib/telemetry';

interface TelemetryContextType {
  createSpan: <T>(name: string, fn: (span: Span) => T | Promise<T>, options?: {
    attributes?: Record<string, string | number | boolean | string[]>
  }) => Promise<T>;
  fetch: typeof tracedFetch;
}

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

interface TelemetryProviderProps {
  children: ReactNode;
}

export function TelemetryProvider({ children }: TelemetryProviderProps) {
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState<string | undefined>();

  // Initialize telemetry on mount
  useEffect(() => {
    initTelemetry();
  }, []);

  // Track route changes
  useEffect(() => {
    const currentPath = location.pathname;
    recordRouteChange(currentPath, previousPath);
    setPreviousPath(currentPath);
  }, [location, previousPath]);

  const value = {
    createSpan,
    fetch: tracedFetch,
  };

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
}
