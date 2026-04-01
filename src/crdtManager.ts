/**
 * CRDT Manager Service
 * Implements a String-based CRDT (Conflict-free Replicated Data Type)
 * Using a hybrid approach combining character-level operations with causal ordering
 *
 * Advantages over Operational Transform:
 * - No central server needed for conflict resolution
 * - Works with out-of-order message delivery
 * - Strongly consistent across all replicas
 * - Suitable for P2P systems
 */

import { supabaseDB } from './supabaseDB.js';
import { getLogger } from './logger.js';

const logger = getLogger('[CRDT]');

interface CharacterId {
	peerId: string; // Unique peer identifier
	clock: number; // Lamport clock for causality
	position: number; // Original position in character stream
}

interface CRDTCharacter {
	value: string;
	id: CharacterId;
	deleted: boolean; // Tombstone for deletion
	timestamp: number;
}

interface CRDTOperation {
	id: string; // Unique operation ID
	peerId: string; // Who performed the operation
	operationType: 'insert' | 'delete'; // insert or delete
	position: number; // Position in current document
	content?: string; // For insert operations
	characterIds?: CharacterId[]; // For delete operations
	clock: number; // Lamport clock
	roomId: string;
	timestamp: number;
}

interface DocumentState {
	roomId: string;
	characters: CRDTCharacter[]; // List of all characters (including deleted/tombstones)
	version: number; // Version number (incremented per operation)
	peers: Map<string, number>; // peerId -> lamport clock
	content: string; // Current visible content (live characters only)
}

class CRDTManager {
	private documents = new Map<string, DocumentState>();
	private operationLog = new Map<string, CRDTOperation[]>(); // roomId -> operations
	private peerClocks = new Map<string, Map<string, number>>(); // roomId -> peerId -> clock
	private lastOperationId = 0;

	constructor() {
		logger.info('[CRDTManager] Initialized');
	}

	public initializeDocument(roomId: string, initialContent: string = ''): DocumentState {
		const doc: DocumentState = {
			roomId,
			characters: this.contentToCharacters(initialContent, 'system'),
			version: 0,
			peers: new Map(),
			content: initialContent,
		};

		this.documents.set(roomId, doc);
		this.operationLog.set(roomId, []);
		this.peerClocks.set(roomId, new Map());

		logger.info(`[CRDTManager] Document initialized for room ${roomId}`);
		return doc;
	}

	public getDocument(roomId: string): DocumentState {
		if (!this.documents.has(roomId)) {
			return this.initializeDocument(roomId);
		}
		return this.documents.get(roomId)!;
	}

	public applyInsert(
		roomId: string,
		peerId: string,
		position: number,
		content: string
	): CRDTOperation {
		const doc = this.getDocument(roomId);
		const clock = this.incrementClock(roomId, peerId);

		const newCharacters: CRDTCharacter[] = [];
		for (let i = 0; i < content.length; i++) {
			const charId: CharacterId = {
				peerId,
				clock,
				position: i,
			};

			newCharacters.push({
				value: content[i],
				id: charId,
				deleted: false,
				timestamp: Date.now(),
			});
		}

		const insertIndex = this.getCharArrayIndex(doc, position);
		doc.characters.splice(insertIndex, 0, ...newCharacters);

		doc.version++;

		this.rebuildContent(doc);

		const operation: CRDTOperation = {
			id: this.generateOperationId(),
			peerId,
			operationType: 'insert',
			position,
			content,
			clock,
			roomId,
			timestamp: Date.now(),
		};

		this.logOperation(roomId, operation);

		logger.debug(
			`[CRDTManager] Insert at ${position}: "${content}" (room: ${roomId}, peer: ${peerId})`
		);

		return operation;
	}

	public applyDelete(
		roomId: string,
		peerId: string,
		position: number,
		length: number = 1
	): CRDTOperation {
		const doc = this.getDocument(roomId);
		const clock = this.incrementClock(roomId, peerId);

		const deletedCharacterIds: CharacterId[] = [];
		let visibleIndex = 0;
		let deleted = 0;

		for (let i = 0; i < doc.characters.length && deleted < length; i++) {
			const char = doc.characters[i];

			if (!char.deleted) {
				if (visibleIndex >= position && visibleIndex < position + length) {
					char.deleted = true;
					deletedCharacterIds.push(char.id);
					deleted++;
				}
				visibleIndex++;
			}
		}

		doc.version++;

		this.rebuildContent(doc);

		const operation: CRDTOperation = {
			id: this.generateOperationId(),
			peerId,
			operationType: 'delete',
			position,
			characterIds: deletedCharacterIds,
			clock,
			roomId,
			timestamp: Date.now(),
		};

		this.logOperation(roomId, operation);

		logger.debug(
			`[CRDTManager] Delete at ${position} (length: ${length}, room: ${roomId}, peer: ${peerId})`
		);

		return operation;
	}

