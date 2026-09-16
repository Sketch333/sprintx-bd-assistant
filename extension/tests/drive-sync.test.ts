import { describe, expect, it } from 'vitest';
import { continueDriveSync } from '../src/drive-sync';

const result = { discovered: 2, chunks: 1, sources: 2, removed: 0, failedFiles: [], skippedFiles: 0, newEmbeddings: 1, complete: false };
describe('Drive batch continuation', () => {
  it('continues incomplete batches and reports completion only at the end', async () => {
    let calls = 0;
    const updates: boolean[] = [];
    const final = await continueDriveSync(async () => ({ ...result, complete: ++calls === 2 }), (batch) => updates.push(batch.complete));
    expect(calls).toBe(2);
    expect(updates).toEqual([false, true]);
    expect(final.complete).toBe(true);
  });
  it('stops an incomplete batch with no progress rather than looping forever', async () => {
    await expect(continueDriveSync(async () => ({ ...result, newEmbeddings: 0 }), () => {})).rejects.toThrow(/progress/);
  });
  it('preserves an actionable error and does not blindly retry failed requests', async () => {
    await expect(continueDriveSync(async () => { throw new Error('HTTP 429 quota'); }, () => {})).rejects.toThrow('HTTP 429 quota');
  });
  it('does not start another batch after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(continueDriveSync(async () => { calls++; return result; }, () => controller.abort(), controller.signal)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
