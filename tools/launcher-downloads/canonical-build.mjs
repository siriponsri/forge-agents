// Internal isolated UTC builder. The canonical service remains the sole ZIP writer.
import { createDownloadService } from '../../app/server/downloads.mjs';

try {
  const [sourceRoot, dataDir] = process.argv.slice(2);
  if (!sourceRoot || !dataDir || process.env.TZ !== 'UTC') throw new Error('Internal builder requires source/cache paths and TZ=UTC');
  const service = createDownloadService({ sourceRoot, dataDir });
  console.log(JSON.stringify(await service.metadata()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