	public integrateRemoteOperation(roomId: string, operation: CRDTOperation): void {
		const doc = this.getDocument(roomId);

		this.updateClock(roomId, operation.peerId, operation.clock);

		if (operation.operationType === 'insert') {
			const content = operation.content || '';
			for (let i = 0; i < content.length; i++) {
				const charId: CharacterId = {
					peerId: operation.peerId,
					clock: operation.clock,
					position: i,
				};

				doc.characters.push({
					value: content[i],
					id: charId,
					deleted: false,
					timestamp: operation.timestamp,
				});
			}
		} else if (operation.operationType === 'delete') {
			for (const charId of operation.characterIds || []) {
				const char = doc.characters.find((c) => this.characterIdsEqual(c.id, charId));
				if (char) {
					char.deleted = true;
				}
			}
		}

		doc.version++;

		this.rebuildContent(doc);

		logger.debug(
			`[CRDTManager] Integrated remote ${operation.operationType} (room: ${roomId}, peer: ${operation.peerId})`
		);
	}

	public integrateOperations(roomId: string, operations: CRDTOperation[]): void {
		for (const op of operations) {
			this.integrateRemoteOperation(roomId, op);
		}
	}

	public getContent(roomId: string): string {
		const doc = this.getDocument(roomId);
		return doc.content;
	}

	public getCharacterState(roomId: string): CRDTCharacter[] {
		const doc = this.getDocument(roomId);
		return doc.characters.filter((c) => !c.deleted);
	}

	public getOperationHistory(roomId: string): CRDTOperation[] {
		return this.operationLog.get(roomId) || [];
	}

	public getOperationsSince(roomId: string, sinceVersion: number): CRDTOperation[] {
		const history = this.getOperationHistory(roomId);
		return history.filter((op) => {
			return this.getOperationIndex(roomId, op.id) > sinceVersion;
		});
	}

	public validateConsistency(roomId: string): {
		isConsistent: boolean;
		errors: string[];
	} {
		const doc = this.getDocument(roomId);
		const errors: string[] = [];

		const charIds = new Set<string>();
		for (const char of doc.characters) {
			const idStr = `${char.id.peerId}:${char.id.clock}:${char.id.position}`;
			if (charIds.has(idStr)) {
				errors.push(`Duplicate character ID: ${idStr}`);
			}
			charIds.add(idStr);
		}

		const peerClocks = new Map<string, number>();
		for (const char of doc.characters) {
			const lastClock = peerClocks.get(char.id.peerId) || 0;
			if (char.id.clock < lastClock) {
				errors.push(`Non-monotonic clock for peer ${char.id.peerId}`);
			}
			peerClocks.set(char.id.peerId, Math.max(lastClock, char.id.clock));
		}

		const rebuiltContent = doc.characters
			.filter((c) => !c.deleted)
			.map((c) => c.value)
			.join('');
		if (rebuiltContent !== doc.content) {
			errors.push('Content mismatch: visible content does not match character array');
		}

		return {
			isConsistent: errors.length === 0,
			errors,
		};
	}

	public getStats(roomId: string): {
		documentVersion: number;
		totalCharacters: number;
		visibleCharacters: number;
		deletedCharacters: number;
		contentLength: number;
		operationCount: number;
		peerCount: number;
	} {
		const doc = this.getDocument(roomId);
		const operations = this.getOperationHistory(roomId);
		const visibleChars = doc.characters.filter((c) => !c.deleted);
		const deletedChars = doc.characters.filter((c) => c.deleted);

		return {
			documentVersion: doc.version,
			totalCharacters: doc.characters.length,
			visibleCharacters: visibleChars.length,
			deletedCharacters: deletedChars.length,
			contentLength: doc.content.length,
			operationCount: operations.length,
			peerCount: doc.peers.size,
		};
	}

