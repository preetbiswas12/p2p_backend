/**
 * Operation History Manager
 * Tracks all operations across rooms and peers for audit, undo/redo, and recovery
 */

import { supabaseDB } from './supabaseDB.js';

/**
 * Tracks a single operation in the history
 */
export interface StoredOperation {
	id: string;                          // Unique operation ID
	roomId: string;                      // Which room this operation happened in
	peerId: string;                      // Which peer performed it
	peerName?: string;                   // Optional peer display name
	operationType: 'insert' | 'delete' | 'replace'; // Type of operation
	position: number;                    // Position in document
	content?: string;                    // Content inserted/replaced
	deletedContent?: string;             // What was deleted
	length?: number;                     // Length deleted
	timestamp: number;                   // When it happened (ms since epoch)
	documentVersion: number;             // Document version after operation
	craVersion?: string;                 // CRDT version reference
	otVersion?: number;                  // OT version reference
	parentOperationId?: string;          // ID of operation this builds on
	metadata?: Record<string, unknown>;  // Additional metadata
	isReverted?: boolean;               // Whether this operation was reverted
	revertedBy?: string;                // Operation ID that reverted this
}

/**
 * Summary of operations in a time range
 */
export interface OperationSummary {
	totalOperations: number;
	timeRange: {
		start: number;
		end: number;
	};
	operationsByType: {
		insert: number;
		delete: number;
		replace: number;
	};
	operationsByPeer: Record<string, number>;
	charactersAdded: number;
	charactersDeleted: number;
	averageTimeBetweenOps: number;
}

/**
 * Undo/Redo checkpoint for session recovery
 */
export interface SessionCheckpoint {
	operationId: string;
	timestamp: number;
	documentContent: string;
	documentVersion: number;
	peerId: string;
}

/**
 * Statistics for operation history
 */
export interface HistoryStats {
	totalOperations: number;
	totalRooms: number;
	totalPeers: number;
	timeRange: {
		oldest: number;
		newest: number;
		span: number;
	};
	mostActiveRoom: string;
	mostActivePeer: string;
	averageOperationsPerRoom: number;
}

/**
 * Operation History Manager - Singleton
 * Central service for tracking, querying, and analyzing operations
 */
class OperationHistoryManager {
	private static instance: OperationHistoryManager;
	private operations: Map<string, StoredOperation[]> = new Map(); // roomId -> operations
	private checkpoints: Map<string, SessionCheckpoint[]> = new Map(); // roomId -> checkpoints
	private isInitialized = false;

