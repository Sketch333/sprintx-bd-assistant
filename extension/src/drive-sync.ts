export type DriveSyncResult = {
  discovered: number; chunks: number; sources: number; removed: number;
  failedFiles: string[]; skippedFiles: number; newEmbeddings: number; complete: boolean;
};

export async function continueDriveSync(
  runBatch: () => Promise<DriveSyncResult>,
  onProgress: (batch: DriveSyncResult, batchNumber: number) => void,
  signal?: AbortSignal,
): Promise<DriveSyncResult> {
  for (let batchNumber = 1; batchNumber <= 1000; batchNumber++) {
    signal?.throwIfAborted();
    const batch = await runBatch();
    signal?.throwIfAborted();
    onProgress(batch, batchNumber);
    if (batch.complete) return batch;
    if (!batch.newEmbeddings) throw new Error('Drive sync paused without embedding progress. Saved work is preserved; inspect the latest batch logs before retrying.');
  }
  throw new Error('Drive sync reached its continuation limit. Saved progress is preserved; restart sync to continue.');
}
