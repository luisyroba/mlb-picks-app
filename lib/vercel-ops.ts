import { readFile } from 'node:fs/promises';
import path from 'node:path';

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_API_TIMEOUT_MS = 5000;

export const VERCEL_HOBBY_LIMITS = {
  deploymentsPerDay: 100,
  maxFunctionDurationSeconds: 300,
  fastDataTransferGb: 100,
  runtimeLogsHours: 1,
  staticFileUploadsMb: 100,
  diskSizeGb: 23
};

type LocalProjectConfig = {
  projectId: string | null;
  orgId: string | null;
  projectName: string | null;
};

type VercelDeployment = {
  uid?: string;
  url?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  source?: string | null;
  created?: number;
  createdAt?: number;
};

type VercelDeploymentsResponse = {
  deployments?: VercelDeployment[];
};

async function readLocalProjectConfig(): Promise<LocalProjectConfig> {
  try {
    const localPath = path.join(process.cwd(), '.vercel', 'project.json');
    const raw = await readFile(localPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      projectId?: string;
      orgId?: string;
      projectName?: string;
    };

    return {
      projectId: parsed.projectId ?? null,
      orgId: parsed.orgId ?? null,
      projectName: parsed.projectName ?? null
    };
  } catch {
    return {
      projectId: null,
      orgId: null,
      projectName: null
    };
  }
}

export async function buildVercelBudgetSummary() {
  const token =
    process.env.VERCEL_STATS_TOKEN ||
    process.env.VERCEL_TOKEN ||
    null;
  const localConfig = await readLocalProjectConfig();
  const projectId = process.env.VERCEL_PROJECT_ID || localConfig.projectId;
  const teamId = process.env.VERCEL_TEAM_ID || localConfig.orgId;
  const projectName = process.env.VERCEL_PROJECT_NAME || localConfig.projectName;

  if (!token || !projectId || !teamId) {
    return {
      liveUsageAvailable: false,
      planMode: 'Guardrails Hobby / Trial',
      hobbyLimits: VERCEL_HOBBY_LIMITS,
      note: 'Agrega VERCEL_STATS_TOKEN, VERCEL_PROJECT_ID y VERCEL_TEAM_ID para leer despliegues live desde Vercel.',
      live: null
    };
  }

  try {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const url =
      `${VERCEL_API_BASE}/v6/deployments` +
      `?projectId=${encodeURIComponent(projectId)}` +
      `&teamId=${encodeURIComponent(teamId)}` +
      `&limit=100&since=${since}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(VERCEL_API_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Vercel API ${response.status}`);
    }

    const payload = (await response.json()) as VercelDeploymentsResponse;
    const deployments = payload.deployments ?? [];
    const productionDeployments = deployments.filter(
      (deployment) => deployment.target === 'production'
    );
    const readyProductionDeployments = productionDeployments.filter(
      (deployment) => deployment.readyState === 'READY' || deployment.state === 'READY'
    );
    const latestDeployment = deployments[0] ?? null;

    return {
      liveUsageAvailable: true,
      planMode: 'Live deployments + Guardrails Hobby / Trial',
      hobbyLimits: VERCEL_HOBBY_LIMITS,
      note: 'Este panel usa el token de Vercel para leer despliegues recientes. Transferencia y compute siguen mostrados como guardrails de Hobby/Trial.',
      live: {
        projectName: projectName ?? 'mlb-picks-app',
        projectId,
        teamId,
        deployments30d: deployments.length,
        productionDeployments30d: productionDeployments.length,
        readyProductionDeployments30d: readyProductionDeployments.length,
        lastDeployment: latestDeployment
          ? {
              id: latestDeployment.uid ?? null,
              state: latestDeployment.readyState ?? latestDeployment.state ?? 'UNKNOWN',
              target: latestDeployment.target ?? 'preview',
              source: latestDeployment.source ?? 'unknown',
              url: latestDeployment.url ? `https://${latestDeployment.url}` : null,
              createdAt:
                typeof latestDeployment.created === 'number'
                  ? new Date(latestDeployment.created).toISOString()
                  : typeof latestDeployment.createdAt === 'number'
                    ? new Date(latestDeployment.createdAt).toISOString()
                    : null
            }
          : null
      }
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Vercel stats error';

    return {
      liveUsageAvailable: false,
      planMode: 'Guardrails Hobby / Trial',
      hobbyLimits: VERCEL_HOBBY_LIMITS,
      note: `No pude leer stats live de Vercel: ${message}. Se muestran guardrails estáticos.`,
      live: null
    };
  }
}
