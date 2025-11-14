import 'reflect-metadata';
import { initializeDatabase, closeDatabase } from '../src/lib/database';
import { AppDataSource } from '../src/data-source';
import { ContentPerformance } from '../src/entities/ContentPerformance';
import { PlayerHistory } from '../src/entities/PlayerHistory';
import { processContentPerformanceCSV, processPlayerHistoryCSV } from '../src/utils/csvProcessor';
import path from 'node:path';

async function run() {
  console.log('Initializing database...');
  await initializeDatabase();

  const assetsPath = path.join(process.cwd(), 'assets');
  const contentPerformancePath = path.join(assetsPath, 'content_performance.csv');
  const playerHistoryPath = path.join(assetsPath, 'player_history.csv');

  // Process content_performance.csv
  console.log('\n=== Processing content_performance.csv ===');
  const { records: contentRecords, errors: contentErrors } = 
    await processContentPerformanceCSV(contentPerformancePath);

  if (contentErrors.length > 0) {
    console.warn(`\n⚠️  Found ${contentErrors.length} errors while processing content_performance.csv:`);
    contentErrors.slice(0, 10).forEach((error) => console.warn(`  - ${error}`));
    if (contentErrors.length > 10) {
      console.warn(`  ... and ${contentErrors.length - 10} more errors`);
    }
  }

  if (contentRecords.length > 0) {
    console.log(`Saving ${contentRecords.length} records to database...`);
    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    // Batch saves to avoid stack overflow
    const batchSize = 1000;
    for (let i = 0; i < contentRecords.length; i += batchSize) {
      const batch = contentRecords.slice(i, i + batchSize);
      await contentRepo.save(batch);
      if ((i + batchSize) % 10000 === 0 || i + batchSize >= contentRecords.length) {
        console.log(`  Progress: ${Math.min(i + batchSize, contentRecords.length)}/${contentRecords.length} records saved`);
      }
    }
    console.log(`✅ Successfully saved ${contentRecords.length} content performance records`);
  } else {
    console.log('⚠️  No records to save');
  }

  // Process player_history.csv
  console.log('\n=== Processing player_history.csv ===');
  const { records: playerRecords, errors: playerErrors } = 
    await processPlayerHistoryCSV(playerHistoryPath);

  if (playerErrors.length > 0) {
    console.warn(`\n⚠️  Found ${playerErrors.length} errors while processing player_history.csv:`);
    playerErrors.slice(0, 10).forEach((error) => console.warn(`  - ${error}`));
    if (playerErrors.length > 10) {
      console.warn(`  ... and ${playerErrors.length - 10} more errors`);
    }
  }

  if (playerRecords.length > 0) {
    console.log(`Saving ${playerRecords.length} records to database...`);
    const playerRepo = AppDataSource.getRepository(PlayerHistory);
    // Batch saves to avoid stack overflow
    const batchSize = 1000;
    for (let i = 0; i < playerRecords.length; i += batchSize) {
      const batch = playerRecords.slice(i, i + batchSize);
      await playerRepo.save(batch);
      if ((i + batchSize) % 10000 === 0 || i + batchSize >= playerRecords.length) {
        console.log(`  Progress: ${Math.min(i + batchSize, playerRecords.length)}/${playerRecords.length} records saved`);
      }
    }
    console.log(`✅ Successfully saved ${playerRecords.length} player history records`);
  } else {
    console.log('⚠️  No records to save');
  }

  console.log('\n✅ CSV processing completed successfully!');
  await closeDatabase();
}

try {
  await run();
} catch (error) {
  console.error('❌ Error processing CSV files:', error);
  process.exit(1);
}

