import { cn } from "@/lib/utils";

/** HyperSpace mark: two overlapping sheets, the shared space between them filled. */
export function HyperSpaceMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-6", className)}
      aria-hidden
      focusable="false"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#0071bc" />
      <rect
        x="11"
        y="11"
        width="18"
        height="18"
        rx="4"
        fill="#ffffff"
        stroke="#0071bc"
        strokeWidth="2"
      />
      <path d="M11 15a4 4 0 0 1 4-4h6v6a4 4 0 0 1-4 4h-6z" fill="#0071bc" />
    </svg>
  );
}

export function HyperSpaceWordmark({
  className,
  sub,
}: {
  className?: string;
  sub?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <HyperSpaceMark />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          HyperSpace
        </span>
        {sub && (
          <span className="text-[11px] font-normal text-muted-foreground">
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
