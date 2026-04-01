/**
 * Session Manager Service
 * Handles session lifecycle, persistence, and recovery
 */

import { supabaseDB } from './supabaseDB.js';
import { getLogger } from './logger.js';

const logger = getLogger('[Session]');

interface SessionMetadata {
	sessionId: string;
	userId: string;
	roomId: string;
	connectionId: string;
	isConnected: boolean;
	createdAt: number;
	lastConnectedAt: number;
	lastDisconnectedAt: number | null;
	pendingOperations: PendingOperation[];
}

interface PendingOperation {
	operationId: string;
	type: string;
	position: number;
	content?: string;
	timestamp: number;
	acknowledged: boolean;
}

interface SessionRecoveryData {
	session: SessionMetadata;
	room: {
		roomId: string;
		roomName: string;
		content?: string;
		version?: number;
		peers: Array<{
			userId: string;
			userName: string;
			isHost: boolean;
		}>;
	};
	pendingOperations: PendingOperation[];
}

class SessionManager {
	private sessions = new Map<string, SessionMetadata>();
	private userSessions = new Map<string, string[]>();
	private cleanupInterval: NodeJS.Timeout | null = null;

	private readonly SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000', 10);
	private readonly CLEANUP_INTERVAL = parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000', 10);
	private readonly MAX_PENDING_OPERATIONS = 1000;

	constructor() {
		this.startCleanup();
		logger.info('[SessionManager] Initialized');
	}

	public async createOrResumeSession(
		userId: string,
		roomId: string,
		connectionId: string,
		existingSessionId?: string
	): Promise<SessionRecoveryData | null> {
		try {
			let sessionId = existingSessionId;
			let isNewSession = false;

			if (existingSessionId) {
				const existing = this.sessions.get(existingSessionId);
				if (existing && existing.userId === userId && existing.roomId === roomId) {
					sessionId = existingSessionId;
					existing.connectionId = connectionId;
					existing.isConnected = true;
					existing.lastConnectedAt = Date.now();
				} else {
					sessionId = this.generateSessionId();
					isNewSession = true;
				}
			} else {
				sessionId = this.generateSessionId();
				isNewSession = true;
			}

			const now = Date.now();
			const session: SessionMetadata = {
				sessionId,
				userId,
				roomId,
				connectionId,
				isConnected: true,
				createdAt: isNewSession ? now : this.sessions.get(sessionId)?.createdAt || now,
				lastConnectedAt: now,
				lastDisconnectedAt: null,
				pendingOperations: isNewSession ? [] : this.sessions.get(sessionId)?.pendingOperations || [],
			};

			this.sessions.set(sessionId, session);
			this.trackUserSession(userId, sessionId);

			await supabaseDB.createOrUpdateSession(session);

			const recoveryData = await this.getSessionRecoveryData(sessionId);

			if (recoveryData) {
				logger.info(
					`[SessionManager] Session ${isNewSession ? 'created' : 'resumed'}: ${sessionId} for user ${userId} in room ${roomId}`
				);
			}

			return recoveryData;
		} catch (error) {
			logger.error('[SessionManager] Error creating/resuming session:', error);
			return null;
		}
	}

