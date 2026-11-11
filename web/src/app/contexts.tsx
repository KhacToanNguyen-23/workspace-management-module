import { createContext, useContext } from "react";
import type { Me, WorkspaceInfo } from "../shared/lib/types";

type Reloadable<T> = { value: T; reload(): void };

export const MeContext = createContext<Reloadable<Me> | null>(null);
export const WorkspaceContext = createContext<Reloadable<WorkspaceInfo> | null>(
  null,
);

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe outside MeProvider");
  return { me: ctx.value, reload: ctx.reload };
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside workspace route");
  return { info: ctx.value, reload: ctx.reload };
}
