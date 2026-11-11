import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AUTH_MODE, ORG_DOMAIN, useAuth } from "./auth";

export function LoginPage() {
  const { session, ready, error, signInGoogle, signInDev } = useAuth();
  const [email, setEmail] = useState(`admin@${ORG_DOMAIN}`);
  const from = (useLocation().state as { from?: string } | null)?.from;
  // Only same-site paths are accepted as a return target (no open redirect).
  const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  if (ready && session) return <Navigate to={target} replace />;

  return (
    <div className="center-page">
      <div className="card narrow">
        <span className="tag login-pill">HyperData Lab</span>
        <h1>
          Writing <span>Bank</span>
        </h1>
        <p className="muted">
          Đăng nhập một lần (SSO) bằng tài khoản Google <b>@{ORG_DOMAIN}</b>. Tài khoản được đối chiếu với danh sách member của lab.
          Sau khi vào, chọn workspace và chờ manager duyệt.
        </p>
        {AUTH_MODE === "firebase" ? (
          <button className="primary wide" onClick={() => void signInGoogle()}>
            Đăng nhập với Google
          </button>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              signInDev(email);
            }}
          >
            <div className="notice">Chế độ dev: nhập email để giả lập đăng nhập (backend phải chạy AUTH_MODE=dev).</div>
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="primary wide" type="submit">
              Đăng nhập (dev)
            </button>
          </form>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
