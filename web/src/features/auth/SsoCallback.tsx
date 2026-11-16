import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "../../shared/components/ui";
import { useLang } from "../entry/i18n";
import { useAuth } from "./auth";

/**
 * Shown when the HyperDataLab SSO sends the user back with an authorization code. `search` is
 * the query the page was opened with.
 */
export function SsoCallbackPage({ search }: { search: string }) {
  const { completeSso } = useAuth();
  const { t } = useLang();
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
        <div className="w-full max-w-[420px] rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <CircleAlert className="size-5" aria-hidden />
          </div>
          <h1 className="text-base font-semibold">{t.ssoFailureTitle}</h1>
          <ErrorBox error={error} />
          <Button asChild variant="outline" className="mt-3">
            <Link to="/login" className="no-underline!">{t.ssoRetry}</Link>
          </Button>
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-[420px] rounded-xl border bg-card p-6 text-center shadow-sm"
        >
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          </div>
          <h1 className="mt-4 text-base font-semibold">{t.ssoCallbackTitle}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {t.ssoCallbackBody}
          </p>
        </div>
      )}
    </main>
  );
}
