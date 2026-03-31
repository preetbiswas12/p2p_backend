/**
 * Logger utility
 * Respects LOG_LEVEL environment variable
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};

const currentLogLevel = LOG_LEVELS[
	(process.env.LOG_LEVEL || 'info') as LogLevel
];

class Logger {
	private prefix: string;

	constructor(prefix: string) {
		this.prefix = prefix;
	}

	debug(message: string, data?: any): void {
		if (LOG_LEVELS.debug <= currentLogLevel) {
			console.log(`[${this.prefix}] ${message}`, data || '');
		}
	}

	info(message: string, data?: any): void {
		if (LOG_LEVELS.info <= currentLogLevel) {
			console.log(`[${this.prefix}] ${message}`, data || '');
		}
	}

	warn(message: string, data?: any): void {
		if (LOG_LEVELS.warn <= currentLogLevel) {
			console.warn(`[${this.prefix}] ${message}`, data || '');
		}
	}

	error(message: string, error?: Error | any): void {
		if (LOG_LEVELS.error <= currentLogLevel) {
			console.error(`[${this.prefix}] ${message}`, error || '');
		}
	}
}

export function getLogger(prefix: string): Logger {
	return new Logger(prefix);
}

export default Logger;
