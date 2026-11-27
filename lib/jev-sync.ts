import { applyJevLabels, prepareJevLabels, type JevRunResult } from '@/db/jev';
import { withLiveOwner } from './live-owner-bind';
import { getRuntimeValue } from './runtime-env';

export function jevEnabled() {
  return Boolean(getRuntimeValue('TYPESAFE_API_KEY'));
}

function reportJev(result: JevRunResult) {
  if (result.considered) console.info(`[stimgraph] jev labeled ${result.labeled}/${result.considered} (accepted ${result.accepted}, failed ${result.failed})`);
  return result;
}

export async function labelAfterSync(ownerId: string, limit = 200) {
  const apiKey = getRuntimeValue('TYPESAFE_API_KEY');
  if (!apiKey) return null;
  try {
    const prepared = await prepareJevLabels(ownerId, apiKey, { limit });
    const outcome = await withLiveOwner(ownerId, () => applyJevLabels(ownerId, prepared));
    if (!outcome.live) return null;
    return reportJev(outcome.value);
  } catch (error) {
    console.warn(`[stimgraph] jev labeling skipped: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
}
