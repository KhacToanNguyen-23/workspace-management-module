import { useEffect, useState } from "react";
import { DATA_CHANGED, useApi } from "./api";

const POLL_MS = 60_000;

/**
 * The number of items a paged collection holds, read from its X-Total-Count with limit=1.
 * Used for "waiting for you" badges. It refreshes after any write made in this tab, when the tab
 * gets focus again, and once a minute so requests sent by other people show up.
 * Returns 0 when path is null or the count cannot be read.
 */
export function useCount(path: string | null): number {
  const api = useApi();
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!path) return;
    let alive = true;
    const url = `${path}${path.includes("?") ? "&" : "?"}limit=1`;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api
        .meta<unknown[]>("GET", url)
        .then((r) => alive && setCount(r.total ?? r.data.length))
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener(DATA_CHANGED, load);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(DATA_CHANGED, load);
      window.removeEventListener("focus", load);
    };
  }, [api, path]);

  return count;
}
