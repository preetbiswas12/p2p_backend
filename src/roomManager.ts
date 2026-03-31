/**
 * Room Manager
 * Handles room lifecycle, peer management, and auto-cleanup
 */

import { EventEmitter } from 'events';
import {
	RoomMetadata,
	RoomState,
	PeerInfo,
	SignalingMessage,
	RemoteOperation,
	ServerStats,
	RoomStats,
	IRoomManager,
} from './p2pTypes.js';

class RoomManager extends EventEmitter implements IRoomManager {
	private rooms = new Map<string, RoomMetadata>();
	private startTime = Date.now();
	private cleanupInterval: NodeJS.Timeout | null = null;

	// Configuration (in milliseconds) - read from environment
	private readonly ROOM_INACTIVITY_TIMEOUT = parseInt(process.env.ROOM_INACTIVITY_TIMEOUT || '10800000', 10); // 3 hours default
	private readonly PEER_HEARTBEAT_TIMEOUT = parseInt(process.env.PEER_HEARTBEAT_TIMEOUT || '300000', 10); // 5 minutes default
	private readonly CLEANUP_CHECK_INTERVAL = parseInt(process.env.CLEANUP_CHECK_INTERVAL || '60000', 10); // 60 seconds default

	constructor() {
		super();
		this.startCleanupInterval();
	}

	public createRoom(
		roomId: string,
		roomName: string,
		hostId: string,
		hostName: string,
		_fileId?: string,
		_content?: string,
		_version?: number
	): RoomMetadata | null {
		if (this.rooms.has(roomId)) {
			return null;
		}

		// Do not retain file contents or large payloads on the signaling server; it only tracks room metadata.
		const room: RoomMetadata = {
			roomId,
			roomName,
			hostId,
			hostName,
			fileId: undefined,
			content: undefined,
			version: undefined,
			peerCount: 1,
			state: RoomState.ACTIVE,
			createdAt: Date.now(),
			lastActivity: Date.now(),
			peers: [
				{
					userId: hostId,
					userName: hostName,
					isHost: true,
					connectedAt: Date.now(),
					lastHeartbeat: Date.now(),
				},
			],
		};

		this.rooms.set(roomId, room);
		this.emit('roomCreated', room);
		return room;
	}

	public joinRoom(
		roomId: string,
		userId: string,
		userName: string
	): RoomMetadata | null {
		const room = this.rooms.get(roomId);
		if (!room) return null;

		const peerExists = room.peers.some((p) => p.userId === userId);
		if (peerExists) return room;

		const peerInfo: PeerInfo = {
			userId,
			userName,
			isHost: false,
			connectedAt: Date.now(),
			lastHeartbeat: Date.now(),
		};

		room.peers.push(peerInfo);
		room.peerCount = room.peers.length;
		room.state = RoomState.ACTIVE;
		room.lastActivity = Date.now();

		this.emit('peerJoined', { roomId, peer: peerInfo });
		return room;
	}

	public leaveRoom(roomId: string, userId: string): void {
		const room = this.rooms.get(roomId);
		if (!room) return;

		const peerIndex = room.peers.findIndex((p) => p.userId === userId);
		if (peerIndex === -1) return;

		const peer = room.peers[peerIndex];
		room.peers.splice(peerIndex, 1);
		room.peerCount = room.peers.length;
		room.lastActivity = Date.now();

		if (room.peerCount === 0) {
			room.state = RoomState.IDLE;
		}

		this.emit('peerLeft', { roomId, userId });
	}

	public getRoomMetadata(roomId: string): RoomMetadata | null {
		return this.rooms.get(roomId) || null;
	}

	public getAllRooms(): Map<string, RoomMetadata> {
		return new Map(this.rooms);
	}

	public getPeerList(roomId: string): PeerInfo[] {
		const room = this.rooms.get(roomId);
		return room ? [...room.peers] : [];
	}

