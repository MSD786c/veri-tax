import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "../api/client.ts";

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * GET `path` and re-fetch when it changes. Keeps the previous data while a refetch is in
 * flight, so tables and charts hold their frame instead of flashing a skeleton.
 * Pass `null` to skip fetching.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const id = ++latest.current;
    setLoading(true);
    get<T>(path)
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => id === latest.current && setError(e))
      .finally(() => id === latest.current && setLoading(false));
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
