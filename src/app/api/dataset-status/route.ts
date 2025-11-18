import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { initializeDatabase } from '@/src/lib/db/database';
import { withApiLogging, logger } from '@/src/lib/logger';
import { ApiResponse } from '@/src/lib/common/ApiResponse';
import { DatasetStatusInfo, DatasetName, getDatasetStatus } from '@/src/lib/datasetStatus';

function isValidDatasetName(value: string | null): value is DatasetName {
  return value === 'content-performance' || value === 'player-history';
}

async function handleGET(request: NextRequest): Promise<NextResponse<ApiResponse<DatasetStatusInfo>>> {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(request.url);
    const dataset = searchParams.get('dataset');

    if (!isValidDatasetName(dataset)) {
      return NextResponse.json<ApiResponse<DatasetStatusInfo>>(
        {
          success: false,
          status_code: StatusCodes.BAD_REQUEST,
          message: 'Invalid dataset parameter. Expected "content-performance" or "player-history".',
          data: null,
        },
        { status: StatusCodes.BAD_REQUEST }
      );
    }

    const status = await getDatasetStatus(dataset);

    return NextResponse.json<ApiResponse<DatasetStatusInfo>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Dataset status retrieved successfully',
      data: status ?? {
        dataset_name: dataset,
        records_count: 0,
        last_updated_at: null,
      },
    });
  } catch (error) {
    logger.error('Error retrieving dataset status', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json<ApiResponse<DatasetStatusInfo>>(
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

export const GET = withApiLogging(handleGET);


