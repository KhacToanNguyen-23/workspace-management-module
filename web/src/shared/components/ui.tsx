import { useState, type ReactNode } from "react";
import { STATUS_LABEL } from "../lib/types";

export function Loading() {
  return <div className="muted pad">Đang tải…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="error">{msg}</div>;
}

export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{STATUS_LABEL[value] ?? value}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

/** Runs an async action with a busy flag and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
