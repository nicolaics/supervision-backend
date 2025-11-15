import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
import { calculateGroupKPI, GroupPerformanceKPI } from '@/src/utils/performanceCalculator';
import { withApiLogging, logger } from '@/src/lib/logger';
import { ApiResponse } from '@/src/lib/common/ApiResponse';

type SortField = 'entrance_rate' | 'attention_rate' | 'total_impressions' | 'content_group' | 'content_count';
type SortOrder = 'asc' | 'desc';

/**
 * Parse and validate query parameters
 */
function parseQueryParams(request: NextRequest): {
  sortBy?: SortField;
  order?: SortOrder;
  limit?: number;
  offset?: number;
} {
  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get('sortBy') as SortField | null;
  const order = (searchParams.get('order') || 'desc') as SortOrder;
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;

  return {
    sortBy: sortBy || undefined,
    order: order === 'asc' ? 'asc' : 'desc',
    limit: limit && limit > 0 ? limit : undefined,
    offset: offset && offset >= 0 ? offset : undefined,
  };
}

/**
 * Sort group KPIs based on sortBy and order parameters
 */
function sortGroupKPIs(
  kpis: GroupPerformanceKPI[],
  sortBy?: SortField,
  order: SortOrder = 'desc'
): GroupPerformanceKPI[] {
  if (!sortBy) {
    // Default sort by entrance_rate descending
    return [...kpis].sort((a, b) => b.entrance_rate - a.entrance_rate);
  }

  const sorted = [...kpis].sort((a, b) => {
    let aValue: string | number;
    let bValue: string | number;

    switch (sortBy) {
      case 'entrance_rate':
        aValue = a.entrance_rate;
        bValue = b.entrance_rate;
        break;
      case 'attention_rate':
        aValue = a.attention_rate;
        bValue = b.attention_rate;
        break;
      case 'total_impressions':
        aValue = a.total_impressions;
        bValue = b.total_impressions;
        break;
      case 'content_group':
        aValue = a.content_group || '';
        bValue = b.content_group || '';
        break;
      case 'content_count':
        aValue = a.content_count;
        bValue = b.content_count;
        break;
      default:
        return 0;
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return order === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }

    return order === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
  });

  return sorted;
}

/**
 * Apply pagination
 */
function paginate<T>(items: T[], limit?: number, offset?: number): T[] {
  if (offset !== undefined && offset > 0) {
    items = items.slice(offset);
  }
  if (limit !== undefined && limit > 0) {
    items = items.slice(0, limit);
  }
  return items;
}

async function handleGET(request: NextRequest): Promise<NextResponse<ApiResponse<GroupPerformanceKPI[]>>> {
  try {
    await initializeDatabase();

    const queryParams = parseQueryParams(request);
    logger.debug('Performance group API query parameters', queryParams);

    // Fetch all content performance records
    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    const allRecords = await contentRepo.find();

    if (allRecords.length === 0) {
      return NextResponse.json<ApiResponse<GroupPerformanceKPI[]>>({
        success: true,
        status_code: StatusCodes.OK,
        message: 'No content performance data found',
        data: [],
      });
    }

    // Group records by content_group
    const recordsByGroup = new Map<string, ContentPerformance[]>();
    for (const record of allRecords) {
      const groupName = record.content_group || 'Unknown';
      if (!recordsByGroup.has(groupName)) {
        recordsByGroup.set(groupName, []);
      }
      recordsByGroup.get(groupName)!.push(record);
    }

    // Calculate aggregated KPIs for each content_group
    const groupKPIs: GroupPerformanceKPI[] = [];
    for (const [groupName, records] of recordsByGroup.entries()) {
      const groupKPI = calculateGroupKPI(groupName, records);
      groupKPIs.push(groupKPI);
    }

    // Apply sorting
    let sortedKPIs = sortGroupKPIs(groupKPIs, queryParams.sortBy, queryParams.order);

    // Apply pagination
    const paginatedKPIs = paginate(sortedKPIs, queryParams.limit, queryParams.offset);

    logger.info('Performance group API request completed', {
      totalGroups: groupKPIs.length,
      returnedCount: paginatedKPIs.length,
    });

    return NextResponse.json<ApiResponse<GroupPerformanceKPI[]>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Content group performance data retrieved successfully',
      data: paginatedKPIs,
    });
  } catch (error) {
    logger.error('Error retrieving group performance data', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json<ApiResponse<GroupPerformanceKPI[]>>(
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

// Wrap GET handler with API logging
export const GET = withApiLogging(handleGET);

