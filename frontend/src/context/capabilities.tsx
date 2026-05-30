import { createContext, useContext, type ReactNode } from 'react';
import type { Capabilities } from '@/lib/api';

const DEFAULT_CAPABILITIES: Capabilities = {
  videos: false,
};

const CapabilitiesContext = createContext<Capabilities>(DEFAULT_CAPABILITIES);

interface CapabilitiesProviderProps {
  value: Capabilities | null;
  children: ReactNode;
}

export function CapabilitiesProvider({ value, children }: CapabilitiesProviderProps) {
  return (
    <CapabilitiesContext.Provider value={value ?? DEFAULT_CAPABILITIES}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
