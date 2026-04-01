/**
 * Prometheus Metrics Module
 * Collects application metrics for monitoring
 */

interface RequestMetrics {
	method: string;
	path: string;
	status: number;
	duration: number;
	timestamp: number;
}

class MetricsCollector {
	private metrics = {
		totalRequests: 0,
		requestsByStatus: new Map<number, number>(),
		requestsByPath: new Map<string, number>(),
		requestDurations: [] as number[],
		errors: 0,
		rateLimitedRequests: 0,
		websocketConnections: 0,
		websocketErrors: 0,
	};

	recordRequest(data: RequestMetrics): void {
		this.metrics.totalRequests++;
		this.metrics.requestsByStatus.set(
			data.status,
			(this.metrics.requestsByStatus.get(data.status) || 0) + 1
		);
		this.metrics.requestsByPath.set(
			data.path,
			(this.metrics.requestsByPath.get(data.path) || 0) + 1
		);
		this.metrics.requestDurations.push(data.duration);

		if (data.status >= 500) {
			this.metrics.errors++;
		}

		if (data.status === 429) {
			this.metrics.rateLimitedRequests++;
		}

		if (this.metrics.requestDurations.length > 1000) {
			this.metrics.requestDurations.shift();
		}
	}

	recordWebSocketConnection(): void {
		this.metrics.websocketConnections++;
	}

	recordWebSocketError(): void {
		this.metrics.websocketErrors++;
	}

	getMetrics() {
		const durations = this.metrics.requestDurations;
		const avgDuration = durations.length > 0
			? durations.reduce((a, b) => a + b, 0) / durations.length
			: 0;

		const sorted = [...durations].sort((a, b) => a - b);
		const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
		const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

		return {
			totalRequests: this.metrics.totalRequests,
			statusDistribution: Object.fromEntries(this.metrics.requestsByStatus),
			pathDistribution: Object.fromEntries(this.metrics.requestsByPath),
			averageResponseTime: avgDuration,
			p95ResponseTime: p95,
			p99ResponseTime: p99,
			errorRate: this.metrics.totalRequests > 0
				? (this.metrics.errors / this.metrics.totalRequests) * 100
				: 0,
			rateLimitedRequests: this.metrics.rateLimitedRequests,
			websocketConnections: this.metrics.websocketConnections,
			websocketErrors: this.metrics.websocketErrors,
			uptime: process.uptime(),
			memory: process.memoryUsage(),
		};
	}

	reset(): void {
		this.metrics = {
			totalRequests: 0,
			requestsByStatus: new Map(),
			requestsByPath: new Map(),
			requestDurations: [],
			errors: 0,
			rateLimitedRequests: 0,
			websocketConnections: 0,
			websocketErrors: 0,
		};
	}
}

export const metricsCollector = new MetricsCollector();
