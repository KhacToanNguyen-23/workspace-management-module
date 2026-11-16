import { cn } from "@/lib/utils";
import type { Lang } from "./i18n";

/** Two-option VI / EN switch. */
export function LangToggle({
  lang,
  onChange,
  label,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 shrink-0 items-center rounded-md border p-0.5 text-xs"
    >
      {(["vi", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          className={cn(
            "h-full w-8 rounded-sm font-medium uppercase text-muted-foreground transition-colors hover:text-foreground",
            lang === l && "bg-secondary text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
