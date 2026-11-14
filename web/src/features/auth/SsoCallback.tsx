import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "../../shared/components/ui";
import { useAuth } from "./auth";

/**
 * Shown when the HyperDataLab SSO sends the user back with an authorization code. `search` is
 * the query the page was opened with.
 */
export function SsoCallbackPage({ search }: { search: string }) {
  const { completeSso } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    completeSso(search)
      .then((returnTo) => live && navigate(returnTo, { replace: true }))
      .catch((e) => live && setError(`Đăng nhập thất bại: ${String(e.message ?? e)}`));
    return () => {
      live = false;
    };
  }, [completeSso, navigate, search]);

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      {error ? (
        <div className="grid w-full max-w-[380px] gap-4">
          <ErrorBox error={error} />
          <Button asChild variant="outline">
            <Link to="/login" className="no-underline!">
              Quay lại trang đăng nhập
            </Link>
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Đang đăng nhập…</p>
      )}
    </main>
  );
}
