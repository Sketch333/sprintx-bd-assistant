import { config } from '../config';
import { runFullIngest } from '../lib/ingest';
import { createVectorStore } from '../lib/vector-store';

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ') || 'What services does SprintX provide?';
  const vectorStore = await createVectorStore();
  await runFullIngest(vectorStore, {
    driveRoot: config.driveRoot,
    siteUrls: config.siteUrls,
  });

  const results = await vectorStore.search(query, 5);
  console.log(JSON.stringify({ query, results }, null, 2));
}

main().catch((error) => {
  console.error('Search failed:', error);
  process.exit(1);
});
