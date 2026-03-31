/**
 * Lean P2P Server
 * Express HTTP + WebSocket signaling in one file
 * ~200 lines, handles everything the app needs
 */

import express, { Express } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { SignalMessage, ServerMessage, Room, Peer, PeerInfo } from './lean.types.js';

export class P2PServer {
	private app: Express;
	private wss: WebSocketServer;
	private rooms = new Map<string, Room>();
	private httpPort: number;
	private wsPort: number;

	constructor(httpPort: number, wsPort: number) {
		this.httpPort = httpPort;
		this.wsPort = wsPort;
		this.app = express();
		this.wss = new WebSocketServer({ port: wsPort });
		this.setupHTTP();
		this.setupWebSocket();
	}

	private setupHTTP() {
		// Middleware
		this.app.use(cors());
		this.app.use(express.json());

		// Root
		this.app.get('/', (req, res) => {
			res.json({
				name: 'OctateCode P2P Backend',
				status: 'running',
				rooms: this.rooms.size,
				docs: 'POST ws://localhost:3001 for signaling'
			});
		});

		// Health check
		this.app.get('/api/health', (req, res) => {
			res.json({
				status: 'ok',
				timestamp: Date.now(),
				rooms: this.rooms.size,
				totalPeers: Array.from(this.rooms.values()).reduce(
					(sum, room) => sum + room.peers.size, 0
				)
			});
		});

		// List all rooms
		this.app.get('/api/rooms', (req, res) => {
			const roomList = Array.from(this.rooms.values()).map(room => ({
				id: room.id,
				name: room.name,
				peerCount: room.peers.size,
				createdAt: room.createdAt,
				peers: Array.from(room.peers.values()).map(p => ({
					id: p.id,
					name: p.name,
					joinedAt: p.joinedAt
				}))
			}));
			res.json(roomList);
		});

		// Get specific room
		this.app.get('/api/rooms/:roomId', (req, res) => {
			const room = this.rooms.get(req.params.roomId);
			if (!room) {
				return res.status(404).json({ error: 'Room not found' });
			}
			return res.json({
				id: room.id,
				name: room.name,
				peerCount: room.peers.size,
				createdAt: room.createdAt,
				peers: Array.from(room.peers.values()).map(p => ({
					id: p.id,
					name: p.name,
					joinedAt: p.joinedAt
				}))
			});
		});

		// Error handler
		this.app.use((err: any, req: any, res: any) => {
			console.error('[HTTP Error]', err);
			res.status(500).json({ error: err.message });
		});

		// Start HTTP server
		this.app.listen(this.httpPort, () => {
			console.log(`✅ HTTP server listening on port ${this.httpPort}`);
		});
	}

	private setupWebSocket() {
		this.wss.on('connection', (socket) => {
			console.log(`[WebSocket] New connection`);

			socket.on('message', (data) => {
				try {
					const msg: SignalMessage = JSON.parse(data.toString());
					this.handleMessage(socket, msg);
				} catch (error) {
					console.error('[WebSocket] Parse error:', error);
					this.sendError(socket, 'Invalid message format');
				}
			});

			socket.on('close', () => {
				this.handleDisconnect(socket);
			});

			socket.on('error', (error) => {
				console.error('[WebSocket] Error:', error);
			});
		});

		this.wss.on('listening', () => {
			console.log(`✅ WebSocket server listening on port ${this.wsPort}`);
		});

		this.wss.on('error', (error) => {
			console.error('[WebSocket Server] Error:', error);
		});
	}

	/**
	 * Route incoming messages
	 */
	private handleMessage(socket: WebSocket, msg: SignalMessage) {
		const { type, roomId, from } = msg;

		if (!roomId || !from) {
			return this.sendError(socket, 'Missing roomId or from');
		}

		switch (type) {
			case 'auth':
				// Peer wants to join a room
				this.handleAuth(socket, msg);
				break;

			case 'offer':
			case 'answer':
			case 'ice':
				// WebRTC signals - forward to target peer
				this.forwardSignal(msg);
				break;

			case 'chat':
				// Chat message - broadcast to room
				this.broadcastToRoom(roomId, msg);
				break;

			case 'sync':
				// Code/document sync - broadcast to room
				this.broadcastToRoom(roomId, msg);
				break;

			default:
				console.warn(`[WebSocket] Unknown message type: ${type}`);
		}
	}

