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
import { ProcessCsvFileRequest, PlayerHistoryResponse } from '@/src/types/ProcessCsv.types';
import { Nullable } from '@/src/lib/common/Nullable';

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

    if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

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
    }

    let recordsProcessed = 0;
    let playerRecords: Nullable<PlayerHistory[]> = null;
    let playerErrors: Nullable<string[]> = null;

    // Process player history CSV
    try {
      logger.info('Processing player history CSV');
      const processed = await processPlayerHistoryCSV(csvContent);
      playerRecords = processed.records;
      playerErrors = processed.errors;

      if (playerRecords && playerRecords.length > 0) {
        // SQLite has a limit on SQL variables (typically 999 or 32766)
        // PlayerHistory has ~20 columns, so batch size should be: limit / columns
        // Using 50 records per batch to be safe (50 * 20 = 1000 variables, but some may be null)
        const batchSize = 50; // Safe batch size for SQLite variable limit
        const totalRecords = playerRecords.length;
        const recordsToInsert = playerRecords; // Store reference to avoid null checks
        
        // Use a transaction for better performance and atomicity
        await AppDataSource.transaction(async (transactionalEntityManager) => {
          const transactionalRepo = transactionalEntityManager.getRepository(PlayerHistory);
          
          // Clear existing data before inserting new records (replace mode)
          logger.info('Clearing existing player history records');
          await withQueryLogging(
            'clear player history records',
            () => transactionalRepo.clear()
          );
          
          logger.debug('Inserting player history records in batches', {
            totalRecords,
            batchSize,
          });

          // Process in batches within transaction
          for (let i = 0; i < totalRecords; i += batchSize) {
            const batch = recordsToInsert.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(totalRecords / batchSize);

            // Use insert() instead of save() for better bulk insert performance
            await withQueryLogging(
              `insert player history batch ${batchNumber}/${totalBatches}`,
              () => transactionalRepo.insert(batch)
            );

            logger.debug('Inserted batch of player history records', {
              batchNumber,
              totalBatches,
              batchSize: batch.length,
              progress: `${Math.round((i + batch.length) / totalRecords * 100)}%`,
            });
          }
        });
        
        recordsProcessed = totalRecords;
        logger.info('Player history records inserted successfully', {
          totalRecords: recordsProcessed,
        });
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

    return NextResponse.json<ApiResponse<PlayerHistoryResponse>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Player history CSV processing completed',
      data: {
        totalRecords: playerRecords?.length || 0,
        recordsProcessed,
        errors: playerErrors && playerErrors.length > 0 ? playerErrors : null,
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