	public async persistDocument(roomId: string): Promise<void> {
		try {
			const doc = this.getDocument(roomId);
			const operations = this.getOperationHistory(roomId);

			for (const op of operations) {
				await supabaseDB.saveOperation(roomId, {
					id: op.id,
					roomId: roomId,
					peerId: op.peerId,
					operationType: op.operationType,
					position: op.position,
					content: op.content,
					documentVersion: doc.version,
					timestamp: op.timestamp,
				});
			}

			logger.debug(`[CRDTManager] Document persisted: ${roomId} (v${doc.version})`);
		} catch (error) {
			logger.error('[CRDTManager] Error persisting document:', error);
		}
	}

	public async loadDocument(roomId: string, content: string = ''): Promise<DocumentState> {
		try {
			const doc = this.initializeDocument(roomId, content);

			const operations = await supabaseDB.getOperations(roomId);

			if (operations.length > 0) {
				const crdt_ops = operations.map((op: any) => ({
					id: op.operation_id,
					peerId: op.peer_id,
					operationType: op.operation_type,
					position: op.position,
					content: op.content,
					clock: op.version,
					roomId,
					timestamp: op.timestamp,
				}));

				this.integrateOperations(roomId, crdt_ops);
			}

			logger.info(`[CRDTManager] Document loaded: ${roomId} (${operations.length} operations)`);
			return doc;
		} catch (error) {
			logger.error('[CRDTManager] Error loading document:', error);
			return this.initializeDocument(roomId, content);
		}
	}

	public exportState(roomId: string): {
		version: number;
		content: string;
		characters: CRDTCharacter[];
		peers: Record<string, number>;
	} {
		const doc = this.getDocument(roomId);
		return {
			version: doc.version,
			content: doc.content,
			characters: doc.characters,
			peers: Object.fromEntries(doc.peers),
		};
	}

	public importState(
		roomId: string,
		state: {
			version: number;
			content: string;
			characters: CRDTCharacter[];
			peers: Record<string, number>;
		}
	): void {
		const doc = this.initializeDocument(roomId, '');
		doc.version = state.version;
		doc.characters = state.characters;
		doc.content = state.content;

		for (const [peerId, clock] of Object.entries(state.peers)) {
			doc.peers.set(peerId, clock);
			this.updateClock(roomId, peerId, clock);
		}

		logger.debug(`[CRDTManager] State imported for room ${roomId} (v${state.version})`);
	}

	private contentToCharacters(content: string, peerId: string): CRDTCharacter[] {
		return Array.from(content).map((char, i) => ({
			value: char,
			id: {
				peerId,
				clock: 0,
				position: i,
			},
			deleted: false,
			timestamp: Date.now(),
		}));
	}

	private getCharArrayIndex(doc: DocumentState, visiblePosition: number): number {
		let visibleCount = 0;

		for (let i = 0; i < doc.characters.length; i++) {
			if (!doc.characters[i].deleted) {
				if (visibleCount === visiblePosition) {
					return i;
				}
				visibleCount++;
			}
		}

		return doc.characters.length;
	}

	private rebuildContent(doc: DocumentState): void {
		const sorted = [...doc.characters].sort((a, b) => {
			if (a.id.clock !== b.id.clock) return a.id.clock - b.id.clock;
			if (a.id.peerId !== b.id.peerId) return a.id.peerId.localeCompare(b.id.peerId);
			return a.id.position - b.id.position;
		});

		doc.content = sorted.filter((c) => !c.deleted).map((c) => c.value).join('');
	}

	private incrementClock(roomId: string, peerId: string): number {
		const peerClocks = this.peerClocks.get(roomId)!;
		const currentClock = peerClocks.get(peerId) || 0;
		const newClock = currentClock + 1;
		peerClocks.set(peerId, newClock);
		return newClock;
	}

	private updateClock(roomId: string, peerId: string, clock: number): void {
		const peerClocks = this.peerClocks.get(roomId)!;
		const currentClock = peerClocks.get(peerId) || 0;
		peerClocks.set(peerId, Math.max(currentClock, clock + 1));
	}

	private characterIdsEqual(a: CharacterId, b: CharacterId): boolean {
		return a.peerId === b.peerId && a.clock === b.clock && a.position === b.position;
	}

	private generateOperationId(): string {
		return `op_${Date.now()}_${++this.lastOperationId}`;
	}

	private logOperation(roomId: string, operation: CRDTOperation): void {
		const ops = this.operationLog.get(roomId)!;
		ops.push(operation);
	}

	private getOperationIndex(roomId: string, operationId: string): number {
		const ops = this.operationLog.get(roomId) || [];
		return ops.findIndex((op) => op.id === operationId);
	}
}

export const crdtManager = new CRDTManager();
