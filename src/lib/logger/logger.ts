import { getTraceId, getElapsedTime } from './traceContext';
import { maskSensitiveFields } from './sensitiveFields';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

interface LogEntry {
  timestamp: string;
  level: string;
  traceId?: string;
  message: string;
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  elapsed?: number;
}

class Logger {
  private minLevel: LogLevel;
  private readonly logDir: string;
  private logFile: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private writeQueue: string[] = [];
  private isWriting: boolean = false;

  constructor(minLevel: LogLevel = LogLevel.INFO) {
    this.minLevel = minLevel;
    // Set log directory (in project root/logs)
    this.logDir = join(process.cwd(), 'var/logs');
    // Use daily log files
    const today = new Date().toISOString().split('T')[0];
    this.logFile = join(this.logDir, `app-${today}.log`);
  }

  /**
   * Initialize log directory (lazy initialization)
   */
  private async initializeLogDir(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      // If we can't create the log directory, fall back to console only
      console.error('Failed to create log directory:', error);
      this.initialized = false;
    }
  }

  /**
   * Ensure log directory is initialized before writing
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    
    this.initPromise ??= this.initializeLogDir();
    
    await this.initPromise;
  }

  /**
   * Get current log file path (updates daily)
   */
  private getLogFile(): string {
    const today = new Date().toISOString().split('T')[0];
    return join(this.logDir, `app-${today}.log`);
  }

  /**
   * Write log entry to file (queued to prevent too many open files)
   */
  private writeToFile(logString: string): void {
    // Add to queue (fire and forget to avoid blocking)
    this.writeQueue.push(logString + '\n');
    
    // Start processing queue if not already processing
    if (!this.isWriting) {
      this.isWriting = true;
      this.processWriteQueue().catch((error) => {
        console.error('Error processing log queue:', error);
        this.isWriting = false;
      });
    }
  }

  /**
   * Process the write queue sequentially to avoid too many open files
   */
  private async processWriteQueue(): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.initialized) {
      this.writeQueue = []; // Clear queue if not initialized
      this.isWriting = false;
      return;
    }

    while (this.writeQueue.length > 0) {
      // Batch up to 100 log entries at a time to reduce file operations
      const batch: string[] = [];
      const batchSize = Math.min(100, this.writeQueue.length);
      
      for (let i = 0; i < batchSize; i++) {
        const entry = this.writeQueue.shift();
        if (entry) {
          batch.push(entry);
        }
      }
      
      if (batch.length > 0) {
        try {
          // Update log file path in case date changed
          this.logFile = this.getLogFile();
          
          // Write batch to file (single file operation for multiple entries)
          await fs.appendFile(this.logFile, batch.join(''), 'utf-8');
        } catch (error) {
          // If file write fails, output to console as fallback
          console.error('Failed to write to log file:', error);
          // Clear the queue on persistent errors to prevent memory issues
          if (this.writeQueue.length > 10000) {
            console.error('Log queue too large, clearing to prevent memory issues');
            this.writeQueue = [];
            break;
          }
        }
      }
    }
    
    this.isWriting = false;
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Format and output log entry
   */
  private log(level: LogLevel, levelName: string, message: string, data?: unknown, error?: Error): void {
    if (level < this.minLevel) {
      return;
    }

    const traceId = getTraceId();
    const elapsed = getElapsedTime();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      traceId,
      message,
      elapsed,
    };

    if (data !== undefined) {
      // Mask sensitive fields in data
      entry.data = maskSensitiveFields(
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
          : { value: data }
      );
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    const logString = JSON.stringify(entry, null, 2);
    
    // Write to file (queued, fire and forget)
    this.writeToFile(logString);
    
    // Note: We don't output logger messages to console anymore
    // Only console.log statements in the code will go to console
  }

  trace(message: string, data?: unknown): void {
    this.log(LogLevel.TRACE, 'TRACE', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, 'INFO', message, data);
  }

  warn(message: string, data?: unknown, error?: Error): void {
    this.log(LogLevel.WARN, 'WARN', message, data, error);
  }

  error(message: string, error?: Error, data?: unknown): void {
    this.log(LogLevel.ERROR, 'ERROR', message, data, error);
  }
}

// Export singleton instance
export const logger = new Logger(
  process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG
);

