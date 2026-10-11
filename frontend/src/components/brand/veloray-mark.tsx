import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function VeloRayMark({ className = "h-9 w-9" }: { className?: string }) {
  useLocale();
  return (
    <img
      src="/veloray-logo.png"
      alt="VeloRay"
      className={cn("shrink-0 object-contain select-none", className)}
      draggable={false}
    />
  );
}

export function VeloRayWordmark({ compact = false }: { compact?: boolean }) {
  useLocale();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center">
        <VeloRayMark className="h-9 w-9 drop-shadow-[0_8px_18px_rgba(0,237,123,.12)]" />
      </div>
      <div className={compact ? "hidden" : "min-w-0"}>
        <div className="truncate text-[14px] font-semibold tracking-[-.01em] text-[var(--fg)]">
          VeloRay
        </div>
      </div>
    </div>
  );
}
