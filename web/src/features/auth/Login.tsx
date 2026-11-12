import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HyperSpaceMark } from "../../shared/components/Brand";
import { ErrorBox, Field } from "../../shared/components/ui";
import { useLang } from "../entry/i18n";
import { LangToggle } from "../entry/LangToggle";
import { AUTH_MODE, ORG_DOMAIN, useAuth } from "./auth";
import { DevAccountList } from "./DevAccounts";

export function LoginPage() {
  const { session, ready, error, signInGoogle, signInDev } = useAuth();
  const { t, lang, setLang } = useLang();
  const [email, setEmail] = useState("");
  const from = (useLocation().state as { from?: string } | null)?.from;
  // Only same-site paths are accepted as a return target (no open redirect).
  const target =
    from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  if (ready && session) return <Navigate to={target} replace />;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4 md:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link to="/" className="text-muted-foreground! no-underline!">
            <ArrowLeft />
            {t.backHome}
          </Link>
        </Button>
        <LangToggle lang={lang} onChange={setLang} label={t.langLabel} />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-8 pb-16 md:pt-16">
        <div className="w-full max-w-[380px]">
          <HyperSpaceMark className="mb-5 size-8" />
          <h1 className="text-xl font-semibold tracking-tight">
            {t.loginTitle}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {t.loginBody(ORG_DOMAIN)}
          </p>
          <div className="mt-6 grid gap-5">
            {AUTH_MODE === "firebase" ? (
              <Button className="w-full" onClick={() => void signInGoogle()}>
                {t.loginGoogle}
              </Button>
            ) : (
              <>
                <DevAccountList />
                <form
                  className="grid gap-3 border-t pt-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    signInDev(email);
                  }}
                >
                  <Field label={t.loginDevEmail(ORG_DOMAIN)} htmlFor="dev-email">
                    <Input
                      id="dev-email"
                      type="email"
                      value={email}
                      placeholder={`ten@${ORG_DOMAIN}`}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" className="w-full">
                    {t.loginDevSubmit}
                  </Button>
                </form>
              </>
            )}
            <ErrorBox error={error} />
          </div>
        </div>
      </main>
    </div>
  );
}