	/**
	 * Peer joins a room
	 */
	private handleAuth(socket: WebSocket, msg: SignalMessage) {
		const { roomId, from, data } = msg;
		const peerName = data?.name || `peer-${from.substring(0, 8)}`;

		// Get or create room
		if (!this.rooms.has(roomId)) {
			this.rooms.set(roomId, {
				id: roomId,
				name: data?.roomName || roomId,
				peers: new Map(),
				createdAt: Date.now()
			});
			console.log(`[Room] Created: ${roomId}`);
		}

		const room = this.rooms.get(roomId)!;

		// Register peer
		const peer: Peer = {
			id: from,
			name: peerName,
			socket,
			joinedAt: Date.now()
		};

		room.peers.set(from, peer);
		console.log(`[Room] ${roomId}: peer ${from} joined (total: ${room.peers.size})`);

		// Send peer list to new peer
		const peerList: PeerInfo[] = Array.from(room.peers.values())
			.filter(p => p.id !== from)
			.map(p => ({ id: p.id, name: p.name }));

		this.send(socket, {
			type: 'peerList',
			roomId,
			peers: peerList
		});

		// Notify other peers of new peer
		this.broadcastToRoom(roomId, {
			type: 'peerJoined',
			roomId,
			peerId: from,
			peerName
		}, from); // exclude sender
	}

	/**
	 * Forward WebRTC signal to target peer
	 */
	private forwardSignal(msg: SignalMessage) {
		const { roomId, from, to, type, data } = msg;

		if (!to) {
			console.warn(`[Signal] No target specified for ${type}`);
			return;
		}

		const room = this.rooms.get(roomId);
		if (!room) {
			console.warn(`[Signal] Room ${roomId} not found`);
			return;
		}

		const targetPeer = room.peers.get(to);
		if (!targetPeer) {
			console.warn(`[Signal] Peer ${to} not found in room ${roomId}`);
			return;
		}

		if (targetPeer.socket.readyState === WebSocket.OPEN) {
			this.send(targetPeer.socket, {
				type: type as any,
				roomId,
				data
			});
		}
	}

	/**
	 * Broadcast message to all peers in a room
	 */
	private broadcastToRoom(
		roomId: string,
		msg: any,
		excludePeerId?: string
	) {
		const room = this.rooms.get(roomId);
		if (!room) return;

		const payload = JSON.stringify(msg);

		room.peers.forEach((peer, peerId) => {
			// Skip sender
			if (excludePeerId && peerId === excludePeerId) return;

			// Only send if socket is open
			if (peer.socket.readyState === WebSocket.OPEN) {
				peer.socket.send(payload);
			}
		});
	}

	/**
	 * Handle peer disconnect
	 */
	private handleDisconnect(socket: WebSocket) {
		let disconnectedPeerId: string | null = null;
		let disconnectedRoom: string | null = null;

		// Find which peer disconnected
		this.rooms.forEach((room, roomId) => {
			room.peers.forEach((peer, peerId) => {
				if (peer.socket === socket) {
					disconnectedPeerId = peerId;
					disconnectedRoom = roomId;
				}
			});
		});

		if (disconnectedPeerId && disconnectedRoom) {
			const room = this.rooms.get(disconnectedRoom)!;

			// Remove peer
			room.peers.delete(disconnectedPeerId);
			console.log(`[Room] ${disconnectedRoom}: peer ${disconnectedPeerId} left (total: ${room.peers.size})`);

			// Notify others
			this.broadcastToRoom(disconnectedRoom, {
				type: 'peerLeft',
				roomId: disconnectedRoom,
				peerId: disconnectedPeerId
			});

			// Clean up empty rooms
			if (room.peers.size === 0) {
				this.rooms.delete(disconnectedRoom);
				console.log(`[Room] Deleted empty room: ${disconnectedRoom}`);
			}
		}
	}

	/**
	 * Send message to specific socket
	 */
	private send(socket: WebSocket, msg: ServerMessage) {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(msg));
		}
	}

	/**
	 * Send error to socket
	 */
	private sendError(socket: WebSocket, error: string) {
		this.send(socket, {
			type: 'error',
			data: { error }
		});
	}

	public async stop() {
		return new Promise<void>((resolve) => {
			this.wss.close(() => {
				console.log('[WebSocket] Server stopped');
				resolve();
			});
		});
	}
}
