import { DataSource } from 'typeorm';
import { ContentPerformance } from './entities/ContentPerformance';
import { PlayerHistory } from './entities/PlayerHistory';
import path from 'node:path';

export const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: path.join(process.cwd(), 'database.sqlite'),
  entities: [ContentPerformance, PlayerHistory],
  synchronize: true, // Set to false in production and use migrations
  logging: false,
});

