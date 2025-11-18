import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';

// Configure route to accept large request bodies
export const maxDuration = 60; // 60 seconds
export const runtime = 'nodejs';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { PlayerHistory } from '@/src/entities/PlayerHistory';
import { processPlayerHistoryCSV } from '@/src/utils/csvProcessor';
import { withApiLogging, logger, withQueryLogging } from '@/src/lib/logger';
import { ApiResponse } from '@/src/lib/common/ApiResponse';
import { ProcessCsvFileRequest, PlayerHistoryResponse, CsvUploadMode } from '@/src/types/ProcessCsv.types';
import { Nullable } from '@/src/lib/common/Nullable';
import { upsertDatasetStatus } from '@/src/lib/datasetStatus';
import { Repository } from 'typeorm';

function parseUploadMode(value: FormDataEntryValue | string | null | undefined): CsvUploadMode {
  if (typeof value === 'string' && value.toLowerCase() === 'append') {
    return 'append';
  }
  return 'replace';
}

async function persistPlayerHistoryRecords(
  repo: Repository<PlayerHistory>,
  uploadMode: CsvUploadMode,
  playerRecords: Nullable<PlayerHistory[]>,
  batchSize: number
): Promise<number> {
  if (uploadMode === 'replace') {
    logger.info('Clearing existing player history records (replace mode)');
    await withQueryLogging('clear player history records', () => repo.clear());
  } else {
    logger.info('Append mode: keeping existing player history records');
  }

  if (playerRecords && playerRecords.length > 0) {
    const totalRecords = playerRecords.length;
    const recordsToInsert = playerRecords;

    logger.debug('Inserting player history records in batches', {
      totalRecords,
      batchSize,
    });

    for (let i = 0; i < totalRecords; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      await withQueryLogging(
        `insert player history batch ${batchNumber}/${totalBatches}`,
        () => repo.insert(batch)
      );

      logger.debug('Inserted batch of player history records', {
        batchNumber,
        totalBatches,
        batchSize: batch.length,
        progress: `${Math.round(((i + batch.length) / totalRecords) * 100)}%`,
      });
    }

    logger.info('Player history records inserted successfully', {
      totalRecords,
    });

    return totalRecords;
  }

  if (uploadMode === 'replace') {
    logger.info('No valid player history records to insert, database cleared (replace mode)');
  } else {
    logger.info('No valid player history records to insert, existing data unchanged (append mode)');
  }

  return 0;
}

/**
 * Decode CSV content from request body
 * Handles both plain string and base64 encoded bytes
 */
function decodeCsvContent(content: string): string {
  try {
    // Try to decode as base64 first (if it's bytes in JSON)
    const decoded = Buffer.from(content, 'base64').toString('utf-8');
    // If decoded content looks like valid CSV (has commas or newlines), use it
    if (decoded.includes(',') || decoded.includes('\n')) {
      return decoded;
    }
  } catch {
    // If base64 decode fails, treat as plain string
  }
  // Return as-is if it's already a string
  return content;
}

