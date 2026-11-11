import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export function useApi(): Api {
  const { getToken, signOut } = useAuth();
  return useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      const send = async (forceRefresh: boolean) => {
        const token = await getToken(forceRefresh);
        return fetch(`${BASE}/api${path}`, {
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      };
      let res = await send(false);
      if (res.status === 401) {
        // The ID token may have just expired or been rotated: renew it once. If the backend still
        // refuses it, end the session so the user goes back through SSO.
        res = await send(true);
        if (res.status === 401) await signOut();
      }
      if (res.status === 204) return undefined as T;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data?.error?.code ?? "error");
      }
      return data as T;
    },
    [getToken, signOut],
  );
}

/** GET with loading/error state and a reload function. */
export function useQuery<T>(path: string | null) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>("GET", path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof ApiError ? e : new ApiError(String(e), 0, "network")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api, path, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
