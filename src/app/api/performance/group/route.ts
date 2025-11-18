import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
import { PlayerHistory } from '@/src/entities/PlayerHistory';
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

    // Fetch data from both tables
    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    const playerRepo = AppDataSource.getRepository(PlayerHistory);
    
    const allContentRecords = await contentRepo.find();
    const allPlayerRecords = await playerRepo.find();

    // Count total impressions per content_id from PlayerHistory table
    const impressionsByContentId = new Map<string, number>();
    for (const record of allPlayerRecords) {
      if (record.content_id) {
        const currentCount = impressionsByContentId.get(record.content_id) || 0;
        impressionsByContentId.set(record.content_id, currentCount + 1);
      }
    }

    // If no player history data (impressions), return empty
    // Performance KPIs require impressions as the denominator for calculating rates
    if (impressionsByContentId.size === 0) {
      return NextResponse.json<ApiResponse<GroupPerformanceKPI[]>>({
        success: true,
        status_code: StatusCodes.OK,
        message: 'No player history data found. Performance KPIs require impressions from player_history table.',
        data: [],
      });
    }

    // Group ContentPerformance records by content_group
    const recordsByGroup = new Map<string, ContentPerformance[]>();
    for (const record of allContentRecords) {
      const groupName = record.content_group || 'Unknown';
      if (!recordsByGroup.has(groupName)) {
        recordsByGroup.set(groupName, []);
      }
      recordsByGroup.get(groupName)!.push(record);
    }

    // Calculate aggregated KPIs for each content_group
    // Combine data from both tables as per task_analysis.md requirements
    // Only include groups that have impressions (required for KPI calculation)
    const groupKPIs: GroupPerformanceKPI[] = [];
    for (const [groupName, records] of recordsByGroup.entries()) {
      // Sum up impressions for all content_ids in this group from PlayerHistory
      const groupContentIds = new Set(records.map((r) => r.content_id));
      let totalImpressionsForGroup = 0;
      for (const contentId of groupContentIds) {
        totalImpressionsForGroup += impressionsByContentId.get(contentId) || 0;
      }
      
      // Only include groups that have impressions (totalImpressionsForGroup > 0)
      // Without impressions, rates cannot be calculated meaningfully
      if (totalImpressionsForGroup > 0) {
        const groupKPI = calculateGroupKPI(groupName, totalImpressionsForGroup, records);
        groupKPIs.push(groupKPI);
      }
    }

    // Apply sorting
    const sortedKPIs = sortGroupKPIs(groupKPIs, queryParams.sortBy, queryParams.order);

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

