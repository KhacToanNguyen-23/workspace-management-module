import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ErrorBox, Tag, useAsk } from "../../shared/components/ui";
import { GLOBAL_ROLE_LABEL, type GlobalRole } from "../../shared/lib/types";
import { switchDevAccount } from "./auth";

/**
 * Local development only (VITE_AUTH_MODE=dev): the demo accounts seeded by the backend, one per
 * role and state, so a tester can jump between them in one click.
 */
interface DevAccount {
  email: string;
  name: string;
  role: GlobalRole;
  disabled: boolean;
  note: string;
  seeded: boolean;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

function useDevAccounts() {
  const [accounts, setAccounts] = useState<DevAccount[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    fetch(`${BASE}/api/dev/accounts`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DevAccount[]>;
      })
      .then((data) => {
        setAccounts(data);
        setError("");
      })
      .catch(() =>
        setError(
          "Không lấy được danh sách tài khoản mẫu. Backend đã chạy với AUTH_MODE=dev chưa?",
        ),
      );
  }, []);
  useEffect(load, [load]);
  return { accounts, error, reload: load };
}

async function resetDemoData() {
  const res = await fetch(`${BASE}/api/dev/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const roleText = (a: DevAccount) =>
  a.disabled ? "Đã disable" : GLOBAL_ROLE_LABEL[a.role];

/** Login screen: one row per demo account, plus a reset of the demo data. */
export function DevAccountList() {
  const { accounts, error, reload } = useDevAccounts();
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const { ask, dialog } = useAsk();

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Tài khoản mẫu (dev)
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={async () => {
            const ok = await ask({
              title: "Reset dữ liệu mẫu?",
              description:
                "Xoá toàn bộ dữ liệu trong emulator và tạo lại dữ liệu mẫu.",
              confirmLabel: "Reset",
              destructive: true,
            });
            if (ok === null) return;
            setBusy(true);
            setResetError("");
            resetDemoData()
              .then(reload)
              .catch((e) => setResetError(`Reset thất bại: ${String(e)}`))
              .finally(() => setBusy(false));
          }}
        >
          <RotateCcw />
          {busy ? "Đang reset…" : "Reset"}
        </Button>
      </div>
      <ErrorBox error={error || resetError} />
      <ul className="divide-y rounded-md border">
        {(accounts ?? []).map((a) => (
          <li key={a.email}>
            <button
              type="button"
              onClick={() => switchDevAccount(a.email)}
              className="grid w-full gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">
                  {a.name}
                </span>
                <Tag>{roleText(a)}</Tag>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {a.email} · {a.note}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  );
}

/** User menu submenu: switch to another demo account without the login screen. */
export function DevAccountMenu({ current }: { current: string }) {
  const { accounts } = useDevAccounts();
  if (!accounts) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Đổi tài khoản (dev)</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {accounts.map((a) => (
          <DropdownMenuItem
            key={a.email}
            onSelect={() => switchDevAccount(a.email)}
            className={cn(
              "flex items-center justify-between gap-2",
              a.email === current && "bg-accent",
            )}
          >
            <span className="truncate">{a.name}</span>
            <span className="text-xs text-muted-foreground">{roleText(a)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
