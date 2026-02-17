import Image from "next/image";
import { Activity } from "lucide-react";

interface NprmHeaderProps {
  locationCount: number;
  lastRefresh: string | null;
}

function formatNigeriaTime(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export function NprmHeader({ locationCount, lastRefresh }: NprmHeaderProps) {
  return (
    <header className="relative grid min-h-[4.75rem] grid-cols-[1fr_auto] items-start gap-2 border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-3 py-2 md:flex md:h-14 md:items-center md:justify-between md:px-4 md:py-0">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <div className="relative h-6 w-6 shrink-0">
          <Image
            src="/land-republic-mark.svg"
            alt="Land Republic logo"
            fill
            className="object-contain"
            sizes="24px"
            priority
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-mono text-[11px] font-semibold leading-tight tracking-wide text-[var(--ds-gray-1000)] sm:text-sm md:text-base">
            Nigeria Property Risk Monitor
          </h1>
          <p className="font-mono text-[9px] leading-tight text-[var(--ds-gray-900)] sm:text-[10px] md:text-[11px]">
            Explore risk signals before you buy, rent, or invest.
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-2 rounded-full border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-3 py-1 font-mono text-xs text-[var(--ds-gray-900)] md:flex">
        <Activity className="h-3.5 w-3.5 text-[var(--ds-blue-600)]" />
        <span>{locationCount} locations tracked</span>
      </div>

      <div className="text-right font-mono text-[9px] leading-tight text-[var(--ds-gray-900)] sm:text-[10px] md:text-xs">
        <div className="font-semibold uppercase tracking-[0.15em]">Last refresh</div>
        <div className="max-w-[10rem] md:max-w-none">{lastRefresh ? `${formatNigeriaTime(lastRefresh)} WAT` : "Loading..."}</div>
      </div>
    </header>
  );
}
