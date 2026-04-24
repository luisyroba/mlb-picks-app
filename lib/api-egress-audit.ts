import { NextResponse } from 'next/server';

type AuditMeta = Record<string, unknown>;

function countJsonContainers(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce((total, item) => total + countJsonContainers(item), 0);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    let total = 1;
    for (const key in record) {
      total += countJsonContainers(record[key]);
    }
    return total;
  }

  return 0;
}

export function getOriginHint(headers: Headers): string | null {
  const value = headers.get('x-origin-hint');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function jsonResponseWithAudit(
  route: string,
  payload: unknown,
  meta: AuditMeta,
  init: ResponseInit = {}
) {
  const json = JSON.stringify(payload);
  const responseBytes = new TextEncoder().encode(json).length;
  const status = init.status ?? 200;

  console.info(
    `[egress-audit] ${JSON.stringify({
      route,
      timestamp: new Date().toISOString(),
      status,
      responseBytes,
      jsonContainers: countJsonContainers(payload),
      ...meta
    })}`
  );

  return new NextResponse(json, {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers
    }
  });
}
