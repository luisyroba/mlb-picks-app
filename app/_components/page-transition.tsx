'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';

const TAB_ORDER = ['console', 'picks', 'live', 'stats'] as const;

const transition = {
  duration: 0.18,
  ease: 'easeOut' as const
};

function getTabKey(pathname: string) {
  if (pathname === '/') return 'console';
  if (pathname.startsWith('/picks')) return 'picks';
  if (pathname.startsWith('/live')) return 'live';
  if (pathname.startsWith('/stats')) return 'stats';
  return null;
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const previousPathRef = useRef(pathname);
  const [direction, setDirection] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTab = useMemo(() => getTabKey(pathname), [pathname]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (previousPath === pathname) {
      return;
    }

    const previousTab = getTabKey(previousPath);
    if (!previousTab || !currentTab) {
      setDirection(0);
      previousPathRef.current = pathname;
      return;
    }

    const previousIndex = TAB_ORDER.indexOf(previousTab);
    const currentIndex = TAB_ORDER.indexOf(currentTab);

    if (currentIndex > previousIndex) {
      setDirection(1);
    } else if (currentIndex < previousIndex) {
      setDirection(-1);
    } else {
      setDirection(0);
    }

    previousPathRef.current = pathname;
  }, [pathname, currentTab]);

  if (!mounted || prefersReducedMotion) {
    return <div className="flex-1">{children}</div>;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={pathname}
        initial={{ x: direction === 1 ? 30 : direction === -1 ? -30 : 0, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: direction === 1 ? -30 : direction === -1 ? 30 : 0, opacity: 0 }}
        transition={transition}
        className="flex-1 will-change-[opacity,transform]"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
