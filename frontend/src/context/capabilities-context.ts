import { createContext, useContext } from 'react';
import type { Capabilities } from '@/lib/api';

export const DEFAULT_CAPABILITIES: Capabilities = {
  videos: false,
};

export const CapabilitiesContext = createContext<Capabilities>(DEFAULT_CAPABILITIES);

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
