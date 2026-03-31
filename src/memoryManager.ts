/**
 * Memory Manager
 * Monitors heap usage and triggers cleanup when thresholds are exceeded
 */

import { roomManager } from './roomManager.js';

class MemoryManager {
	private monitorInterval: NodeJS.Timeout | null = null;
	private lastWarningTime = 0;
	private readonly MONITOR_INTERVAL = 30 * 1000; // 30 seconds
	private readonly WARNING_THRESHOLD = parseInt(process.env.MEMORY_WARNING_THRESHOLD || '200', 10); // MB
	private readonly CRITICAL_THRESHOLD = parseInt(process.env.MEMORY_CRITICAL_THRESHOLD || '250', 10); // MB
	private readonly WARNING_COOLDOWN = 60 * 1000; // 60 seconds

	public start(): void {
		console.log('[MemoryManager] Started (every 30000ms)');

		this.monitorInterval = setInterval(() => {
			this.monitor();
		}, this.MONITOR_INTERVAL);
	}

	public stop(): void {
		if (this.monitorInterval) {
			clearInterval(this.monitorInterval);
			this.monitorInterval = null;
			console.log('[MemoryManager] Stopped');
		}
	}

	private monitor(): void {
		const stats = this.getMemoryStats();
		const heapUsedMB = stats.heapUsed;

		if (heapUsedMB > this.CRITICAL_THRESHOLD) {
			console.warn(
				`[MemoryManager] CRITICAL: Heap ${heapUsedMB}MB > ${this.CRITICAL_THRESHOLD}MB`
			);
			this.aggressiveCleanup();
		} else if (
			heapUsedMB > this.WARNING_THRESHOLD &&
			Date.now() - this.lastWarningTime > this.WARNING_COOLDOWN
		) {
			console.warn(
				`[MemoryManager] WARNING: Heap ${heapUsedMB}MB > ${this.WARNING_THRESHOLD}MB`
			);
			this.cleanup();
			this.lastWarningTime = Date.now();
		}
	}

	private cleanup(): void {
		roomManager.cleanup();
	}

	private aggressiveCleanup(): void {
		// First, normal cleanup
		this.cleanup();

		// Force garbage collection if available
		if (global.gc) {
			console.log('[MemoryManager] Running forced garbage collection...');
			global.gc();
		}

		// Close all idle rooms
		const rooms = roomManager.getAllRooms();
		for (const [roomId, room] of rooms) {
			if (room.peerCount === 0) {
				console.log(`[MemoryManager] Force-closing idle room: ${roomId}`);
				roomManager.leaveRoom(roomId, room.hostId);
			}
		}
	}

	public getMemoryStats(): {
		heapUsed: number;
		heapTotal: number;
		heapPercent: number;
		external: number;
	} {
		const mem = process.memoryUsage();
		return {
			heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
			heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
			heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
			external: Math.round(mem.external / 1024 / 1024),
		};
	}

	public getThresholds(): {
		warning: number;
		critical: number;
		cooldown: number;
	} {
		return {
			warning: this.WARNING_THRESHOLD,
			critical: this.CRITICAL_THRESHOLD,
			cooldown: this.WARNING_COOLDOWN,
		};
	}
}

export const memoryManager = new MemoryManager();
