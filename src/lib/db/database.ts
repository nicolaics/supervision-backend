import 'reflect-metadata';
import { AppDataSource } from '../../data-source';
import { logger } from '../logger';

let isInitialized = false;

export async function initializeDatabase(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    isInitialized = true;
    logger.info('Database initialized successfully', {
      database: AppDataSource.options.database,
      type: AppDataSource.options.type,
    });
  }
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    isInitialized = false;
    logger.info('Database connection closed');
  }
}

