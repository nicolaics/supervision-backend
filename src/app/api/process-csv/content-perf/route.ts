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
import { ProcessCsvFileRequest, ContentPerformanceResponse, CsvUploadMode } from '@/src/types/ProcessCsv.types';
import { Nullable } from '@/src/lib/common/Nullable';
import { upsertDatasetStatus } from '@/src/lib/datasetStatus';
import { Repository } from 'typeorm';

function parseUploadMode(value: FormDataEntryValue | string | null | undefined): CsvUploadMode {
  if (typeof value === 'string' && value.toLowerCase() === 'append') {
    return 'append';
  }
  return 'replace';
}

async function persistContentPerformanceRecords(
  repo: Repository<ContentPerformance>,
  uploadMode: CsvUploadMode,
  contentRecords: Nullable<ContentPerformance[]>,
  batchSize: number
): Promise<number> {
  if (uploadMode === 'replace') {
    logger.info('Clearing existing content performance records (replace mode)');
    await withQueryLogging('clear content performance records', () => repo.clear());
  } else {
    logger.info('Append mode: keeping existing content performance records');
  }

  if (contentRecords && contentRecords.length > 0) {
    const totalRecords = contentRecords.length;
    const recordsToInsert = contentRecords;

    logger.debug('Inserting content performance records in batches', {
      totalRecords,
      batchSize,
    });

    for (let i = 0; i < totalRecords; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      await withQueryLogging(
        `insert content performance batch ${batchNumber}/${totalBatches}`,
        () => repo.insert(batch)
      );

      logger.debug('Inserted batch of content performance records', {
        batchNumber,
        totalBatches,
        batchSize: batch.length,
        progress: `${Math.round(((i + batch.length) / totalRecords) * 100)}%`,
      });
    }

    logger.info('Content performance records inserted successfully', {
      totalRecords,
    });

    return totalRecords;
  }

  if (uploadMode === 'replace') {
    logger.info('No valid records to insert, database cleared (replace mode)');
  } else {
    logger.info('No valid records to insert, existing data unchanged (append mode)');
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

async function handlePOST(request: NextRequest): Promise<NextResponse<ApiResponse<ContentPerformanceResponse>>> {
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
      uploadMode = parseUploadMode(body.mode);
      logger.info('Received CSV content via JSON', { contentLength: csvContent.length });
    }

    let recordsProcessed = 0;
    let contentRecords: Nullable<ContentPerformance[]> = null;
    let contentErrors: Nullable<string[]> = null;

    // Process content performance CSV
    try {
      logger.info('Processing content performance CSV', { mode: uploadMode });
      
      const processed = await processContentPerformanceCSV(csvContent);
      contentRecords = processed.records;
      contentErrors = processed.errors;

      const batchSize = 100; // Safe batch size for SQLite variable limit

      const processWithinRepo = async (repo: Repository<ContentPerformance>) => {
        return persistContentPerformanceRecords(repo, uploadMode, contentRecords, batchSize);
      };

      try {
        recordsProcessed = await AppDataSource.transaction(async (transactionalEntityManager) => {
          const transactionalRepo = transactionalEntityManager.getRepository(ContentPerformance);
          return processWithinRepo(transactionalRepo);
        });
      } catch (error) {
        if (error instanceof Error && /no transaction is active/i.test(error.message)) {
          logger.warn(
            'SQLite transaction commit failed, retrying without transaction',
            { mode: uploadMode, error: error.message }
          );
          const repo = AppDataSource.getRepository(ContentPerformance);
          recordsProcessed = await processWithinRepo(repo);
        } else {
          throw error;
        }
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

    console.log('contentErrors', contentErrors);

    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    const databaseRecords = await contentRepo.count();
    const datasetStatus = await upsertDatasetStatus('content-performance', databaseRecords);

    return NextResponse.json<ApiResponse<ContentPerformanceResponse>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Content performance CSV processing completed',
      data: {
        totalRecords: contentRecords?.length || 0,
        recordsProcessed,
        errors: contentErrors && contentErrors.length > 0 ? contentErrors : null,
        databaseRecords,
        lastUpdatedAt: datasetStatus.last_updated_at ? datasetStatus.last_updated_at.toISOString() : null,
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

