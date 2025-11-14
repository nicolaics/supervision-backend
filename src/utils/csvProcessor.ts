import { parse } from 'csv-parse/sync';
import fs from 'node:fs';
import { ContentPerformance } from '../entities/ContentPerformance';
import { PlayerHistory } from '../entities/PlayerHistory';

export interface CSVProcessingResult {
  success: boolean;
  recordsProcessed: number;
  errors?: string[];
}

/**
 * Parse a date string to Date object
 */
function parseDate(dateString: string | undefined | null): Date | null {
  if (!dateString || dateString.trim() === '') return null;
  try {
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Parse a boolean string to boolean
 */
function parseBoolean(value: string | undefined | null): boolean | null {
  if (!value || value.trim() === '') return null;
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return null;
}

/**
 * Parse a number string to number
 */
function parseNumber(value: string | undefined | null): number | null {
  if (!value || value.trim() === '') return null;
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

/**
 * Process content_performance.csv file
 */
export async function processContentPerformanceCSV(
  filePath: string
): Promise<{ records: ContentPerformance[]; errors: string[] }> {
  const errors: string[] = [];
  const records: ContentPerformance[] = [];

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      skip_records_with_error: true,
    });

    for (let i = 0; i < parsed.length; i++) {
      try {
        const row = parsed[i] as Record<string, string>;
        const record = new ContentPerformance();
        
        record.content_id = row.content_id || '';
        record.title = row.title || null;
        record.audience_id = row.audience_id || null;
        record.age = row.age || null;
        record.gender = row.gender || null;
        record.play_at = parseDate(row.play_at);
        record.attention_sec = parseNumber(row.attention_sec);
        record.is_attention = parseBoolean(row.is_attention);
        record.is_entrance = parseBoolean(row.is_entrance);
        record.content_group = row.content_group || null;

        records.push(record);
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { records, errors };
}

/**
 * Process player_history.csv file
 */
export async function processPlayerHistoryCSV(
  filePath: string
): Promise<{ records: PlayerHistory[]; errors: string[] }> {
  const errors: string[] = [];
  const records: PlayerHistory[] = [];

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      skip_records_with_error: true,
    });

    for (let i = 0; i < parsed.length; i++) {
      try {
        const row = parsed[i] as Record<string, string>;
        const record = new PlayerHistory();
        
        record.campaign_id = row.campaign_id || null;
        record.date = parseDate(row.date);
        record.action = row.action || null;
        record.campaign_session_id = row.campaign_session_id || null;
        record.content_id = row.content_id || null;
        record.content_session_id = row.content_session_id || null;
        record.content_title = row.content_title || null;
        record.device_id = row.device_id || null;
        record.duration_second = parseNumber(row.duration_second);
        record.inventory_id = row.inventory_id || null;
        record.iso_local_time = row.iso_local_time || null;
        record.iso_time = row.iso_time || null;
        record.player_version = row.player_version || null;
        record.pricing_rule = row.pricing_rule || null;
        record.content_duration = parseNumber(row.content_duration);
        record.content_selection = row.content_selection || null;
        record.content_version = row.content_version ? Number.parseInt(row.content_version, 10) : null;
        record.elapsed_second = parseNumber(row.elapsed_second);
        record.playlist_created_time = parseDate(row.playlist_created_time);
        record.sequence_id = row.sequence_id || null;
        record.advertiser_id = row.advertiser_id || null;
        record.iso_time_date = parseDate(row.iso_time_date);
        record.part_date = parseDate(row.part_date);

        records.push(record);
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { records, errors };
}

