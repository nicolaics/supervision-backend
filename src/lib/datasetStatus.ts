import { AppDataSource } from '@/src/data-source';
import { DatasetStatus } from '@/src/entities/DatasetStatus';

export type DatasetName = 'content-performance' | 'player-history';

export interface DatasetStatusInfo {
  dataset_name: DatasetName;
  records_count: number;
  last_updated_at: Date | null;
}

function getRepository() {
  return AppDataSource.getRepository(DatasetStatus);
}

export async function getDatasetStatus(datasetName: DatasetName): Promise<DatasetStatusInfo | null> {
  const repo = getRepository();
  const status = await repo.findOne({ where: { dataset_name: datasetName } });
  if (!status) {
    return null;
  }
  return {
    dataset_name: status.dataset_name as DatasetName,
    records_count: status.records_count,
    last_updated_at: status.last_updated_at,
  };
}

export async function upsertDatasetStatus(
  datasetName: DatasetName,
  recordsCount: number,
  lastUpdatedAt: Date = new Date()
): Promise<DatasetStatusInfo> {
  const repo = getRepository();
  let status = await repo.findOne({ where: { dataset_name: datasetName } });
  if (!status) {
    status = repo.create({
      dataset_name: datasetName,
      records_count: recordsCount,
      last_updated_at: lastUpdatedAt,
    });
  } else {
    status.records_count = recordsCount;
    status.last_updated_at = lastUpdatedAt;
  }
  const saved = await repo.save(status);
  return {
    dataset_name: saved.dataset_name as DatasetName,
    records_count: saved.records_count,
    last_updated_at: saved.last_updated_at,
  };
}


