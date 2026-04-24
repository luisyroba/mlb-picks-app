export type ManualSettleStatus = 'won' | 'lost';

export type ManualSettleSuccess = {
  ok: true;
  pick: {
    id: string;
    status: string;
    result: string | null;
    profitUnits: number | null;
    updatedAt: string;
  };
};

export type ManualSettleFailure = {
  ok: false;
  error: string;
};

export type ManualSettleResponse = ManualSettleSuccess | ManualSettleFailure;

export async function settlePickManually(
  pickId: string,
  status: ManualSettleStatus,
  originHint: string
): Promise<ManualSettleSuccess> {
  const response = await fetch('/picks/settle-manual', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-origin-hint': originHint
    },
    body: JSON.stringify({
      pickId,
      status
    })
  });

  const payload = (await response.json()) as ManualSettleResponse;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? 'No se pudo cerrar el pick manualmente.' : payload.error);
  }

  return payload;
}
