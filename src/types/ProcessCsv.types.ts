import { Nullable } from '../lib/common/Nullable';

export interface ProcessCsvFileRequest {
  fileData: string; // CSV content as string or base64 encoded bytes
}

export interface ContentPerformanceResponse {
  totalRecords: number;
  recordsProcessed: number;
  errors: Nullable<string[]>;
}

export interface PlayerHistoryResponse {
  totalRecords: number;
  recordsProcessed: number;
  errors: Nullable<string[]>;
}

export interface ProcessCsvResponse {
  contentPerformance: ContentPerformanceResponse;
  playerHistory: PlayerHistoryResponse;
}
