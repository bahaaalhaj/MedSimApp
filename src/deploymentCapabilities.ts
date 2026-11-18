/** Presentation flags only. Ownership, grading and deployment policy stay server-side. */
export interface DeploymentCapabilities {
  deploymentMode: 'ordinary' | 'vercel-guest-demo';
  accounts: boolean;
  audio: boolean;
  guestId?: string;
}

const demoBuild = import.meta.env?.VITE_MEDSIM_DEPLOYMENT_MODE === 'vercel-guest-demo';
let current: Readonly<DeploymentCapabilities> = Object.freeze({
  deploymentMode: demoBuild ? 'vercel-guest-demo' : 'ordinary',
  accounts: !demoBuild,
  audio: !demoBuild,
});
export const capabilities = () => current;

export function acceptCapabilities(value: unknown, expectedDemo = demoBuild): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid deployment capabilities.');
  const next = value as DeploymentCapabilities;
  if (next.deploymentMode !== (expectedDemo ? 'vercel-guest-demo' : 'ordinary')
    || next.accounts !== !expectedDemo || next.audio !== !expectedDemo
    || (expectedDemo && (typeof next.guestId !== 'string' || !/^demo_[A-Za-z0-9_-]{43}$/.test(next.guestId)))) {
    throw new Error('Frontend and server deployment modes do not match.');
  }
  current = Object.freeze({ ...next });
}

export async function loadCapabilities(): Promise<void> {
  const response = await fetch('/api/capabilities', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('The encounter service is unavailable. Reload to try again.');
  acceptCapabilities(await response.json());
}
