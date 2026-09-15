import { config } from '../config';
import { createVectorStore } from '../lib/vector-store';
import { runFullIngest } from '../lib/ingest';

async function main(): Promise<void> {
  const vectorStore = await createVectorStore();
  const result = await runFullIngest(vectorStore, {
    driveRoot: config.driveRoot,
    siteUrls: config.siteUrls,
  });

  console.log('Ingestion summary:', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Ingestion failed:', error);
  process.exit(1);
});
