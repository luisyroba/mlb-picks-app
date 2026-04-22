import Link from 'next/link';

export function PrimaryNav({ className = 'mt-4' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="mx-auto flex w-full max-w-[1620px] justify-center">
        <nav className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-[rgba(9,28,57,0.08)] bg-white/78 p-1.5 text-sm text-[var(--ink-soft)] shadow-[0_18px_45px_rgba(9,28,57,0.08)]">
          <Link href="/" className="rounded-full whitespace-nowrap px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
            Console
          </Link>
          <Link href="/picks" className="rounded-full whitespace-nowrap px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
            Picks
          </Link>
          <Link href="/live" className="rounded-full whitespace-nowrap px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
            Live
          </Link>
          <Link href="/stats" className="rounded-full whitespace-nowrap px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
            Stats
          </Link>
        </nav>
      </div>
    </div>
  );
}
