'use client';

import { memo, useEffect, useRef } from 'react';
import type { ManualSettleStatus } from '@/lib/manual-settle-client';

type ManualSettlePopoverProps = {
  open: boolean;
  pending: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSettle: (status: ManualSettleStatus) => void;
};

export const ManualSettlePopover = memo(function ManualSettlePopover({
  open,
  pending,
  loading,
  error,
  onClose,
  onSettle
}: ManualSettlePopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!pending || !open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="absolute right-3 top-3 z-30 w-[168px] rounded-[1rem] border border-[rgba(9,28,57,0.1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,243,235,0.96))] p-2.5 shadow-[0_20px_36px_rgba(9,28,57,0.18)] backdrop-blur"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        Settle manual
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onSettle('won')}
          disabled={loading}
          className="rounded-[0.8rem] border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          WON
        </button>
        <button
          type="button"
          onClick={() => onSettle('lost')}
          disabled={loading}
          className="rounded-[0.8rem] border border-rose-200 bg-rose-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          LOST
        </button>
      </div>
      {loading ? (
        <div className="mt-2 text-[10px] text-[var(--ink-muted)]">Guardando...</div>
      ) : null}
      {error ? (
        <div className="mt-2 text-[10px] leading-4 text-rose-700">{error}</div>
      ) : null}
    </div>
  );
});
