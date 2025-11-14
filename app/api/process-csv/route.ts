import 'reflect-metadata';
import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/src/lib/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
import { PlayerHistory } from '@/src/entities/PlayerHistory';
import { processContentPerformanceCSV, processPlayerHistoryCSV } from '@/src/utils/csvProcessor';
import path from 'node:path';

export async function POST() {
  try {
    // Initialize database connection
    await initializeDatabase();

    const assetsPath = path.join(process.cwd(), 'assets');
    const contentPerformancePath = path.join(assetsPath, 'content_performance.csv');
    const playerHistoryPath = path.join(assetsPath, 'player_history.csv');

    const results = {
      contentPerformance: { success: false, recordsProcessed: 0, errors: [] as string[] },
      playerHistory: { success: false, recordsProcessed: 0, errors: [] as string[] },
    };

    // Process content_performance.csv
    try {
      console.log('Processing content_performance.csv...');
      const { records: contentRecords, errors: contentErrors } = 
        await processContentPerformanceCSV(contentPerformancePath);

      if (contentRecords.length > 0) {
        const contentRepo = AppDataSource.getRepository(ContentPerformance);
        // Clear existing data (optional - remove if you want to append)
        // await contentRepo.clear();
        // Batch saves to avoid stack overflow
        const batchSize = 1000;
        for (let i = 0; i < contentRecords.length; i += batchSize) {
          const batch = contentRecords.slice(i, i + batchSize);
          await contentRepo.save(batch);
        }
        results.contentPerformance.success = true;
        results.contentPerformance.recordsProcessed = contentRecords.length;
      }
      
      if (contentErrors.length > 0) {
        results.contentPerformance.errors = contentErrors;
      }

      console.log(`Processed ${contentRecords.length} content performance records`);
    } catch (error) {
      results.contentPerformance.errors.push(
        error instanceof Error ? error.message : String(error)
      );
    }

    // Process player_history.csv
    try {
      console.log('Processing player_history.csv...');
      const { records: playerRecords, errors: playerErrors } = 
        await processPlayerHistoryCSV(playerHistoryPath);

      if (playerRecords.length > 0) {
        const playerRepo = AppDataSource.getRepository(PlayerHistory);
        // Clear existing data (optional - remove if you want to append)
        // await playerRepo.clear();
        // Batch saves to avoid stack overflow
        const batchSize = 1000;
        for (let i = 0; i < playerRecords.length; i += batchSize) {
          const batch = playerRecords.slice(i, i + batchSize);
          await playerRepo.save(batch);
        }
        results.playerHistory.success = true;
        results.playerHistory.recordsProcessed = playerRecords.length;
      }
      
      if (playerErrors.length > 0) {
        results.playerHistory.errors = playerErrors;
      }

      console.log(`Processed ${playerRecords.length} player history records`);
    } catch (error) {
      results.playerHistory.errors.push(
        error instanceof Error ? error.message : String(error)
      );
    }

    return NextResponse.json({
      success: true,
      results,
      message: 'CSV processing completed',
    });
  } catch (error) {
    console.error('Error processing CSV files:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint to process CSV files',
    endpoint: '/api/process-csv',
  });
}

