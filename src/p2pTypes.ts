/**
 * P2P Collaboration Types
 * Shared type definitions for entire P2P system
 */

export enum RoomState {
	CREATING = 'creating',
	ACTIVE = 'active',
	IDLE = 'idle',
	CLOSING = 'closing',
	CLOSED = 'closed',
}

export enum SignalingMessageType {
	CREATE_ROOM = 'create-room',
	ROOM_CREATED = 'room-created',
	JOIN_ROOM = 'join-room',
	ROOM_JOINED = 'room-joined',
	LEAVE_ROOM = 'leave-room',
	PEER_JOINED = 'peer-joined',
	PEER_LEFT = 'peer-left',
	SDP_OFFER = 'sdp-offer',
	SDP_ANSWER = 'sdp-answer',
	ICE_CANDIDATE = 'ice-candidate',
	CHAT = 'chat',
	CODE_CHANGE = 'code-change',
	OPERATION = 'operation',
	CURSOR_UPDATE = 'cursor-update',
	PRESENCE = 'presence',
	HEARTBEAT = 'heartbeat',
	ERROR = 'error',
	AUTH = 'auth',
}

export interface RoomMetadata {
	roomId: string;
	roomName: string;
	hostId: string;
	hostName: string;
	fileId?: string;
	content?: string;
	version?: number;
	peerCount: number;
	state: RoomState;
	createdAt: number;
	lastActivity: number;
	peers: PeerInfo[];
}

export interface PeerInfo {
	userId: string;
	userName: string;
	isHost: boolean;
	connectedAt: number;
	lastHeartbeat: number;
}

export interface SignalingMessage {
	type: SignalingMessageType;
	roomId: string;
	userId: string;
	data?: Record<string, unknown>;
	timestamp: number;
	targetUserId?: string;
}

export interface WebRTCOffer {
	type: 'offer';
	sdp: string;
}

export interface WebRTCAnswer {
	type: 'answer';
	sdp: string;
}

export interface ICECandidate {
	candidate: string;
	sdpMLineIndex: number;
	sdpMid: string;
}

export interface IRoomManager {
	createRoom(
		roomId: string,
		roomName: string,
		hostId: string,
		hostName: string,
		fileId?: string,
		content?: string,
		version?: number
	): RoomMetadata | null;
	joinRoom(roomId: string, userId: string, userName: string): RoomMetadata | null;
	leaveRoom(roomId: string, userId: string): void;
	getRoomMetadata(roomId: string): RoomMetadata | null;
	getAllRooms(): Map<string, RoomMetadata>;
	getPeerList(roomId: string): PeerInfo[];
	broadcastToRoom(
		roomId: string,
		message: SignalingMessage,
		exceptUserId?: string
	): void;
	updatePeerHeartbeat(roomId: string, userId: string): boolean;
	recordOperation(roomId: string, operation: RemoteOperation): void;
	getStats(): ServerStats;
	getRoomStats(roomId: string): RoomStats | null;
	cleanup(): void;
	shutdown(): void;
}

export interface ISignalingServer {
	start(port: number): Promise<void>;
	stop(): Promise<void>;
	handleSDPOffer(roomId: string, userId: string, offer: WebRTCOffer): void;
	handleICECandidate(
		roomId: string,
		userId: string,
		candidate: ICECandidate
	): void;
	broadcastOperation(roomId: string, operation: RemoteOperation): void;
	getConnectionStats(): Record<string, unknown>;
}

export interface RemoteOperation {
	id: string;
	roomId: string;
	userId: string;
	type: 'insert' | 'delete' | 'replace';
	position: number;
	content?: string;
	timestamp: number;
	version: number;
}

export interface ServerStats {
	uptime: number;
	activeRooms: number;
	totalConnections: number;
	memory: {
		heapUsed: number;
		heapTotal: number;
		heapPercent: number;
		external: number;
	};
	cpu: {
		user: number;
		system: number;
		total: number;
	};
	operations: {
		total: number;
		perSecond: number;
	};
}

export interface RoomStats {
	roomId: string;
	peerCount: number;
	operationCount: number;
	bandwidth: {
		sent: number;
		received: number;
	};
	createdAt: number;
	lastActivity: number;
}
