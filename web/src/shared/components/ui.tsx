import { useCallback, useRef, useState, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABEL } from "../lib/types";

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-3" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p
      role="alert"
      className="flex items-center gap-2 py-2 text-[13px] text-destructive"
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      {msg}
    </p>
  );
}

const STATUS_TONE: Record<string, string> = {
  approved: "bg-ok",
  active: "bg-ok",
  pending: "bg-warn",
  unknown: "bg-warn",
  rejected: "bg-destructive",
  revoked: "bg-destructive",
  suspended: "bg-destructive",
  missing: "bg-destructive",
  disabled: "bg-destructive",
};

/** Restrained status: a coloured dot and the Vietnamese label. */
export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          STATUS_TONE[value] ?? "bg-muted-foreground/50",
        )}
      />
      {label ?? STATUS_LABEL[value] ?? value}
    </span>
  );
}

/** Small neutral tag for types and roles. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** The page toolbar: title and metadata on the left, contextual actions on the right. */
export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-8">
      <SidebarTrigger className="-ml-1 md:hidden" />
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">
          {title}
        </h1>
        {sub && (
          <div className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:block">
            {sub}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** Content column under the toolbar. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full px-4 py-6 md:px-8", className)}>
      {children}
    </div>
  );
}

/** A flat section: a compact heading row over its content, separated by whitespace, not cards. */
export function Section({
  title,
  count,
  description,
  actions,
  children,
  id,
  className,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mb-8 scroll-mt-16", className)}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {title}
            {count !== undefined && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {count}
              </span>
            )}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="border-t">{children}</div>
    </section>
  );
}

/** One muted row standing in for an empty table. */
export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="text-[13px] text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

/** Shown under a paged list when the server holds more rows than were loaded. */
export function TruncationNote({
  shown,
  total,
}: {
  shown: number | undefined;
  total: number | null;
}) {
  if (shown === undefined || total === null || total <= shown) return null;
  return (
    <p className="py-2 text-xs text-muted-foreground">
      Hiển thị {shown}/{total} dòng. Thu hẹp bộ lọc để xem phần còn lại.
    </p>
  );
}

/** Empty state outside a table: one muted line. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-[13px] text-muted-foreground">{children}</p>;
}

/** Two-line cell: primary text over muted secondary text. */
export function Stacked({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{primary}</div>
      {secondary && (
        <div className="truncate text-xs text-muted-foreground">
          {secondary}
        </div>
      )}
    </div>
  );
}

/** Labelled form field. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Radix Select cannot hold an empty value; filters that mean "all" use this sentinel instead.
const ALL = "__all__";

/** shadcn Select over a plain list of options; an option with value "" maps to "all". */
export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  id,
  className,
  size = "sm",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  return (
    <Select
      value={value === "" ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn("min-w-32", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem key={o.value || ALL} value={o.value || ALL}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface AskOptions {
  title: string;
  description?: ReactNode;
  /** Set to show a note box; the resolved value is its text. */
  noteLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * Replaces window.prompt / window.confirm with a shadcn Dialog. `ask` resolves to the note text
 * (or "" when there is no note box) on confirm, and to null on cancel. Render `dialog` once.
 */
export function useAsk() {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [note, setNote] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((o: AskOptions) => {
    setNote("");
    setOpts(o);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const dialog = (
    <Dialog open={!!opts} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(note.trim());
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle className="text-base">{opts?.title}</DialogTitle>
            {opts?.description && (
              <DialogDescription>{opts.description}</DialogDescription>
            )}
          </DialogHeader>
          {opts?.noteLabel && (
            <Field label={opts.noteLabel} htmlFor="ask-note">
              <Textarea
                id="ask-note"
                autoFocus
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => close(null)}
            >
              Huỷ
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={opts?.destructive ? "destructive" : "default"}
              autoFocus={!opts?.noteLabel}
            >
              {opts?.confirmLabel ?? "Xác nhận"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
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

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("vi-VN") : "—";

/** Short date for dense rows: 12/11/2026 14:05. */
export const fmtShort = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
