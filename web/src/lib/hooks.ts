import { useCallback, useEffect, useState } from "react";

/**
 * Minimal async loader with loading / error / data states, plus `reload`.
 *
 * `reload` exists because every caller that shows a failure needs a way out of it. Without one
 * the only recovery is a full page refresh, which throws away the cart drawer, scroll position
 * and any filters that live in component state.
 */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (alive) setData(d); })
      .catch((e: Error) => { if (alive) setError(e.message || "Something went wrong"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { data, loading, error, reload };
}
