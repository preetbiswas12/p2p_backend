/**
 * HTTP Routes
 * Monitoring and debugging endpoints for the P2P server
 */

import { Router, Request, Response } from 'express';
import { roomManager } from './roomManager.js';
import { memoryManager } from './memoryManager.js';
import { signalingServer } from './signalingServer.js';
import { authManager } from './authManager.js';

export function setupRoutes(router: Router): void {
	/**
	 * Health Check
	 * GET /health
	 * Used by Render for monitoring
	 */
	router.get('/health', (req: Request, res: Response) => {
		const memStats = memoryManager.getMemoryStats();
		res.json({
			status: 'ok',
			timestamp: Date.now(),
			memory: memStats,
		});
	});

	/**
	 * Server Statistics
	 * GET /stats
	 */
	router.get('/stats', (req: Request, res: Response) => {
		const serverStats = roomManager.getStats();
		const memStats = memoryManager.getMemoryStats();
		const memThresholds = memoryManager.getThresholds();
		const connStats = signalingServer.getConnectionStats();

		res.json({
			server: {
				uptime: serverStats.uptime,
				activeRooms: serverStats.activeRooms,
				totalConnections: serverStats.totalConnections,
				connectedClients: connStats.connectedClients,
			},
			memory: memStats,
			thresholds: memThresholds,
			cpu: serverStats.cpu,
			operations: serverStats.operations,
			timestamp: Date.now(),
		});
	});

	/**
	 * Server Information
	 * GET /info
	 */
	router.get('/info', (req: Request, res: Response) => {
		res.json({
			name: 'OctateCode P2P Backend',
			version: '1.0.0',
			description: 'Standalone P2P collaboration server',
			features: [
				'WebRTC signaling',
				'Room management',
				'Memory optimization',
				'Auto-cleanup',
			],
			endpoints: [
				{
					path: '/health',
					method: 'GET',
					description: 'Health check for Render monitoring',
				},
				{
					path: '/stats',
					method: 'GET',
					description: 'Server and room statistics',
				},
				{
					path: '/auth/token',
					method: 'POST',
					description: 'Generate auth token for user to join room',
					body: { userId: 'string', roomId: 'string' },
				},
				{
					path: '/rooms',
					method: 'GET',
					description: 'List all active rooms',
				},
				{
					path: '/rooms',
					method: 'POST',
					description: 'Create a new room',
					body: { room_id: 'string', room_name: 'string', host_id: 'string' }
				},
				{
					path: '/rooms/:roomId',
					method: 'GET',
					description: 'Get details of a specific room',
				},
				{
					path: '/rooms/:roomId/stats',
					method: 'GET',
					description: 'Get statistics for a specific room',
				},
				{
					path: '/rooms/:roomId/peers',
					method: 'GET',
					description: 'Get peers in a specific room',
				},
				{
					path: '/rooms/:roomId/join',
					method: 'POST',
					description: 'Join a room',
					body: { user_id: 'string', user_name: 'string' }
				},
				{
					path: '/rooms/:roomId/leave',
					method: 'POST',
					description: 'Leave a room',
					body: { user_id: 'string' }
				},
				{
					path: '/rooms/:roomId/operations',
					method: 'POST',
					description: 'Save document operation',
					body: { operation_id: 'string', user_id: 'string', data: 'object', version: 'number' }
				},
				{
					path: '/maintenance/cleanup',
					method: 'POST',
					description: 'Manually trigger room cleanup',
				},
				{
					path: '/maintenance/gc',
					method: 'POST',
					description: 'Manually trigger garbage collection',
				},
			],
		});
	});

	/**
	 * Generate Auth Token
	 * POST /auth/token
	 * Call this BEFORE connecting to WebSocket signaling server
	 * Required body: { userId, roomId }
	 */
	router.post('/auth/token', (req: Request, res: Response) => {
		const { userId, roomId } = req.body;

		if (!userId || !roomId) {
			return res.status(400).json({
				error: 'Missing required fields',
				required: ['userId', 'roomId'],
				timestamp: Date.now(),
			});
		}

		try {
			const token = authManager.generateToken(userId, roomId);
			return res.json({
				status: 'success',
				token,
				userId,
				roomId,
				expiresIn: '1 hour',
				message: 'Use this token when connecting to WebSocket signaling server',
				timestamp: Date.now(),
			});
		} catch (error) {
			return res.status(500).json({
				error: 'Failed to generate token',
				message: error instanceof Error ? error.message : 'Unknown error',
				timestamp: Date.now(),
			});
		}
	});

	/**
	 * List All Rooms
	 * GET /rooms
	 */
	router.get('/rooms', (req: Request, res: Response) => {
		const rooms = roomManager.getAllRooms();
		const roomList = Array.from(rooms.values()).map((room) => ({
			roomId: room.roomId,
			roomName: room.roomName,
			hostId: room.hostId,
			peerCount: room.peerCount,
			state: room.state,
			createdAt: room.createdAt,
			lastActivity: room.lastActivity,
		}));

		res.json({
			count: rooms.size,
			rooms: roomList,
			timestamp: Date.now(),
		});
	});

	/**
	 * Get Room Details
	 * GET /rooms/:roomId
	 */
	router.get('/rooms/:roomId', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const room = roomManager.getRoomMetadata(roomId);

		if (!room) {
			return res.status(404).json({
				error: 'Room not found',
				roomId,
				timestamp: Date.now(),
			});
		}

		const stats = roomManager.getRoomStats(roomId);

		return res.json({
			metadata: room,
			stats,
			timestamp: Date.now(),
		});
	});

	/**
	 * Get Room Statistics
	 * GET /rooms/:roomId/stats
	 */
	router.get('/rooms/:roomId/stats', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const stats = roomManager.getRoomStats(roomId);

		if (!stats) {
			return res.status(404).json({
				error: 'Room not found',
				roomId,
				timestamp: Date.now(),
			});
		}

		return res.json({
			...stats,
			timestamp: Date.now(),
		});
	});

	/**
	 * Get Room Peers
	 * GET /rooms/:roomId/peers
	 */
	router.get('/rooms/:roomId/peers', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const room = roomManager.getRoomMetadata(roomId);

		if (!room) {
			return res.status(404).json({
				error: 'Room not found',
				roomId,
				timestamp: Date.now(),
			});
		}

		return res.json({
			roomId,
			peerCount: room.peerCount,
			peers: room.peers,
			timestamp: Date.now(),
		});
	});

	/**
	 * Create Room
	 * POST /rooms or POST /rooms/create
	 */
	router.post('/rooms/create', (req: Request, res: Response) => {
		const { roomName, hostId, hostName } = req.body;

		if (!roomName) {
			return res.status(400).json({
				error: 'Missing roomName',
				timestamp: Date.now(),
			});
		}

		try {
			// Generate roomId from roomName + timestamp
			const roomId = `${roomName.replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
			const metadata = roomManager.createRoom(roomId, roomName, hostId || 'unknown', hostName || 'Host');
			return res.status(201).json({
				...metadata,
				timestamp: Date.now(),
			});
		} catch (error) {
			return res.status(500).json({
				error: 'Failed to create room',
				message: error instanceof Error ? error.message : 'Unknown error',
				timestamp: Date.now(),
			});
		}
	});

	/**
	 * Create Room (legacy endpoint)
	 * POST /rooms
	 */
	router.post('/rooms', (req: Request, res: Response) => {
		const { room_id, room_name, host_id } = req.body;

		if (!room_id) {
			return res.status(400).json({
				error: 'Missing room_id',
				timestamp: Date.now(),
			});
		}

		try {
			const metadata = roomManager.createRoom(room_id, room_name || room_id, host_id || 'unknown', 'Host');
			return res.status(201).json({
				message: 'Room created',
				data: metadata,
				timestamp: Date.now(),
			});
		} catch (error) {
			return res.status(500).json({
				error: 'Failed to create room',
				message: error instanceof Error ? error.message : 'Unknown error',
				timestamp: Date.now(),
			});
		}
	});

	/**
	 * Join Room
	 * POST /rooms/:roomId/join
	 */
	router.post('/rooms/:roomId/join', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const { user_id, user_name } = req.body;

		if (!user_id) {
			return res.status(400).json({
				error: 'Missing user_id',
				timestamp: Date.now(),
			});
		}

		try {
			const success = roomManager.joinRoom(roomId, user_id, user_name || user_id);
			if (!success) {
				return res.status(404).json({
					error: 'Room not found or join failed',
					roomId,
					timestamp: Date.now(),
				});
			}

			const room = roomManager.getRoomMetadata(roomId);
			return res.json({
				message: 'User joined room',
				roomId,
				userId: user_id,
				room,
				timestamp: Date.now(),
			});
		} catch (error) {
			return res.status(500).json({
				error: 'Failed to join room',
				message: error instanceof Error ? error.message : 'Unknown error',
				timestamp: Date.now(),
			});
		}
	});

	/**
	 * Leave Room
	 * POST /rooms/:roomId/leave
	 */
	router.post('/rooms/:roomId/leave', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const { user_id } = req.body;

		if (!user_id) {
			return res.status(400).json({
				error: 'Missing user_id',
				timestamp: Date.now(),
			});
		}

		try {
			roomManager.leaveRoom(roomId, user_id);
			return res.json({
				message: 'User left room',
				roomId,
				userId: user_id,
				timestamp: Date.now(),
			});
		} catch (error) {
			return res.status(500).json({
				error: 'Failed to leave room',
				message: error instanceof Error ? error.message : 'Unknown error',
				timestamp: Date.now(),
			});
		}
	});

	/**
	 * Save Document Operation
	 * POST /rooms/:roomId/operations
	 */
	router.post('/rooms/:roomId/operations', (req: Request, res: Response) => {
		return res.status(410).json({
			error: 'Operations are peer-to-peer only. Use WebRTC data channels; server does not store or relay operations.',
			timestamp: Date.now(),
		});
	});

	/**
	 * Manual Cleanup
	 * POST /maintenance/cleanup
	 */
	router.post('/maintenance/cleanup', (req: Request, res: Response) => {
		const before = roomManager.getStats().activeRooms;
		roomManager.cleanup();
		const after = roomManager.getStats().activeRooms;

		res.json({
			message: 'Cleanup triggered',
			before,
			after,
			cleaned: before - after,
			timestamp: Date.now(),
		});
	});

	/**
	 * Manual Garbage Collection
	 * POST /maintenance/gc
	 * Requires: --expose-gc flag when starting Node.js
	 */
	router.post('/maintenance/gc', (req: Request, res: Response) => {
		const memBefore = memoryManager.getMemoryStats();

		if (global.gc) {
			global.gc();
			const memAfter = memoryManager.getMemoryStats();

			res.json({
				message: 'Garbage collection triggered',
				before: memBefore,
				after: memAfter,
				freed: memBefore.heapUsed - memAfter.heapUsed,
				timestamp: Date.now(),
			});
		} else {
			res.status(503).json({
				error: 'Garbage collection not available',
				message:
					'Start Node.js with --expose-gc flag to enable this endpoint',
				timestamp: Date.now(),
			});
		}
	});
}
