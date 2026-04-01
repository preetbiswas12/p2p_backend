/**
 * Supabase Database Service
 * Handles all database operations for tokens, rooms, peers, and operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import type { StoredOperation } from './operationHistoryManager.js';

interface DatabaseTables {
	auth_tokens: {
		id: string;
		user_id: string;
		room_id: string;
		token: string;
		issued_at: number;
		expires_at: number;
		signature: string;
		is_valid: boolean;
		created_at: string;
	};
	rooms: {
		id: string;
		room_id: string;
		room_name: string;
		host_id: string;
		host_name: string;
		file_id?: string;
		content?: string;
		version: number;
		peer_count: number;
		state: string;
		created_at: string;
		last_activity: number;
		is_active: boolean;
	};
	peers: {
		id: string;
		room_id: string;
		user_id: string;
		user_name: string;
		is_host: boolean;
		connected_at: number;
		last_heartbeat: number;
		created_at: string;
	};
	operations: {
		id: string;
		room_id: string;
		peer_id: string;
		operation_id: string;
		operation_type: string;
		position: number;
		content?: string;
		version: number;
		timestamp: number;
		created_at: string;
	};
}

class SupabaseDatabase {
	private client: SupabaseClient | null = null;
	private isInitialized = false;

	constructor() {
		this.initializeClient();
	}

	/**
	 * Initialize Supabase client connection
	 */
	private initializeClient(): void {
		const supabaseUrl = process.env.SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_ANON_KEY;
		const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

		if (!supabaseUrl || !supabaseKey) {
			logger.warn('[SupabaseDB] Missing Supabase credentials - database disabled');
			return;
		}

		try {
			// Use service role key for admin operations (on server)
			const key = supabaseServiceKey || supabaseKey;
			this.client = createClient(supabaseUrl, key);
			this.isInitialized = true;
			logger.info('[SupabaseDB] Connected successfully');
		} catch (error) {
			logger.error('[SupabaseDB] Failed to initialize:', error);
			this.isInitialized = false;
		}
	}

	/**
	 * Check if database is available
	 */
	public isReady(): boolean {
		return this.isInitialized && this.client != null;
	}

	// ==================== AUTH TOKENS ====================

	/**
	 * Save auth token to database
	 */
	public async saveToken(
		userId: string,
		roomId: string,
		token: string,
		signature: string,
		expiresAt: number
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('auth_tokens')
				.insert({
					user_id: userId,
					room_id: roomId,
					token,
					issued_at: Date.now(),
					expires_at: expiresAt,
					signature,
					is_valid: true,
				});

			if (error) {
				logger.warn('[SupabaseDB] Failed to save token:', error.message);
				return false;
			}

			logger.info(`[SupabaseDB] Token saved for ${userId} in room ${roomId}`);
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error saving token:', error);
			return false;
		}
	}

	/**
	 * Validate token exists and is not expired
	 */
	public async validateToken(
		token: string,
		userId: string,
		roomId: string
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { data, error } = await this.client!
				.from('auth_tokens')
				.select('*')
				.eq('token', token)
				.eq('user_id', userId)
				.eq('room_id', roomId)
				.eq('is_valid', true)
				.single();

			if (error || !data) {
				return false;
			}

			// Check if expired
			if (Date.now() > data.expires_at) {
				// Mark as invalid
				await this.invalidateToken(token);
				return false;
			}

			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error validating token:', error);
			return false;
		}
	}

	/**
	 * Invalidate token (logout)
	 */
	public async invalidateToken(token: string): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('auth_tokens')
				.update({ is_valid: false })
				.eq('token', token);

			if (error) {
				logger.warn('[SupabaseDB] Failed to invalidate token:', error.message);
				return false;
			}

			logger.info('[SupabaseDB] Token invalidated');
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error invalidating token:', error);
			return false;
		}
	}

	/**
	 * Clean up expired tokens (call periodically)
	 */
	public async cleanupExpiredTokens(): Promise<number> {
		if (!this.isReady()) return 0;

		try {
			const now = Date.now();
			const { data, error } = await this.client!
				.from('auth_tokens')
				.delete()
				.lt('expires_at', now);

			if (error) {
				logger.warn('[SupabaseDB] Failed to cleanup tokens:', error.message);
				return 0;
			}

			logger.info('[SupabaseDB] Expired tokens cleaned up');
			return 1;
		} catch (error) {
			logger.error('[SupabaseDB] Error cleaning up tokens:', error);
			return 0;
		}
	}

	// ==================== ROOMS ====================

	/**
	 * Save room metadata
	 */
	public async saveRoom(
		roomId: string,
		roomName: string,
		hostId: string,
		hostName: string,
		fileId?: string,
		content?: string,
		version: number = 1
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('rooms')
				.insert({
					room_id: roomId,
					room_name: roomName,
					host_id: hostId,
					host_name: hostName,
					file_id: fileId,
					content,
					version,
					peer_count: 1,
					state: 'ACTIVE',
					last_activity: Date.now(),
					is_active: true,
				});

			if (error) {
				logger.warn('[SupabaseDB] Failed to save room:', error.message);
				return false;
			}

			logger.info(`[SupabaseDB] Room ${roomId} saved`);
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error saving room:', error);
			return false;
		}
	}

	/**
	 * Get room by ID
	 */
	public async getRoom(roomId: string) {
		if (!this.isReady()) return null;

		try {
			const { data, error } = await this.client!
				.from('rooms')
				.select('*')
				.eq('room_id', roomId)
				.single();

			if (error || !data) {
				return null;
			}

			return data;
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching room:', error);
			return null;
		}
	}

	/**
	 * Update room activity timestamp
	 */
	public async updateRoomActivity(roomId: string): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('rooms')
				.update({ last_activity: Date.now() })
				.eq('room_id', roomId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to update room activity:', error.message);
				return false;
			}

			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error updating room activity:', error);
			return false;
		}
	}

	/**
	 * Update peer count for room
	 */
	public async updatePeerCount(roomId: string, count: number): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('rooms')
				.update({ peer_count: count })
				.eq('room_id', roomId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to update peer count:', error.message);
				return false;
			}

			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error updating peer count:', error);
			return false;
		}
	}

	/**
	 * Close/deactivate room
	 */
	public async closeRoom(roomId: string): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('rooms')
				.update({ is_active: false, state: 'CLOSED' })
				.eq('room_id', roomId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to close room:', error.message);
				return false;
			}

			logger.info(`[SupabaseDB] Room ${roomId} closed`);
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error closing room:', error);
			return false;
		}
	}

	// ==================== PEERS ====================

	/**
	 * Add peer to room
	 */
	public async addPeer(
		roomId: string,
		userId: string,
		userName: string,
		isHost: boolean = false
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('peers')
				.insert({
					room_id: roomId,
					user_id: userId,
					user_name: userName,
					is_host: isHost,
					connected_at: Date.now(),
					last_heartbeat: Date.now(),
				});

			if (error) {
				logger.warn('[SupabaseDB] Failed to add peer:', error.message);
				return false;
			}

			logger.info(`[SupabaseDB] Peer ${userId} added to room ${roomId}`);
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error adding peer:', error);
			return false;
		}
	}

	/**
	 * Remove peer from room
	 */
	public async removePeer(roomId: string, userId: string): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('peers')
				.delete()
				.eq('room_id', roomId)
				.eq('user_id', userId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to remove peer:', error.message);
				return false;
			}

			logger.info(`[SupabaseDB] Peer ${userId} removed from room ${roomId}`);
			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error removing peer:', error);
			return false;
		}
	}

	/**
	 * Update peer heartbeat
	 */
	public async updatePeerHeartbeat(
		roomId: string,
		userId: string
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('peers')
				.update({ last_heartbeat: Date.now() })
				.eq('room_id', roomId)
				.eq('user_id', userId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to update heartbeat:', error.message);
				return false;
			}

			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error updating heartbeat:', error);
			return false;
		}
	}

	/**
	 * Get peers in room
	 */
	public async getPeersInRoom(roomId: string) {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('peers')
				.select('*')
				.eq('room_id', roomId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to fetch peers:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching peers:', error);
			return [];
		}
	}

	// ==================== OPERATIONS ====================

	/**
	 * Log collaboration operation
	 */
	public async logOperation(
		roomId: string,
		peerId: string,
		operationId: string,
		operationType: string,
		position: number,
		content?: string,
		version: number = 1
	): Promise<boolean> {
		if (!this.isReady()) return false;

		try {
			const { error } = await this.client!
				.from('operations')
				.insert({
					room_id: roomId,
					peer_id: peerId,
					operation_id: operationId,
					operation_type: operationType,
					position,
					content,
					version,
					timestamp: Date.now(),
				});

			if (error) {
				logger.warn('[SupabaseDB] Failed to log operation:', error.message);
				return false;
			}

			return true;
		} catch (error) {
			logger.error('[SupabaseDB] Error logging operation:', error);
			return false;
		}
	}

	/**
	 * Get operation history for room
	 */
	public async getOperationHistory(roomId: string, limit: number = 100) {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('operations')
				.select('*')
				.eq('room_id', roomId)
				.order('created_at', { ascending: false })
				.limit(limit);

			if (error) {
				logger.warn('[SupabaseDB] Failed to fetch operations:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching operations:', error);
			return [];
		}
	}

	/**
	 * Get operations by peer
	 */
	public async getOperationsByPeer(roomId: string, peerId: string) {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('operations')
				.select('*')
				.eq('room_id', roomId)
				.eq('peer_id', peerId)
				.order('created_at', { ascending: false });

			if (error) {
				logger.warn('[SupabaseDB] Failed to fetch peer operations:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching peer operations:', error);
			return [];
		}
	}

	// ==================== CLEANUP ====================

	/**
	 * Clean up inactive/closed rooms periodically
	 */
	public async cleanupInactiveRooms(inactivityThreshold: number): Promise<number> {
		if (!this.isReady()) return 0;

		try {
			const cutoffTime = Date.now() - inactivityThreshold;
			const { data, error } = await this.client!
				.from('rooms')
				.delete()
				.lt('last_activity', cutoffTime)
				.eq('is_active', false);

			if (error) {
				logger.warn('[SupabaseDB] Failed to cleanup rooms:', error.message);
				return 0;
			}

			logger.info('[SupabaseDB] Inactive rooms cleaned up');
			return 1;
		} catch (error) {
			logger.error('[SupabaseDB] Error cleaning up rooms:', error);
			return 0;
		}
	}

	/**
	 * Archive old operations (keep last 1000)
	 */
	public async archiveOldOperations(roomId: string): Promise<number> {
		if (!this.isReady()) return 0;

		try {
			// Get count of operations
			const { count } = await this.client!
				.from('operations')
				.select('*', { count: 'exact' })
				.eq('room_id', roomId);

			if (!count || count <= 1000) {
				return 0;
			}

			// Delete oldest operations beyond 1000
			const { data, error } = await this.client!
				.from('operations')
				.delete()
				.eq('room_id', roomId)
				.lt('created_at', Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

			if (error) {
				logger.warn('[SupabaseDB] Failed to archive operations:', error.message);
				return 0;
			}

			return 1;
		} catch (error) {
			logger.error('[SupabaseDB] Error archiving operations:', error);
			return 0;
		}
	}

	// ==================== SESSIONS ====================

	/**
	 * Create or update a user session
	 */
	public async createOrUpdateSession(session: any): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('sessions')
				.upsert([
					{
						session_id: session.sessionId,
						user_id: session.userId,
						room_id: session.roomId,
						connection_id: session.connectionId,
						is_connected: session.isConnected,
						created_at: new Date(session.createdAt).toISOString(),
						last_connected_at: new Date(session.lastConnectedAt).toISOString(),
						last_disconnected_at: session.lastDisconnectedAt
							? new Date(session.lastDisconnectedAt).toISOString()
							: null,
					},
				], { onConflict: 'session_id' });

			if (error) {
				logger.warn('[SupabaseDB] Failed to upsert session:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Session upserted: ${session.sessionId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error upserting session:', error);
		}
	}

	/**
	 * Get room with peer information
	 */
	public async getRoomWithPeers(roomId: string): Promise<any> {
		if (!this.isReady()) return null;

		try {
			const { data: roomData, error: roomError } = await this.client!
				.from('rooms')
				.select('*')
				.eq('room_id', roomId)
				.single();

			if (roomError || !roomData) {
				logger.debug('[SupabaseDB] Room not found:', roomId);
				return null;
			}

			const { data: peersData, error: peersError } = await this.client!
				.from('peers')
				.select('user_id, user_name, is_host')
				.eq('room_id', roomId);

			if (peersError) {
				logger.warn('[SupabaseDB] Failed to fetch peers:', peersError.message);
				return roomData;
			}

			return {
				...roomData,
				peers: peersData || [],
			};
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching room with peers:', error);
			return null;
		}
	}

	/**
	 * Get pending operations for a user in a room
	 */
	public async getPendingOperations(roomId: string, userId: string): Promise<any[]> {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('pending_operations')
				.select('*')
				.eq('room_id', roomId)
				.eq('user_id', userId)
				.eq('acknowledged', false)
				.order('timestamp', { ascending: true });

			if (error) {
				logger.warn('[SupabaseDB] Failed to fetch pending operations:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error fetching pending operations:', error);
			return [];
		}
	}

	/**
	 * Create a pending operation
	 */
	public async createPendingOperation(
		sessionId: string,
		roomId: string,
		userId: string,
		operation: any
	): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('pending_operations')
				.insert([
					{
						session_id: sessionId,
						room_id: roomId,
						user_id: userId,
						operation_id: operation.operationId,
						operation_type: operation.type,
						position: operation.position,
						content: operation.content || null,
						timestamp: operation.timestamp,
						acknowledged: false,
					},
				]);

			if (error) {
				logger.warn('[SupabaseDB] Failed to create pending operation:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Pending operation created: ${operation.operationId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error creating pending operation:', error);
		}
	}

	/**
	 * Acknowledge a pending operation
	 */
	public async acknowledgePendingOperation(sessionId: string, operationId: string): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('pending_operations')
				.update({ acknowledged: true })
				.eq('session_id', sessionId)
				.eq('operation_id', operationId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to acknowledge operation:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Operation acknowledged: ${operationId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error acknowledging operation:', error);
		}
	}

	/**
	 * Update session disconnection time
	 */
	public async updateSessionDisconnection(sessionId: string, disconnectTime: number): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('sessions')
				.update({
					is_connected: false,
					last_disconnected_at: new Date(disconnectTime).toISOString(),
				})
				.eq('session_id', sessionId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to update session disconnection:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Session disconnection updated: ${sessionId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error updating session disconnection:', error);
		}
	}

	/**
	 * Terminate a session
	 */
	public async terminateSession(sessionId: string): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('sessions')
				.update({ is_connected: false })
				.eq('session_id', sessionId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to terminate session:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Session terminated: ${sessionId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error terminating session:', error);
		}
	}

	/**
	 * Delete an expired session
	 */
	public async deleteExpiredSession(sessionId: string): Promise<void> {
		if (!this.isReady()) return;

		try {
			// Delete related pending operations first
			await this.client!
				.from('pending_operations')
				.delete()
				.eq('session_id', sessionId);

			// Delete the session
			const { error } = await this.client!
				.from('sessions')
				.delete()
				.eq('session_id', sessionId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to delete expired session:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Expired session deleted: ${sessionId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error deleting expired session:', error);
		}
	}

	// ==================== OPERATION HISTORY ====================

	/**
	 * Save an operation to history
	 */
	public async saveOperation(roomId: string, operation: StoredOperation): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('operation_history')
				.insert({
					room_id: roomId,
					operation_id: operation.id,
					peer_id: operation.peerId,
					peer_name: operation.peerName || null,
					operation_type: operation.operationType,
					position: operation.position,
					content: operation.content || null,
					deleted_content: operation.deletedContent || null,
					length: operation.length || null,
					timestamp: operation.timestamp,
					document_version: operation.documentVersion,
					crdt_version: operation.craVersion || null,
					ot_version: operation.otVersion || null,
					parent_operation_id: operation.parentOperationId || null,
					metadata: operation.metadata || null,
					is_reverted: operation.isReverted || false,
					reverted_by: operation.revertedBy || null,
					created_at: new Date().toISOString(),
				});

			if (error) {
				logger.warn('[SupabaseDB] Failed to save operation:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Operation saved: ${operation.id} in room ${roomId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error saving operation:', error);
		}
	}

	/**
	 * Get all operations for a room
	 */
	public async getOperations(roomId: string): Promise<StoredOperation[]> {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('operation_history')
				.select('*')
				.eq('room_id', roomId)
				.order('timestamp', { ascending: true });

			if (error) {
				logger.warn('[SupabaseDB] Failed to get operations:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error getting operations:', error);
			return [];
		}
	}

	/**
	 * Get operations within a time range
	 */
	public async getOperationsInTimeRange(
		roomId: string,
		startTime: number,
		endTime: number
	): Promise<StoredOperation[]> {
		if (!this.isReady()) return [];

		try {
			const { data, error } = await this.client!
				.from('operation_history')
				.select('*')
				.eq('room_id', roomId)
				.gte('timestamp', startTime)
				.lte('timestamp', endTime)
				.order('timestamp', { ascending: true });

			if (error) {
				logger.warn('[SupabaseDB] Failed to get operations in time range:', error.message);
				return [];
			}

			return data || [];
		} catch (error) {
			logger.error('[SupabaseDB] Error getting operations in time range:', error);
			return [];
		}
	}

	/**
	 * Mark operation as reverted
	 */
	public async revertOperation(operationId: string, revertedByOperationId: string): Promise<void> {
		if (!this.isReady()) return;

		try {
			const { error } = await this.client!
				.from('operation_history')
				.update({
					is_reverted: true,
					reverted_by: revertedByOperationId,
				})
				.eq('operation_id', operationId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to mark operation as reverted:', error.message);
				return;
			}

			logger.debug(`[SupabaseDB] Operation reverted: ${operationId}`);
		} catch (error) {
			logger.error('[SupabaseDB] Error reverting operation:', error);
		}
	}

	/**
	 * Get operation count for a room
	 */
	public async getOperationCount(roomId: string): Promise<number> {
		if (!this.isReady()) return 0;

		try {
			const { count, error } = await this.client!
				.from('operation_history')
				.select('*', { count: 'exact', head: true })
				.eq('room_id', roomId);

			if (error) {
				logger.warn('[SupabaseDB] Failed to get operation count:', error.message);
				return 0;
			}

			return count || 0;
		} catch (error) {
			logger.error('[SupabaseDB] Error getting operation count:', error);
			return 0;
		}
	}

	/**
	 * Clean old operations (retention policy)
	 */
	public async cleanOldOperations(daysToKeep: number = 30): Promise<number> {
		if (!this.isReady()) return 0;

		try {
			const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

			const { data, error } = await this.client!
				.from('operation_history')
				.delete()
				.lt('created_at', cutoffDate)
				.select('*');

			if (error) {
				logger.warn('[SupabaseDB] Failed to clean old operations:', error.message);
				return 0;
			}

			const deleted = data?.length || 0;
			logger.debug(`[SupabaseDB] Cleaned ${deleted} old operations`);
			return deleted;
		} catch (error) {
			logger.error('[SupabaseDB] Error cleaning old operations:', error);
			return 0;
		}
	}
}

export const supabaseDB = new SupabaseDatabase();
