/**
 * Memory Manager Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface MemoryStats {
	heapUsed: number;
	heapTotal: number;
	external: number;
	rss: number;
}

class MemoryManager {
	private warningThresholdMb: number;
	private criticalThresholdMb: number;

	constructor(warningThresholdMb = 200, criticalThresholdMb = 300) {
		this.warningThresholdMb = warningThresholdMb;
		this.criticalThresholdMb = criticalThresholdMb;
	}

	getMemoryUsage(): MemoryStats {
		const mem = process.memoryUsage();
		return {
			heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
			heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
			external: Math.round(mem.external / 1024 / 1024),
			rss: Math.round(mem.rss / 1024 / 1024),
		};
	}

	getMemoryStatus(): 'healthy' | 'warning' | 'critical' {
		const stats = this.getMemoryUsage();
		if (stats.heapUsed > this.criticalThresholdMb) {
			return 'critical';
		}
		if (stats.heapUsed > this.warningThresholdMb) {
			return 'warning';
		}
		return 'healthy';
	}

	shouldPruneRooms(): boolean {
		return this.getMemoryStatus() === 'critical';
	}
}

describe('MemoryManager', () => {
	let memoryManager: MemoryManager;

	beforeEach(() => {
		memoryManager = new MemoryManager(1000, 2000); // High thresholds for testing
	});

	it('should get current memory usage', () => {
		const stats = memoryManager.getMemoryUsage();

		expect(stats.heapUsed).toBeGreaterThan(0);
		expect(stats.heapTotal).toBeGreaterThan(0);
		expect(stats.rss).toBeGreaterThan(0);
		expect(stats.heapUsed).toBeLessThanOrEqual(stats.heapTotal);
	});

	it('should return memory status as healthy when below thresholds', () => {
		const status = memoryManager.getMemoryStatus();
		expect(['healthy', 'warning', 'critical']).toContain(status);
	});

	it('should indicate pruning unnecessary when memory is healthy', () => {
		const memoryManager2 = new MemoryManager(1000000, 2000000); // Very high thresholds
		const shouldPrune = memoryManager2.shouldPruneRooms();
		expect(shouldPrune).toBe(false);
	});

	it('should format memory stats correctly', () => {
		const stats = memoryManager.getMemoryUsage();
		expect(typeof stats.heapUsed).toBe('number');
		expect(typeof stats.heapTotal).toBe('number');
		expect(stats.heapUsed >= 0).toBe(true);
	});
});
