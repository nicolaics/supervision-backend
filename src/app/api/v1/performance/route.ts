import 'reflect-metadata';
import { NextResponse, NextRequest } from 'next/server';
import { StatusCodes } from 'http-status-codes';
import { initializeDatabase } from '@/src/lib/db/database';
import { AppDataSource } from '@/src/data-source';
import { ContentPerformance } from '@/src/entities/ContentPerformance';
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

    // Fetch all content performance records
    const contentRepo = AppDataSource.getRepository(ContentPerformance);
    const allRecords = await contentRepo.find();

    if (allRecords.length === 0) {
      return NextResponse.json<ApiResponse<ContentPerformanceKPI[]>>({
        success: true,
        status_code: StatusCodes.OK,
        message: 'No content performance data found',
        data: [],
      });
    }

    // Group records by content_id
    const recordsByContentId = new Map<string, ContentPerformance[]>();
    for (const record of allRecords) {
      const contentId = record.content_id;
      if (!recordsByContentId.has(contentId)) {
        recordsByContentId.set(contentId, []);
      }
      recordsByContentId.get(contentId)!.push(record);
    }

    // Calculate KPIs for each content_id
    const kpis: ContentPerformanceKPI[] = [];
    for (const [contentId, records] of recordsByContentId.entries()) {
      const kpi = calculateContentKPI(contentId, records);
      kpis.push(kpi);
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

