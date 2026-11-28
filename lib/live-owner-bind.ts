import { ownerIsLive } from '@/db/storage';
import { withLiveOwner as guardLiveOwner, type LiveOwnerResult } from './live-owner.ts';
import { withOwnerWork } from './owner-work.ts';

const deps = {
  withLock: withOwnerWork,
  isLive: ownerIsLive,
};

export function withLiveOwner<T>(ownerId: string, write: () => Promise<T>): Promise<LiveOwnerResult<T>> {
  return guardLiveOwner(ownerId, write, deps);
}
