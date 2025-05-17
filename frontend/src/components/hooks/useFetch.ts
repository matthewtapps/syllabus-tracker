import { useState, useCallback } from "react";
import { useTelemetry } from "@/context/telemetry";

interface UseFetchOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface FetchState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Hook for traced fetch requests
 */
export function useFetch<T>(options: UseFetchOptions<T> = {}) {
  const { fetch } = useTelemetry();
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    loading: false,
  });

  const fetchData = useCallback(
    async (url: string, config: RequestInit = {}) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch(url, {
          ...config,
          headers: {
            "Content-Type": "application/json",
            ...(config.headers || {}),
          },
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        setState({ data, loading: false, error: null });
        options.onSuccess?.(data);
        return data;
      } catch (error) {
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
        setState({ data: null, loading: false, error: errorObj });
        options.onError?.(errorObj);
        throw errorObj;
      }
    },
    [fetch, options],
  );

  return {
    ...state,
    fetch: fetchData,
  };
}
