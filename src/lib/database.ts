import 'reflect-metadata';
import { AppDataSource } from '../data-source';

let isInitialized = false;

export async function initializeDatabase(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    isInitialized = true;
    console.log('Database initialized successfully');
  }
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    isInitialized = false;
    console.log('Database connection closed');
  }
}