	private constructor() {
		// Lazy initialization
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(): OperationHistoryManager {
		if (!OperationHistoryManager.instance) {
			OperationHistoryManager.instance = new OperationHistoryManager();
		}
		return OperationHistoryManager.instance;
	}

	/**
	 * Initialize operation history manager
	 * Load existing operations from database
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) return;

		try {
			console.log('[OperationHistoryManager] Initializing...');
			// In production, load existing operations from Supabase
			// For now, start fresh (will be populated as operations occur)
			this.isInitialized = true;
			console.log('[OperationHistoryManager] Initialized successfully');
		} catch (error) {
			console.error('[OperationHistoryManager] Initialization failed:', error);
			throw error;
		}
	}

	/**
	 * Record a new operation
	 */
	public recordOperation(
		roomId: string,
		operation: Omit<StoredOperation, 'id' | 'timestamp'>
	): StoredOperation {
		const storedOp: StoredOperation = {
			...operation,
			id: this.generateOperationId(),
			timestamp: Date.now(),
		};

		// Store in memory
		if (!this.operations.has(roomId)) {
			this.operations.set(roomId, []);
		}
		this.operations.get(roomId)!.push(storedOp);

		// Persist to database asynchronously
		this.persistOperationAsync(roomId, storedOp);

		return storedOp;
	}

	/**
	 * Get all operations for a room
	 */
	public getOperations(
		roomId: string,
		options?: {
			limit?: number;
			offset?: number;
			startTime?: number;
			endTime?: number;
			peerId?: string;
			operationType?: string;
		}
	): StoredOperation[] {
		let ops = this.operations.get(roomId) || [];

		// Filter by time range
		if (options?.startTime) {
			ops = ops.filter((op) => op.timestamp >= options.startTime!);
		}
		if (options?.endTime) {
			ops = ops.filter((op) => op.timestamp <= options.endTime!);
		}

		// Filter by peer
		if (options?.peerId) {
			ops = ops.filter((op) => op.peerId === options.peerId);
		}

		// Filter by operation type
		if (options?.operationType) {
			ops = ops.filter((op) => op.operationType === options.operationType);
		}

		// Apply offset and limit
		const offset = options?.offset || 0;
		const limit = options?.limit || ops.length;

		return ops.slice(offset, offset + limit);
	}

	/**
	 * Get operations since a specific operation or timestamp
	 */
	public getOperationsSince(
		roomId: string,
		sinceOperationId?: string,
		sinceTimestamp?: number
	): StoredOperation[] {
		const ops = this.operations.get(roomId) || [];

		if (sinceOperationId) {
			const index = ops.findIndex((op) => op.id === sinceOperationId);
			if (index >= 0) {
				return ops.slice(index + 1);
			}
		}

		if (sinceTimestamp) {
			return ops.filter((op) => op.timestamp > sinceTimestamp);
		}

		return [];
	}

	/**
	 * Get operations by specific peer
	 */
	public getOperationsByPeer(
		roomId: string,
		peerId: string,
		startTime?: number,
		endTime?: number
	): StoredOperation[] {
		let ops = (this.operations.get(roomId) || []).filter((op) => op.peerId === peerId);

		if (startTime) {
			ops = ops.filter((op) => op.timestamp >= startTime);
		}
		if (endTime) {
			ops = ops.filter((op) => op.timestamp <= endTime);
		}

		return ops;
	}

	/**
	 * Get operation summary for time range
	 */
	public getSummary(
		roomId: string,
		startTime?: number,
		endTime?: number
	): OperationSummary {
		let ops = this.operations.get(roomId) || [];

		if (startTime) {
			ops = ops.filter((op) => op.timestamp >= startTime);
		}
		if (endTime) {
			ops = ops.filter((op) => op.timestamp <= endTime);
		}

		if (ops.length === 0) {
			return {
				totalOperations: 0,
				timeRange: { start: startTime || 0, end: endTime || 0 },
				operationsByType: { insert: 0, delete: 0, replace: 0 },
				operationsByPeer: {},
				charactersAdded: 0,
				charactersDeleted: 0,
				averageTimeBetweenOps: 0,
			};
		}

		// Count by type
		const byType = { insert: 0, delete: 0, replace: 0 };
		const byPeer: Record<string, number> = {};
		let charsAdded = 0;
		let charsDeleted = 0;

		for (const op of ops) {
			byType[op.operationType]++;

			byPeer[op.peerId] = (byPeer[op.peerId] || 0) + 1;

			if (op.operationType === 'insert' && op.content) {
				charsAdded += op.content.length;
			}
			if (op.operationType === 'delete' && op.length) {
				charsDeleted += op.length;
			}
			if (op.operationType === 'replace') {
				if (op.content) charsAdded += op.content.length;
				if (op.deletedContent) charsDeleted += op.deletedContent.length;
			}
		}

		// Time between operations
		const timeSpan = ops[ops.length - 1].timestamp - ops[0].timestamp;
		const avgTimeBetweenOps = ops.length > 1 ? timeSpan / (ops.length - 1) : 0;

		return {
			totalOperations: ops.length,
			timeRange: {
				start: ops[0].timestamp,
				end: ops[ops.length - 1].timestamp,
			},
			operationsByType: byType,
			operationsByPeer: byPeer,
			charactersAdded: charsAdded,
			charactersDeleted: charsDeleted,
			averageTimeBetweenOps: avgTimeBetweenOps,
		};
	}

	/**
	 * Create checkpoint for undo/redo
	 */
	public createCheckpoint(
		roomId: string,
		operationId: string,
		documentContent: string,
		documentVersion: number,
		peerId: string
	): SessionCheckpoint {
		const checkpoint: SessionCheckpoint = {
			operationId,
			timestamp: Date.now(),
			documentContent,
			documentVersion,
			peerId,
		};

		if (!this.checkpoints.has(roomId)) {
			this.checkpoints.set(roomId, []);
		}
		this.checkpoints.get(roomId)!.push(checkpoint);

		// Keep only last 50 checkpoints to save memory
		const roomCheckpoints = this.checkpoints.get(roomId)!;
		if (roomCheckpoints.length > 50) {
			roomCheckpoints.shift();
		}

		return checkpoint;
	}

	/**
	 * Get checkpoints for a room (for undo/redo)
	 */
	public getCheckpoints(roomId: string, limit: number = 20): SessionCheckpoint[] {
		const checkpoints = this.checkpoints.get(roomId) || [];
		return checkpoints.slice(-limit);
	}

	/**
	 * Find checkpoint before given timestamp
	 */
	public getCheckpointBefore(roomId: string, timestamp: number): SessionCheckpoint | undefined {
		const checkpoints = this.checkpoints.get(roomId) || [];
		const filtered = checkpoints.filter((cp) => cp.timestamp <= timestamp);
		return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
	}

	/**
	 * Find checkpoint after given timestamp
	 */
	public getCheckpointAfter(roomId: string, timestamp: number): SessionCheckpoint | undefined {
		const checkpoints = this.checkpoints.get(roomId) || [];
		return checkpoints.find((cp) => cp.timestamp > timestamp);
	}

	/**
	 * Get all operations in reverse (for undo)
	 */
	public getOperationsReverse(roomId: string, limit?: number): StoredOperation[] {
		const ops = this.operations.get(roomId) || [];
		const reversed = [...ops].reverse();
		return limit ? reversed.slice(0, limit) : reversed;
	}

	/**
	 * Find operation by ID
	 */
	public getOperationById(roomId: string, operationId: string): StoredOperation | undefined {
		const ops = this.operations.get(roomId) || [];
		return ops.find((op) => op.id === operationId);
	}

	/**
	 * Mark operation as reverted
	 */
	public markReverted(roomId: string, operationId: string, revertedByOperationId: string): void {
		const ops = this.operations.get(roomId) || [];
		const op = ops.find((o) => o.id === operationId);
		if (op) {
			op.isReverted = true;
			op.revertedBy = revertedByOperationId;
		}
	}

	/**
	 * Get operations that haven't been reverted (net effect)
	 */
	public getNetOperations(roomId: string): StoredOperation[] {
		const ops = this.operations.get(roomId) || [];
		return ops.filter((op) => !op.isReverted);
	}

	/**
	 * Calculate net character changes
	 */
	public getNetCharacterChange(roomId: string): { added: number; deleted: number; net: number } {
		const netOps = this.getNetOperations(roomId);
		let added = 0;
		let deleted = 0;

		for (const op of netOps) {
			if (op.operationType === 'insert' && op.content) {
				added += op.content.length;
			}
			if (op.operationType === 'delete' && op.length) {
				deleted += op.length;
			}
			if (op.operationType === 'replace') {
				if (op.content) added += op.content.length;
				if (op.deletedContent) deleted += op.deletedContent.length;
			}
		}

		return { added, deleted, net: added - deleted };
	}

	/**
	 * Get comprehensive statistics
	 */
	public getStats(): HistoryStats {
		const allOps: StoredOperation[] = [];
		const rooms = new Set<string>();
		const peers = new Set<string>();

		for (const [roomId, ops] of this.operations) {
			rooms.add(roomId);
			allOps.push(...ops);
			for (const op of ops) {
				peers.add(op.peerId);
			}
		}

		let oldestTime = Date.now();
		let newestTime = 0;

		for (const op of allOps) {
			if (op.timestamp < oldestTime) oldestTime = op.timestamp;
			if (op.timestamp > newestTime) newestTime = op.timestamp;
		}

		// Find most active room
		let mostActiveRoom = '';
		let maxOpsInRoom = 0;
		for (const [roomId, ops] of this.operations) {
			if (ops.length > maxOpsInRoom) {
				maxOpsInRoom = ops.length;
				mostActiveRoom = roomId;
			}
		}

		// Find most active peer
		const peerOpCounts: Record<string, number> = {};
		for (const op of allOps) {
			peerOpCounts[op.peerId] = (peerOpCounts[op.peerId] || 0) + 1;
		}
		let mostActivePeer = '';
		let maxOpsByPeer = 0;
		for (const [peerId, count] of Object.entries(peerOpCounts)) {
			if (count > maxOpsByPeer) {
				maxOpsByPeer = count;
				mostActivePeer = peerId;
			}
		}

		return {
			totalOperations: allOps.length,
			totalRooms: rooms.size,
			totalPeers: peers.size,
			timeRange: {
				oldest: allOps.length > 0 ? oldestTime : 0,
				newest: allOps.length > 0 ? newestTime : 0,
				span: allOps.length > 0 ? newestTime - oldestTime : 0,
			},
			mostActiveRoom,
			mostActivePeer,
			averageOperationsPerRoom: rooms.size > 0 ? allOps.length / rooms.size : 0,
		};
	}

	/**
	 * Export operations for backup
	 */
	public exportOperations(roomId: string): StoredOperation[] {
		return [...(this.operations.get(roomId) || [])];
	}

	/**
	 * Import operations from backup
	 */
	public importOperations(roomId: string, operations: StoredOperation[]): void {
		this.operations.set(roomId, [...operations]);
	}

	/**
	 * Clear operations for a room (use with caution!)
	 */
	public clearRoom(roomId: string): void {
		this.operations.delete(roomId);
		this.checkpoints.delete(roomId);
	}

	/**
	 * Persist operation to database asynchronously
	 */
	private async persistOperationAsync(
		roomId: string,
		operation: StoredOperation
	): Promise<void> {
		try {
			await supabaseDB.saveOperation(roomId, operation);
		} catch (error) {
			console.error('[OperationHistoryManager] Failed to persist operation:', error);
			// Continue operation even if persistence fails (will retry later)
		}
	}

	/**
	 * Generate unique operation ID
	 */
	private generateOperationId(): string {
		return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Load operations from database on startup
	 */
	public async loadFromDatabase(roomId: string): Promise<void> {
		try {
			const ops = await supabaseDB.getOperations(roomId);
			if (ops && ops.length > 0) {
				this.operations.set(roomId, ops);
				console.log(`[OperationHistoryManager] Loaded ${ops.length} operations for room ${roomId}`);
			}
		} catch (error) {
			console.error('[OperationHistoryManager] Failed to load operations:', error);
		}
	}

	/**
	 * Prune old operations (configurable retention period)
	 */
	public pruneOldOperations(daysToKeep: number = 30): void {
		const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

		for (const [roomId, ops] of this.operations) {
			const filtered = ops.filter((op) => op.timestamp > cutoffTime);
			if (filtered.length < ops.length) {
				const removed = ops.length - filtered.length;
				this.operations.set(roomId, filtered);
				console.log(
					`[OperationHistoryManager] Pruned ${removed} operations from room ${roomId}`
				);
			}
		}
	}
}

// Export singleton instance
export const operationHistoryManager = OperationHistoryManager.getInstance();