async function handlePOST(request: NextRequest): Promise<NextResponse<ApiResponse<PlayerHistoryResponse>>> {
  try {
    await initializeDatabase();

    // Handle FormData (multipart/form-data) - no external library needed
    const contentType = request.headers.get('content-type') || '';
    let csvContent: string;
    let uploadMode: CsvUploadMode = 'replace';

    if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        uploadMode = parseUploadMode(formData.get('mode'));

        if (!file || !(file instanceof File)) {
          return NextResponse.json<ApiResponse<PlayerHistoryResponse>>(
            {
              success: false,
              status_code: StatusCodes.BAD_REQUEST,
              message: 'Missing file in FormData. Expected a file field named "file".',
              data: null,
            },
            { status: StatusCodes.BAD_REQUEST }
          );
        }

        // Read file content as text
        csvContent = await file.text();
        logger.info('Received file via FormData', { fileName: file.name, size: file.size });
      } catch (error) {
        logger.error('Failed to parse FormData', error instanceof Error ? error : new Error(String(error)));
        return NextResponse.json<ApiResponse<PlayerHistoryResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: `Invalid FormData: ${error instanceof Error ? error.message : 'Unknown error'}. Expected a file field named "file".`,
            error_raw: error instanceof Error ? error : new Error(String(error)),
            data: null,
          },
          { status: StatusCodes.BAD_REQUEST }
        );
      }
    } else {
      // Fallback to JSON format (backward compatibility)
      let body: ProcessCsvFileRequest;
      try {
        body = await request.json();
      } catch (error) {
        logger.error('Failed to parse request body', error instanceof Error ? error : new Error(String(error)));
        return NextResponse.json<ApiResponse<PlayerHistoryResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: 'Invalid request body. Expected FormData with file field or JSON with fileData field.',
            error_raw: error instanceof Error ? error : new Error(String(error)),
            data: null,
          },
          { status: StatusCodes.BAD_REQUEST }
        );
      }

      if (!body.fileData) {
        return NextResponse.json<ApiResponse<PlayerHistoryResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: 'Missing required field: fileData is required',
            data: null,
          },
          { status: StatusCodes.BAD_REQUEST }
        );
      }

      // Decode CSV content (handles both plain string and base64)
      csvContent = decodeCsvContent(body.fileData);
      logger.info('Received CSV content via JSON', { contentLength: csvContent.length });
      uploadMode = parseUploadMode(body.mode);
    }

    let recordsProcessed = 0;
    let playerRecords: Nullable<PlayerHistory[]> = null;
    let playerErrors: Nullable<string[]> = null;

    // Process player history CSV
    try {
      logger.info('Processing player history CSV', { mode: uploadMode });
      
      const processed = await processPlayerHistoryCSV(csvContent);
      playerRecords = processed.records;
      playerErrors = processed.errors;

      const batchSize = 50; // Safe batch size for SQLite variable limit

      const processWithinRepo = async (repo: Repository<PlayerHistory>) => {
        return persistPlayerHistoryRecords(repo, uploadMode, playerRecords, batchSize);
      };

      try {
        recordsProcessed = await AppDataSource.transaction(async (transactionalEntityManager) => {
          const transactionalRepo = transactionalEntityManager.getRepository(PlayerHistory);
          return processWithinRepo(transactionalRepo);
        });
      } catch (error) {
        if (error instanceof Error && /no transaction is active/i.test(error.message)) {
          logger.warn(
            'SQLite transaction commit failed for player history, retrying without transaction',
            { mode: uploadMode, error: error.message }
          );
          const repo = AppDataSource.getRepository(PlayerHistory);
          recordsProcessed = await processWithinRepo(repo);
        } else {
          throw error;
        }
      }

      if (playerErrors && playerErrors.length > 0) {
        logger.warn('Player history processing errors', {
          errorCount: playerErrors.length,
          errors: playerErrors,
        });
      }

      logger.info('Player history processing completed', {
        recordsProcessed: playerRecords?.length || 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing player history CSV', error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }

    const playerRepo = AppDataSource.getRepository(PlayerHistory);
    const databaseRecords = await playerRepo.count();
    const datasetStatus = await upsertDatasetStatus('player-history', databaseRecords);

    return NextResponse.json<ApiResponse<PlayerHistoryResponse>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Player history CSV processing completed',
      data: {
        totalRecords: playerRecords?.length || 0,
        recordsProcessed,
        errors: playerErrors && playerErrors.length > 0 ? playerErrors : null,
        databaseRecords,
        lastUpdatedAt: datasetStatus.last_updated_at ? datasetStatus.last_updated_at.toISOString() : null,
      },
    });
  } catch (error) {
    logger.error('Error processing player history CSV', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json<ApiResponse<PlayerHistoryResponse>>(
      {
        success: false,
        status_code: StatusCodes.INTERNAL_SERVER_ERROR,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        error_raw: error instanceof Error ? error : new Error(String(error)),
        data: null,
      },
      { status: StatusCodes.INTERNAL_SERVER_ERROR }
    );
  }
}

// Wrap POST handler with API logging
export const POST = withApiLogging(handlePOST);

