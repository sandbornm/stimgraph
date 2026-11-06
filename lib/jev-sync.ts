import { labelPendingBookmarks } from '@/db/jev';
import { getRuntimeValue } from './runtime-env';

export function jevEnabled() {
  return Boolean(getRuntimeValue('TYPESAFE_API_KEY'));
}

export async function labelAfterSync(ownerId: string, limit = 200) {
  const apiKey = getRuntimeValue('TYPESAFE_API_KEY');
  if (!apiKey) return null;
  try {
    const result = await labelPendingBookmarks(ownerId, apiKey, { limit });
    if (result.considered) console.info(`[stimgraph] jev labeled ${result.labeled}/${result.considered} (accepted ${result.accepted}, failed ${result.failed})`);
    return result;
  } catch (error) {
    console.warn(`[stimgraph] jev labeling skipped: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
}
