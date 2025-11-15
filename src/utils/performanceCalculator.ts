import { ContentPerformance } from '../entities/ContentPerformance';

export interface ContentPerformanceKPI {
  content_id: string;
  title: string;
  content_group: string;
  total_impressions: number;
  attention_rate: number;
  entrance_rate: number;
  performance_grade: string;
}

export interface GroupPerformanceKPI {
  content_group: string;
  total_impressions: number;
  attention_rate: number;
  entrance_rate: number;
  content_count: number;
}

/**
 * Calculate KPIs for a single content_id from its records
 */
export function calculateContentKPI(
  contentId: string,
  records: ContentPerformance[]
): ContentPerformanceKPI {
  const totalImpressions = records.length;
  const attentionCount = records.filter((r) => r.is_attention === true).length;
  const entranceCount = records.filter((r) => r.is_entrance === true).length;

  const attentionRate = totalImpressions > 0 ? attentionCount / totalImpressions : 0;
  const entranceRate = totalImpressions > 0 ? entranceCount / totalImpressions : 0;

  // Get title and content_group from first record (assuming they're consistent)
  const firstRecord = records[0];
  const title = firstRecord?.title || '';
  const contentGroup = firstRecord?.content_group || '';

  return {
    content_id: contentId,
    title,
    content_group: contentGroup,
    total_impressions: totalImpressions,
    attention_rate: attentionRate,
    entrance_rate: entranceRate,
    performance_grade: '', // Will be assigned later based on percentiles
  };
}

/**
 * Calculate performance grade based on percentile rank
 * S: >=95th percentile (top 5%)
 * A: >=75th percentile but <95th percentile (next 20%)
 * B: >=50th percentile but <75th percentile (next 25%)
 * C: >=25th percentile but <50th percentile (next 25%)
 * D: <25th percentile (bottom 25%)
 */
export function assignPerformanceGrades(kpis: ContentPerformanceKPI[]): ContentPerformanceKPI[] {
  if (kpis.length === 0) return kpis;

  // Sort by entrance_rate descending
  const sortedByEntranceRate = [...kpis].sort((a, b) => b.entrance_rate - a.entrance_rate);

  // Calculate percentile thresholds (using floor to ensure proper distribution)
  const total = sortedByEntranceRate.length;
  const sThreshold = Math.floor(total * 0.05); // Top 5% (>=95th percentile)
  const aThreshold = Math.floor(total * 0.25); // Top 25% (>=75th percentile)
  const bThreshold = Math.floor(total * 0.5); // Top 50% (>=50th percentile)
  const cThreshold = Math.floor(total * 0.75); // Top 75% (>=25th percentile)

  // Assign grades
  sortedByEntranceRate.forEach((kpi, index) => {
    if (index < sThreshold) {
      kpi.performance_grade = 'S';
    } else if (index < aThreshold) {
      kpi.performance_grade = 'A';
    } else if (index < bThreshold) {
      kpi.performance_grade = 'B';
    } else if (index < cThreshold) {
      kpi.performance_grade = 'C';
    } else {
      kpi.performance_grade = 'D';
    }
  });

  return sortedByEntranceRate;
}

/**
 * Calculate aggregated KPIs for a content group
 */
export function calculateGroupKPI(
  groupName: string,
  records: ContentPerformance[]
): GroupPerformanceKPI {
  const totalImpressions = records.length;
  const attentionCount = records.filter((r) => r.is_attention === true).length;
  const entranceCount = records.filter((r) => r.is_entrance === true).length;
  const uniqueContentIds = new Set(records.map((r) => r.content_id));

  const attentionRate = totalImpressions > 0 ? attentionCount / totalImpressions : 0;
  const entranceRate = totalImpressions > 0 ? entranceCount / totalImpressions : 0;

  return {
    content_group: groupName,
    total_impressions: totalImpressions,
    attention_rate: attentionRate,
    entrance_rate: entranceRate,
    content_count: uniqueContentIds.size,
  };
}

