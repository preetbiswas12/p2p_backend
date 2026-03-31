/**
 * P2P Types - Minimal type definitions
 * Just what we need: signals, peers, rooms
 */

import { WebSocket } from 'ws';

/**
 * WebRTC/Chat Signal - frontend sends this to another peer
 */
export interface SignalMessage {
	type: 'auth' | 'offer' | 'answer' | 'ice' | 'chat' | 'sync';
	roomId: string;
	from: string;        // sender peer ID
	to?: string;         // target peer ID (for direct signals)
	data?: any;          // payload: SDP, ICE candidate, chat text, code change, etc.
	timestamp?: number;
}

/**
 * A connected peer in a room
 */
export interface Peer {
	id: string;
	name: string;
	socket: WebSocket;
	joinedAt: number;
}

/**
 * A collaboration room with multiple peers
 */
export interface Room {
	id: string;
	name: string;
	peers: Map<string, Peer>;
	createdAt: number;
}

/**
 * Server response to frontend
 */
export interface ServerMessage {
	type: string;
	roomId?: string;
	peerId?: string;
	peerName?: string;
	peers?: PeerInfo[];
	data?: any;
	timestamp?: number;
}

export interface PeerInfo {
	id: string;
	name: string;
	joinedAt?: number;
}