	public broadcastToRoom(
		roomId: string,
		message: SignalingMessage,
		exceptUserId?: string
	): void {
		const room = this.rooms.get(roomId);
		if (!room) return;

		room.lastActivity = Date.now();
		this.emit('broadcast', { roomId, message, exceptUserId });
	}

	public updatePeerHeartbeat(roomId: string, userId: string): boolean {
		const room = this.rooms.get(roomId);
		if (!room) return false;

		const peer = room.peers.find((p) => p.userId === userId);
		if (!peer) return false;

		peer.lastHeartbeat = Date.now();
		room.lastActivity = Date.now();
		return true;
	}

	/**
	 * DEPRECATED: Operations are now handled peer-to-peer via WebRTC data channels.
	 * Clients exchange collaboration data directly without server involvement.
	 */
	public recordOperation(roomId: string, operation: RemoteOperation): void {
		// No-op: Server no longer stores operations
		console.log(
			`[RoomManager] Operation from ${operation.userId} in room ${roomId} - handled peer-to-peer`
		);
	}

	public getStats(): ServerStats {
		const uptime = Date.now() - this.startTime;
		const memUsage = process.memoryUsage();
		const cpuUsage = process.cpuUsage();

		return {
			uptime,
			activeRooms: this.rooms.size,
			totalConnections: Array.from(this.rooms.values()).reduce(
				(sum, room) => sum + room.peerCount,
				0
			),
			memory: {
				heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
				heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
				heapPercent: Math.round(
					(memUsage.heapUsed / memUsage.heapTotal) * 100
				),
				external: Math.round(memUsage.external / 1024 / 1024),
			},
			cpu: {
				user: cpuUsage.user,
				system: cpuUsage.system,
				total: cpuUsage.user + cpuUsage.system,
			},
			operations: {
				total: 0,
				perSecond: 0,
				note: 'Operations now handled peer-to-peer via WebRTC data channels',
			},
		};
	}

	public getRoomStats(roomId: string): RoomStats | null {
		const room = this.rooms.get(roomId);
		if (!room) return null;

		return {
			roomId,
			peerCount: room.peerCount,
			operationCount: 0,
			bandwidth: {
				sent: 0,
				received: 0,
				note: 'Bandwidth tracked peer-to-peer via WebRTC',
			},
			createdAt: room.createdAt,
			lastActivity: room.lastActivity,
		};
	}

	private startCleanupInterval(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, this.CLEANUP_CHECK_INTERVAL);
	}

	public cleanup(): void {
		const now = Date.now();
		const roomsToDelete: string[] = [];

		for (const [roomId, room] of this.rooms) {
			// Check room inactivity
			if (now - room.lastActivity > this.ROOM_INACTIVITY_TIMEOUT) {
				roomsToDelete.push(roomId);
				continue;
			}

			// Check peer heartbeat
			// Use slice() to create a copy before iteration to avoid mutation issues
			const deadPeers = room.peers.filter(
				(p) => now - p.lastHeartbeat > this.PEER_HEARTBEAT_TIMEOUT
			);

			if (deadPeers.length > 0) {
				// Remove dead peers one by one, checking if room should be deleted after each removal
				deadPeers.forEach((peer) => {
					this.leaveRoom(roomId, peer.userId);
				});

				// After removing all dead peers, check if room is now empty and should be deleted
				const updatedRoom = this.rooms.get(roomId);
				if (updatedRoom && updatedRoom.peerCount === 0 && !roomsToDelete.includes(roomId)) {
					roomsToDelete.push(roomId);
				}
			}
		}

		// Delete inactive rooms
		roomsToDelete.forEach((roomId) => {
			this.rooms.delete(roomId);
			this.emit('roomClosed', roomId);
		});

		if (roomsToDelete.length > 0) {
			console.log(`[RoomManager] Cleaned up ${roomsToDelete.length} rooms`);
		}
	}

	public shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.rooms.clear();
	}
}

export const roomManager = new RoomManager();