	public async getSessionRecoveryData(sessionId: string): Promise<SessionRecoveryData | null> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				return null;
			}

			const roomData = await supabaseDB.getRoomWithPeers(session.roomId);
			if (!roomData) {
				return null;
			}

			const pendingOps = await supabaseDB.getPendingOperations(session.roomId, session.userId);

			return {
				session,
				room: {
					roomId: roomData.roomId,
					roomName: roomData.roomName,
					content: roomData.content,
					version: roomData.version,
					peers: roomData.peers,
				},
				pendingOperations: pendingOps,
			};
		} catch (error) {
			logger.error('[SessionManager] Error getting recovery data:', error);
			return null;
		}
	}

	public async disconnectSession(sessionId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) return;

			session.isConnected = false;
			session.lastDisconnectedAt = Date.now();

			await supabaseDB.updateSessionDisconnection(sessionId, Date.now());

			logger.info(`[SessionManager] Session disconnected: ${sessionId}`);
		} catch (error) {
			logger.error('[SessionManager] Error disconnecting session:', error);
		}
	}

	public async addPendingOperation(
		sessionId: string,
		operationId: string,
		operationType: string,
		position: number,
		content?: string
	): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) return;

			const operation: PendingOperation = {
				operationId,
				type: operationType,
				position,
				content,
				timestamp: Date.now(),
				acknowledged: false,
			};

			if (session.pendingOperations.length >= this.MAX_PENDING_OPERATIONS) {
				session.pendingOperations.shift();
			}

			session.pendingOperations.push(operation);

			await supabaseDB.createPendingOperation(
				sessionId,
				session.roomId,
				session.userId,
				operation
			);

			logger.debug(`[SessionManager] Pending operation added: ${operationId}`);
		} catch (error) {
			logger.error('[SessionManager] Error adding pending operation:', error);
		}
	}

	public async acknowledgeOperation(sessionId: string, operationId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) return;

			const operation = session.pendingOperations.find((op) => op.operationId === operationId);
			if (operation) {
				operation.acknowledged = true;
			}

			await supabaseDB.acknowledgePendingOperation(sessionId, operationId);

			logger.debug(`[SessionManager] Operation acknowledged: ${operationId}`);
		} catch (error) {
			logger.error('[SessionManager] Error acknowledging operation:', error);
		}
	}

	public getUnacknowledgedOperations(sessionId: string): PendingOperation[] {
		const session = this.sessions.get(sessionId);
		if (!session) return [];

		return session.pendingOperations.filter((op) => !op.acknowledged);
	}

	public async terminateSession(sessionId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) return;

			await supabaseDB.terminateSession(sessionId);

			this.sessions.delete(sessionId);
			const userSessions = this.userSessions.get(session.userId) || [];
			const index = userSessions.indexOf(sessionId);
			if (index > -1) {
				userSessions.splice(index, 1);
			}

			logger.info(`[SessionManager] Session terminated: ${sessionId}`);
		} catch (error) {
			logger.error('[SessionManager] Error terminating session:', error);
		}
	}

	public getUserSessions(userId: string): SessionMetadata[] {
		const sessionIds = this.userSessions.get(userId) || [];
		return sessionIds
			.map((id) => this.sessions.get(id))
			.filter((session) => session !== undefined) as SessionMetadata[];
	}

	public getSession(sessionId: string): SessionMetadata | undefined {
		return this.sessions.get(sessionId);
	}

	public getStats(): {
		activeSessions: number;
		disconnectedSessions: number;
		totalSessions: number;
		totalUsers: number;
	} {
		const activeSessions = Array.from(this.sessions.values()).filter((s) => s.isConnected).length;
		const disconnectedSessions = this.sessions.size - activeSessions;

		return {
			activeSessions,
			disconnectedSessions,
			totalSessions: this.sessions.size,
			totalUsers: this.userSessions.size,
		};
	}

	private startCleanup(): void {
		this.cleanupInterval = setInterval(async () => {
			await this.cleanup();
		}, this.CLEANUP_INTERVAL);

		logger.info('[SessionManager] Cleanup service started');
	}

	private async cleanup(): Promise<void> {
		try {
			const now = Date.now();
			const sessionsToDelete: string[] = [];

			for (const [sessionId, session] of this.sessions) {
				const lastActivity = session.lastDisconnectedAt || session.lastConnectedAt;
				if (now - lastActivity > this.SESSION_TIMEOUT) {
					sessionsToDelete.push(sessionId);
				}
			}

			for (const sessionId of sessionsToDelete) {
				const session = this.sessions.get(sessionId);
				if (session) {
					this.sessions.delete(sessionId);
					const userSessions = this.userSessions.get(session.userId) || [];
					const index = userSessions.indexOf(sessionId);
					if (index > -1) {
						userSessions.splice(index, 1);
					}

					await supabaseDB.deleteExpiredSession(sessionId);
				}
			}

			if (sessionsToDelete.length > 0) {
				logger.info(`[SessionManager] Cleaned up ${sessionsToDelete.length} expired sessions`);
			}
		} catch (error) {
			logger.error('[SessionManager] Error during cleanup:', error);
		}
	}

	public shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.sessions.clear();
		this.userSessions.clear();
		logger.info('[SessionManager] Shutdown complete');
	}

	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
	}

	private trackUserSession(userId: string, sessionId: string): void {
		const userSessions = this.userSessions.get(userId) || [];
		if (!userSessions.includes(sessionId)) {
			userSessions.push(sessionId);
			this.userSessions.set(userId, userSessions);
		}
	}
}

export const sessionManager = new SessionManager();
