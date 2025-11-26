import winston from 'winston';
import DailyRotateFile from "winston-daily-rotate-file";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve logs directory relative to project root
const projectRoot = path.resolve(__dirname, '../..');
const logsDir = path.join(projectRoot, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (error) {
        // If we can't create the logs directory, we'll fall back to console only
        console.error('Warning: Could not create logs directory:', error);
    }
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'mcp-sap-commerce' },
    transports: [
        // Rotate error logs daily
        new DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '30d',
            maxSize: '10m'
        }),
        // Rotate combined logs daily
        new DailyRotateFile({
            filename: path.join(logsDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '30d',
            maxSize: '10m'
        }),
        // Track health metrics separately
        new DailyRotateFile({
            filename: path.join(logsDir, 'health-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '30d',
            maxSize: '10m',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        })
    ]
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

export { logger };

// Helper functions for health metrics
export const logHealthMetric = (metric: {
    type: 'apiLatency' | 'errorRate' | 'cacheHitRate' | 'memory';
    value: number;
    context?: Record<string, any>;
}) => {
    logger.info('health_metric', {
        ...metric,
        timestamp: new Date().toISOString()
    });
};

export const logAPIMetric = (endpoint: string, latency: number, success: boolean) => {
    logger.info('api_metric', {
        endpoint,
        latency,
        success,
        timestamp: new Date().toISOString()
    });
};

export const logCacheMetric = (operation: 'hit' | 'miss' | 'eviction', context: Record<string, any>) => {
    logger.info('cache_metric', {
        operation,
        ...context,
        timestamp: new Date().toISOString()
    });
};