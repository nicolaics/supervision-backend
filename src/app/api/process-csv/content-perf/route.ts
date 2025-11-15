import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';

// Configure route to accept large request bodies
export const maxDuration = 60; // 60 seconds
export const runtime = 'nodejs';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
import { processContentPerformanceCSV } from '@/src/utils/csvProcessor';
import { withApiLogging, logger, withQueryLogging } from '@/src/lib/logger';
import { ApiResponse } from '@/src/lib/common/ApiResponse';
import { ProcessCsvFileRequest, ContentPerformanceResponse } from '@/src/types/ProcessCsv.types';
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

async function handlePOST(request: NextRequest): Promise<NextResponse<ApiResponse<ContentPerformanceResponse>>> {
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
          return NextResponse.json<ApiResponse<ContentPerformanceResponse>>(
            {
              success: false,
              status_code: StatusCodes.BAD_REQUEST,
              message: 'Missing file in FormData. Expected a file field named "file".',
            },
            { status: StatusCodes.BAD_REQUEST }
          );
        }

        // Read file content as text
        csvContent = await file.text();
        logger.info('Received file via FormData', { fileName: file.name, size: file.size });
      } catch (error) {
        logger.error('Failed to parse FormData', error instanceof Error ? error : new Error(String(error)));
        return NextResponse.json<ApiResponse<ContentPerformanceResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: `Invalid FormData: ${error instanceof Error ? error.message : 'Unknown error'}. Expected a file field named "file".`,
            error_raw: error instanceof Error ? error : new Error(String(error)),
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
        return NextResponse.json<ApiResponse<ContentPerformanceResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: 'Invalid request body. Expected FormData with file field or JSON with fileData field.',
            error_raw: error instanceof Error ? error : new Error(String(error)),
          },
          { status: StatusCodes.BAD_REQUEST }
        );
      }

      if (!body.fileData) {
        return NextResponse.json<ApiResponse<ContentPerformanceResponse>>(
          {
            success: false,
            status_code: StatusCodes.BAD_REQUEST,
            message: 'Missing required field: fileData is required',
          },
          { status: StatusCodes.BAD_REQUEST }
        );
      }

      // Decode CSV content (handles both plain string and base64)
      csvContent = decodeCsvContent(body.fileData);
      logger.info('Received CSV content via JSON', { contentLength: csvContent.length });
    }

    let recordsProcessed = 0;
    let contentRecords: Nullable<ContentPerformance[]> = null;
    let contentErrors: Nullable<string[]> = null;

    // Process content performance CSV
    try {
      logger.info('Processing content performance CSV');
      const processed = await processContentPerformanceCSV(csvContent);
      contentRecords = processed.records;
      contentErrors = processed.errors;

      if (contentRecords && contentRecords.length > 0) {
        // SQLite has a limit on SQL variables (typically 999 or 32766)
        // ContentPerformance has ~9 columns, so batch size should be: limit / columns
        // Using 100 records per batch to be safe (100 * 9 = 900 variables < 999 limit)
        const batchSize = 100; // Safe batch size for SQLite variable limit
        const totalRecords = contentRecords.length;
        const recordsToInsert = contentRecords; // Store reference to avoid null checks
        
        // Use a transaction for better performance and atomicity
        await AppDataSource.transaction(async (transactionalEntityManager) => {
          const transactionalRepo = transactionalEntityManager.getRepository(ContentPerformance);
          
          // Clear existing data before inserting new records (replace mode)
          logger.info('Clearing existing content performance records');
          await withQueryLogging(
            'clear content performance records',
            () => transactionalRepo.clear()
          );
          
          logger.debug('Inserting content performance records in batches', {
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
              `insert content performance batch ${batchNumber}/${totalBatches}`,
              () => transactionalRepo.insert(batch)
            );

            logger.debug('Inserted batch of content performance records', {
              batchNumber,
              totalBatches,
              batchSize: batch.length,
              progress: `${Math.round((i + batch.length) / totalRecords * 100)}%`,
            });
          }
        });
        
        recordsProcessed = totalRecords;
        logger.info('Content performance records inserted successfully', {
          totalRecords: recordsProcessed,
        });
      }

      if (contentErrors && contentErrors.length > 0) {
        logger.warn('Content performance processing errors', {
          errorCount: contentErrors.length,
          errors: contentErrors,
        });
      }

      logger.info('Content performance processing completed', {
        recordsProcessed: contentRecords?.length || 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing content performance CSV', error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }

    console.log('done');

    return NextResponse.json<ApiResponse<ContentPerformanceResponse>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Content performance CSV processing completed',
      data: {
        totalRecords: contentRecords?.length || 0,
        recordsProcessed,
        errors: contentErrors && contentErrors.length > 0 ? contentErrors : null,
      },
    });
  } catch (error) {
    logger.error('Error processing content performance CSV', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json<ApiResponse<ContentPerformanceResponse>>(
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

