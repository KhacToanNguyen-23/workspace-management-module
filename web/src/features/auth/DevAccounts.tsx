import { useCallback, useEffect, useState } from "react";
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

/** Login screen: one button per demo account, plus a reset of the demo data. */
export function DevAccountList() {
  const { accounts, error, reload } = useDevAccounts();
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  return (
    <div className="stack">
      <div className="notice">
        Chế độ dev: bấm vào một tài khoản mẫu để đăng nhập ngay với role tương
        ứng.
      </div>
      {error && <div className="error">{error}</div>}
      <div className="dev-accounts">
        {(accounts ?? []).map((a) => (
          <button
            key={a.email}
            type="button"
            className="dev-account"
            onClick={() => switchDevAccount(a.email)}
          >
            <span className="row between">
              <b>{a.name}</b>
              <span className="tag">
                {a.disabled ? "Đã disable" : GLOBAL_ROLE_LABEL[a.role]}
              </span>
            </span>
            <span className="small muted">{a.email}</span>
            <span className="small">{a.note}</span>
          </button>
        ))}
      </div>
      {resetError && <div className="error">{resetError}</div>}
      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={() => {
          if (
            !confirm(
              "Xoá toàn bộ dữ liệu trong emulator và tạo lại dữ liệu mẫu?",
            )
          )
            return;
          setBusy(true);
          setResetError("");
          resetDemoData()
            .then(reload)
            .catch((e) => setResetError(`Reset thất bại: ${String(e)}`))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Đang reset…" : "Reset dữ liệu mẫu"}
      </button>
    </div>
  );
}

/** Sidebar: switch to another demo account without going through the login screen. */
export function DevAccountSwitcher({ current }: { current: string }) {
  const { accounts } = useDevAccounts();
  if (!accounts) return null;
  return (
    <label className="field dev-switcher">
      <span>Đổi tài khoản (dev)</span>
      <select
        value={accounts.some((a) => a.email === current) ? current : ""}
        onChange={(e) => e.target.value && switchDevAccount(e.target.value)}
      >
        <option value="">— chọn —</option>
        {accounts.map((a) => (
          <option key={a.email} value={a.email}>
            {a.name} · {a.disabled ? "đã disable" : GLOBAL_ROLE_LABEL[a.role]}
          </option>
        ))}
      </select>
    </label>
  );
}
