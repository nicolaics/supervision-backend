import { DataSource } from 'typeorm';
import { ContentPerformance } from './entities/ContentPerformance';
import { PlayerHistory } from './entities/PlayerHistory';
import path from 'node:path';
import { CustomTypeORMLogger } from './lib/logger/typeormLogger';

export const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: path.join(process.cwd(), 'space-vision.sqlite'),
  entities: [ContentPerformance, PlayerHistory],
  synchronize: true, // Set to false in production and use migrations
  logger: new CustomTypeORMLogger({
    logQueries: true,
    logResults: true,
    logErrors: true,
  }),
  logging: ['error', 'warn', 'info', 'log', 'schema'],
});

