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
    <header className="relative flex h-14 items-center justify-between border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-4">
      <div className="flex items-center gap-3">
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
        <div className="flex flex-col">
          <h1 className="font-mono text-sm font-semibold tracking-wide text-[var(--ds-gray-1000)] md:text-base">
            Nigeria Property Risk Monitor
          </h1>
          <p className="font-mono text-[10px] text-[var(--ds-gray-900)] md:text-[11px]">
            Explore risk signals before you buy, rent, or invest.
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-2 rounded-full border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-3 py-1 font-mono text-xs text-[var(--ds-gray-900)] md:flex">
        <Activity className="h-3.5 w-3.5 text-[var(--ds-blue-600)]" />
        <span>{locationCount} locations tracked</span>
      </div>

      <div className="text-right font-mono text-[10px] text-[var(--ds-gray-900)] md:text-xs">
        <div className="font-semibold uppercase tracking-[0.15em]">Last refresh</div>
        <div>{lastRefresh ? `${formatNigeriaTime(lastRefresh)} WAT` : "Loading..."}</div>
      </div>
    </header>
  );
}
