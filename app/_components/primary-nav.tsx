'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { startTransition, useCallback, useEffect, useState } from 'react';

const NAV_LIVE_REFRESH_MS = 60_000;

type LiveCountResponse = {
  ok: boolean;
  liveCount?: number;
  error?: string;
};

const NAV_ITEMS = [
  { href: '/', label: 'Console' },
  { href: '/picks', label: 'Picks' },
  { href: '/live', label: 'Live' },
  { href: '/stats', label: 'Stats' }
] as const;

export function PrimaryNav({ className = 'mt-4' }: { className?: string }) {
  const pathname = usePathname();
  const [liveCount, setLiveCount] = useState(0);

  const refreshLiveCount = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/live-count', {
        cache: 'no-store',
        signal
      });
      const payload = (await response.json()) as LiveCountResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'No se pudo cargar el badge live.');
      }

      const nextCount = typeof payload.liveCount === 'number' ? payload.liveCount : 0;
      startTransition(() => {
        setLiveCount(nextCount);
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshLiveCount(controller.signal);

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshLiveCount();
    }, NAV_LIVE_REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshLiveCount]);

  return (
    <div className={className}>
      <div className="mx-auto flex w-full max-w-[1620px] justify-center">
        <nav className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-[rgba(9,28,57,0.08)] bg-white/78 p-1.5 text-sm text-[var(--ink-soft)] shadow-[0_18px_45px_rgba(9,28,57,0.08)]">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const showLiveBadge = item.href === '/live' && liveCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-full whitespace-nowrap px-3.5 py-2 font-medium transition ${
                  active
                    ? 'bg-[var(--surface-navy)] text-white shadow-[0_14px_28px_rgba(9,28,57,0.18)]'
                    : 'hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]'
                }`}
              >
                <span>{item.label}</span>
                {showLiveBadge && (
                  <span className={`inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    active
                      ? 'bg-white/18 text-white ring-1 ring-white/15'
                      : 'bg-[var(--accent-red)] text-white shadow-[0_10px_18px_rgba(244,63,94,0.26)]'
                  }`}>
                    {liveCount > 9 ? '9+' : liveCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
