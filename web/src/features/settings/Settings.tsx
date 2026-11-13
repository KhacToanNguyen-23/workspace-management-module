import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "../../shared/components/ui";
import { useLang, useTr, type Lang } from "../entry/i18n";

/** Each language is named in itself, so it stays readable whichever language is active. */
const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "vi", label: "Tiếng Việt" },
  { value: "en", label: "English" },
];

/** Personal settings. For now: the interface language, remembered in this browser. */
export function SettingsPage() {
  const tr = useTr();
  const { lang, setLang } = useLang();
  return (
    <>
      <PageHeader title={tr("Cài đặt")} />
      <PageBody>
        <Section
          title={tr("Ngôn ngữ")}
          description={tr("Chọn ngôn ngữ hiển thị của giao diện.")}
        >
          <div
            role="radiogroup"
            aria-label={tr("Ngôn ngữ")}
            className="flex flex-wrap gap-2"
          >
            {LANGUAGES.map((l) => (
              <Button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={lang === l.value}
                variant={lang === l.value ? "default" : "outline"}
                size="sm"
                lang={l.value}
                onClick={() => setLang(l.value)}
              >
                {l.label}
              </Button>
            ))}
          </div>
        </Section>
      </PageBody>
    </>
  );
}
