import { Nullable } from '../lib/common/Nullable';

export type CsvUploadMode = 'replace' | 'append';

export interface ProcessCsvFileRequest {
  fileData: string; // CSV content as string or base64 encoded bytes
  mode?: CsvUploadMode;
}

export interface ContentPerformanceResponse {
  totalRecords: number;
  recordsProcessed: number;
  errors: Nullable<string[]>;
  databaseRecords: number;
  lastUpdatedAt: string | null;
}

export interface PlayerHistoryResponse {
  totalRecords: number;
  recordsProcessed: number;
  errors: Nullable<string[]>;
  databaseRecords: number;
  lastUpdatedAt: string | null;
}

export interface ProcessCsvResponse {
  contentPerformance: ContentPerformanceResponse;
  playerHistory: PlayerHistoryResponse;
}
