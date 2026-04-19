import type { Metadata } from 'next';
import { Bricolage_Grotesque, Source_Serif_4 } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import './globals.css';

const headingFont = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap'
});

const bodyFont = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'MLB Picks Studio',
  description: 'Studio privado para analizar MLB, confirmar ejecuciones y auditar resultados.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${headingFont.variable} ${bodyFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-[var(--app-bg)] text-[var(--ink-strong)]">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-8%] top-[-10%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(31,183,255,0.18),transparent_68%)]" />
          <div className="absolute right-[-10%] top-[6%] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(214,38,61,0.14),transparent_70%)]" />
          <div className="absolute bottom-[-12%] left-[26%] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(9,28,57,0.18),transparent_72%)]" />
        </div>

        <header className="sticky top-0 z-30 border-b border-[rgba(9,28,57,0.08)] bg-[rgba(248,246,241,0.86)] backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[1620px] items-center justify-between gap-4 px-3 py-3 lg:px-5">
            <Link href="/" className="flex min-w-0 items-center gap-3">
              <div className="relative overflow-hidden rounded-[1.2rem] border border-[rgba(9,28,57,0.08)] bg-[linear-gradient(145deg,#081a35,#0b315e)] p-1.5 shadow-[0_16px_40px_rgba(9,28,57,0.16)]">
                <Image src="/luis-yroba-logo.png" alt="Luis Yroba Baseball" width={64} height={64} className="h-12 w-12 object-contain" priority />
              </div>
              <div>
                <div className="font-heading text-xs font-semibold uppercase tracking-[0.32em] text-[var(--ink-muted)]">
                  Luis Yroba MLB
                </div>
                <div className="text-sm text-[var(--ink-soft)]">
                  Console compacta de análisis, ejecución y auditoría.
                </div>
              </div>
            </Link>

            <nav className="flex items-center gap-1.5 rounded-full border border-[rgba(9,28,57,0.08)] bg-white/78 p-1.5 text-sm text-[var(--ink-soft)] shadow-[0_18px_45px_rgba(9,28,57,0.08)]">
              <Link href="/" className="rounded-full px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
                Console
              </Link>
              <Link href="/picks" className="rounded-full px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
                Picks
              </Link>
              <Link href="/stats" className="rounded-full px-3.5 py-2 font-medium transition hover:bg-[rgba(9,28,57,0.06)] hover:text-[var(--ink-strong)]">
                Stats
              </Link>
            </nav>
          </div>
        </header>

        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
