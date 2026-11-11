import { useState } from "react";
import { Navigate } from "react-router-dom";
import { AUTH_MODE, ORG_DOMAIN, useAuth } from "../lib/auth";

export function LoginPage() {
  const { session, ready, error, signInGoogle, signInDev } = useAuth();
  const [email, setEmail] = useState(`admin@${ORG_DOMAIN}`);
  if (ready && session) return <Navigate to="/" replace />;

  return (
    <div className="center-page">
      <div className="card narrow">
        <h1>Writing Bank</h1>
        <p className="muted">
          Đăng nhập bằng tài khoản Google <b>@{ORG_DOMAIN}</b>. Tài khoản được đối chiếu với danh bạ Google Workspace của lab.
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
            <div className="notice">Chế độ dev: nhập email để giả lập đăng nhập (worker phải chạy AUTH_MODE=dev).</div>
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
