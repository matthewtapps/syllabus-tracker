import { type ReactNode } from 'react';
import type { Capabilities } from '@/lib/api';
import { CapabilitiesContext, DEFAULT_CAPABILITIES } from './capabilities-context';

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
