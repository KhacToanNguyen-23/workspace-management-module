import { Link } from "react-router-dom";
import { FolderKanban, Library, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HyperSpaceMark } from "../../shared/components/Brand";
import { useAuth } from "../auth/auth";
import { useLang } from "./i18n";
import { LangToggle } from "./LangToggle";

/** Public product entry page, shown on "/" to visitors without a session. */
export function EntryPage() {
  const { t, lang, setLang } = useLang();
  const { session } = useAuth();
  // With a session, "/" already routes into the user's workspace.
  const enterTo = session ? "/" : "/login";

  const capabilities = [
    { icon: FolderKanban, title: t.cap1Title, body: t.cap1Body },
    { icon: Users, title: t.cap2Title, body: t.cap2Body },
    { icon: Library, title: t.cap3Title, body: t.cap3Body },
  ];

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <nav className="flex h-16 w-full items-center justify-between gap-3 px-4 md:px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-foreground! no-underline!"
            aria-label="HyperSpace"
          >
            <HyperSpaceMark />
            <span className="text-[15px] font-semibold tracking-tight">
              HyperSpace
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <LangToggle lang={lang} onChange={setLang} label={t.langLabel} />
            {!session && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden min-w-(--size-action-sm) sm:inline-flex"
              >
                <Link to="/login" className="text-foreground! no-underline!">
                  {t.signIn}
                </Link>
              </Button>
            )}
            <Button asChild size="sm" className="min-w-(--size-action-md)">
              <Link to={enterTo} className="text-primary-foreground! no-underline!">
                {t.enter}
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1440px] items-center gap-10 px-4 py-14 md:grid-cols-[1.05fr_1fr] md:px-8 xl:px-12 md:py-20">
          <div>
            <p className="mb-4 text-xs font-medium tracking-wide text-primary uppercase">
              {t.eyebrow}
            </p>
            <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight text-balance text-foreground md:text-[44px]">
              {t.headline1}
              <br />
              <span className="text-muted-foreground">{t.headline2}</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {t.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="min-w-(--size-action-lg)">
                <Link
                  to={enterTo}
                  className="text-primary-foreground! no-underline!"
                >
                  {t.enter}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="min-w-(--size-action-lg)">
                <a
                  href="#capabilities"
                  className="text-foreground! no-underline!"
                >
                  {t.discover}
                </a>
              </Button>
            </div>
          </div>
          <img
            src="/assets/hero.svg"
            alt=""
            width={800}
            height={521}
            className="mx-auto h-auto w-full max-w-[520px]"
          />
        </section>

        <section
          id="capabilities"
          className="mx-auto max-w-[1440px] scroll-mt-20 px-4 py-16 md:px-8 xl:px-12 md:py-20"
        >
          <h2 className="mb-8 text-sm font-semibold text-foreground">
            {t.capabilitiesTitle}
          </h2>
          <div className="grid border-t md:grid-cols-3 md:divide-x">
            {capabilities.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="border-b py-6 md:border-b-0 md:px-6 md:first:pl-0 md:last:pr-0"
              >
                <Icon className="mb-3 size-5 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">
                  {title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-8 xl:px-12">
          <span className="flex items-center gap-2">
            <HyperSpaceMark className="size-5" />
            <span className="font-medium text-foreground">HyperSpace</span>
            <span>· {t.footer}</span>
          </span>
          <span>© 2026 HyperData Lab</span>
        </div>
      </footer>
    </div>
  );
}
