import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { finishNonStreamSync } from './non-stream-sync.ts';

describe('non-stream bookmark sync', () => {
  it('awaits labeling before the success response', async () => {
    const order: string[] = [];
    const settled = await finishNonStreamSync(
      async () => {
        order.push('import');
        return { imported: 2, cursor: '20' as string | null };
      },
      async () => {
        order.push('label');
        await Promise.resolve();
        order.push('label-done');
      },
    );
    order.push('returned');
    assert.equal(settled.status, 200);
    assert.equal(settled.error, undefined);
    assert.deepEqual(order, ['import', 'label', 'label-done', 'returned']);
  });

  it('returns the thrown import or store error as 502 and does not label', async () => {
    let labeled = false;
    const settled = await finishNonStreamSync(
      async () => {
        throw new Error('database unavailable');
      },
      async () => {
        labeled = true;
      },
    );
    assert.equal(settled.status, 502);
    assert.equal(settled.error, 'database unavailable');
    assert.equal(labeled, false);
    assert.equal(settled.result, undefined);
  });

  it('skips labeling when the import already failed and kept its cursor', async () => {
    let labeled = false;
    const settled = await finishNonStreamSync(
      async () => ({ imported: 20, cursor: '20', error: 'X API error (503). Saved pages stay imported. Sync again to continue.' }),
      async () => {
        labeled = true;
      },
    );
    assert.equal(settled.status, 502);
    assert.equal(labeled, false);
    assert.equal(settled.result?.cursor, '20');
    assert.match(settled.error ?? '', /503/);
  });

  it('guard: the non-stream route awaits labeling inside the import try/catch', () => {
    const source = readFileSync(new URL('../app/api/bookmarks/sync/route.ts', import.meta.url), 'utf8');
    const start = source.indexOf('if (!stream)');
    const end = source.indexOf('const encoder');
    assert.ok(start >= 0 && end > start);
    const block = source.slice(start, end);
    const tryAt = block.indexOf('try');
    const finishAt = block.indexOf('finishNonStreamSync');
    const labelAt = block.indexOf('labelAfterSync');
    const catchAt = block.search(/catch\s*\(/);
    assert.ok(tryAt >= 0 && finishAt > tryAt && labelAt > tryAt && catchAt > finishAt);
  });
});
