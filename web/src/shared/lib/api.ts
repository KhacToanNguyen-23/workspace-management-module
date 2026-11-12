import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../features/auth/auth";

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

export interface ApiResult<T> {
  data: T;
  /** The X-Total-Count header of a paged collection, when the server sent one. */
  total: number | null;
}

export type Api = {
  <T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Same call, but also returns response metadata such as the collection total. */
  meta<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>>;
};

export function useApi(): Api {
  const { getToken, signOut } = useAuth();
  const request = useCallback(
    async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<ApiResult<T>> => {
      const send = async (forceRefresh: boolean) => {
        const token = await getToken(forceRefresh);
        return fetch(`${BASE}/api/v1${path}`, {
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
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
      if (res.status === 204) return { data: undefined as T, total: null };
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(
          data?.error?.message ?? `HTTP ${res.status}`,
          res.status,
          data?.error?.code ?? "error",
        );
      }
      const total = res.headers.get("X-Total-Count");
      return { data: data as T, total: total === null ? null : Number(total) };
    },
    [getToken, signOut],
  );
  return useMemo(
    () =>
      Object.assign(
        async <T,>(method: string, path: string, body?: unknown): Promise<T> =>
          (await request<T>(method, path, body)).data,
        { meta: request },
      ) as Api,
    [request],
  );
}

/** GET with loading/error state and a reload function. */
export function useQuery<T>(path: string | null) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api
      .meta<T>("GET", path)
      .then((r) => alive && (setData(r.data), setTotal(r.total), setError(null)))
      .catch(
        (e) =>
          alive &&
          setError(
            e instanceof ApiError ? e : new ApiError(String(e), 0, "network"),
          ),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api, path, tick]);

  return { data, total, error, loading, reload: () => setTick((t) => t + 1) };
}
