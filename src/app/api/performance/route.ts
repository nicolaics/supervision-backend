import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
import { PlayerHistory } from '@/src/entities/PlayerHistory';
import {
  calculateContentKPI,
  assignPerformanceGrades,
  ContentPerformanceKPI,
} from '@/src/utils/performanceCalculator';
import { withApiLogging, logger } from '@/src/lib/logger';
import { ApiResponse } from '@/src/lib/common/ApiResponse';

type SortField = 'entrance_rate' | 'attention_rate' | 'total_impressions' | 'content_id' | 'title';
type SortOrder = 'asc' | 'desc';

/**
 * Parse and validate query parameters
 */
function parseQueryParams(request: NextRequest): {
  sortBy?: SortField;
  order?: SortOrder;
  grade?: string;
  limit?: number;
  offset?: number;
} {
  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get('sortBy') as SortField | null;
  const order = (searchParams.get('order') || 'desc') as SortOrder;
  const grade = searchParams.get('grade') || undefined;
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;

  return {
    sortBy: sortBy || undefined,
    order: order === 'asc' ? 'asc' : 'desc',
    grade,
    limit: limit && limit > 0 ? limit : undefined,
    offset: offset && offset >= 0 ? offset : undefined,
  };
}

/**
 * Sort KPIs based on sortBy and order parameters
 */
function sortKPIs(kpis: ContentPerformanceKPI[], sortBy?: SortField, order: SortOrder = 'desc'): ContentPerformanceKPI[] {
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
      case 'content_id':
        aValue = a.content_id;
        bValue = b.content_id;
        break;
      case 'title':
        aValue = a.title;
        bValue = b.title;
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
 * Filter KPIs by grade
 */
function filterByGrade(kpis: ContentPerformanceKPI[], grade?: string): ContentPerformanceKPI[] {
  if (!grade) return kpis;
  return kpis.filter((kpi) => kpi.performance_grade.toUpperCase() === grade.toUpperCase());
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

async function handleGET(request: NextRequest): Promise<NextResponse<ApiResponse<ContentPerformanceKPI[]>>> {
  try {
    await initializeDatabase();

    const queryParams = parseQueryParams(request);
    logger.debug('Performance API query parameters', queryParams);

    // Fetch data from both tables
    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    const playerRepo = AppDataSource.getRepository(PlayerHistory);
    
    const allContentRecords = await contentRepo.find();
    const allPlayerRecords = await playerRepo.find();

    // Count total impressions per content_id from PlayerHistory table
    // According to task_analysis.md: "The number of times a content_id appears in player_history.csv represents the Total Impressions"
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
      return NextResponse.json<ApiResponse<ContentPerformanceKPI[]>>({
        success: true,
        status_code: StatusCodes.OK,
        message: 'No player history data found. Performance KPIs require impressions from player_history table.',
        data: [],
      });
    }

    // Group ContentPerformance records by content_id
    const contentRecordsByContentId = new Map<string, ContentPerformance[]>();
    for (const record of allContentRecords) {
      const contentId = record.content_id;
      if (!contentRecordsByContentId.has(contentId)) {
        contentRecordsByContentId.set(contentId, []);
      }
      contentRecordsByContentId.get(contentId)!.push(record);
    }

    // Get all unique content_ids from PlayerHistory table (impressions are required)
    // Only calculate KPIs for content_ids that have impressions
    const allContentIds = new Set<string>();
    impressionsByContentId.forEach((_, contentId) => allContentIds.add(contentId));

    // Calculate KPIs for each content_id
    // Combine data from both tables as per task_analysis.md requirements
    // Only include content_ids that have impressions (required for KPI calculation)
    const kpis: ContentPerformanceKPI[] = [];
    for (const contentId of allContentIds) {
      const totalImpressions = impressionsByContentId.get(contentId) || 0;
      const contentRecords = contentRecordsByContentId.get(contentId) || [];
      
      // Only include content_ids that have impressions (totalImpressions > 0)
      // Without impressions, rates cannot be calculated meaningfully
      if (totalImpressions > 0) {
        const kpi = calculateContentKPI(contentId, totalImpressions, contentRecords);
      kpis.push(kpi);
      }
    }

    // Assign performance grades based on entrance_rate percentiles
    const gradedKPIs = assignPerformanceGrades(kpis);

    // Apply filters
    let filteredKPIs = filterByGrade(gradedKPIs, queryParams.grade);

    // Apply sorting
    filteredKPIs = sortKPIs(filteredKPIs, queryParams.sortBy, queryParams.order);

    // Apply pagination
    const paginatedKPIs = paginate(filteredKPIs, queryParams.limit, queryParams.offset);

    logger.info('Performance API request completed', {
      totalContentIds: kpis.length,
      filteredCount: filteredKPIs.length,
      returnedCount: paginatedKPIs.length,
    });

    return NextResponse.json<ApiResponse<ContentPerformanceKPI[]>>({
      success: true,
      status_code: StatusCodes.OK,
      message: 'Content performance data retrieved successfully',
      data: paginatedKPIs,
    });
  } catch (error) {
    logger.error('Error retrieving performance data', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json<ApiResponse<ContentPerformanceKPI[]>>(
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

