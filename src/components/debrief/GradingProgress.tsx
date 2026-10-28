import { StatusBanner } from './StatusBanner';

export function GradingProgress({ partialNarration }: { partialNarration: string }) {
  return <StatusBanner title="Preparing your formative feedback…"
    body={partialNarration || 'Synchronizing your recorded actions and retrieving server-owned grading. Optional model feedback may fall back to deterministic grading. Keep this page open; a connection failure will offer a safe retry.'}
    bg="var(--sky)" />;
}
