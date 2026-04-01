/**
 * Operational Transform (OT) Service
 * Alternative to CRDT for collaborative editing
 *
 * OT vs CRDT:
 * - OT requires central server for conflict resolution
 * - OT is more space-efficient for large documents
 * - OT operations are smaller (position + content)
 * - OT requires in-order delivery for correctness
 * - CRDT works P2P without ordering requirement
 *
 * For P2P systems: CRDT is preferred
 * For client-server: OT is often simpler
 */

import { supabaseDB } from './supabaseDB.js';
import { getLogger } from './logger.js';

const logger = getLogger('[OT]');

interface OTOperation {
	id: string;
	peerId: string;
	type: 'insert' | 'delete';
	position: number;
	content?: string;
	length?: number;
	version: number;
	timestamp: number;
	roomId: string;
}

interface DocumentVersion {
	version: number;
	content: string;
	operations: OTOperation[];
	lastModified: number;
}

class OperationalTransform {
	private documents = new Map<string, DocumentVersion>();
	private pendingOperations = new Map<string, OTOperation[]>();

	constructor() {
		logger.info('[OperationalTransform] Initialized');
	}

	public initializeDocument(roomId: string, initialContent: string = ''): DocumentVersion {
		const doc: DocumentVersion = {
			version: 0,
			content: initialContent,
			operations: [],
			lastModified: Date.now(),
		};

		this.documents.set(roomId, doc);
		this.pendingOperations.set(roomId, []);

		logger.info(`[OperationalTransform] Document initialized: ${roomId}`);
		return doc;
	}

	public applyLocalOperation(
		roomId: string,
		peerId: string,
		type: 'insert' | 'delete',
		position: number,
		content?: string,
		length?: number
	): OTOperation {
		const doc = this.getDocument(roomId);
		const version = doc.version;

		if (type === 'insert') {
			const before = doc.content.substring(0, position);
			const after = doc.content.substring(position);
			doc.content = before + (content || '') + after;
		} else if (type === 'delete') {
			const before = doc.content.substring(0, position);
			const after = doc.content.substring(position + (length || 1));
			doc.content = before + after;
		}

		const operation: OTOperation = {
			id: this.generateOperationId(),
			peerId,
			type,
			position,
			content,
			length,
			version,
			timestamp: Date.now(),
			roomId,
		};

		doc.operations.push(operation);
		doc.version++;
		doc.lastModified = Date.now();

		logger.debug(`[OT] Applied local ${type}: pos=${position}, v${version} (room: ${roomId})`);

		return operation;
	}

	public applyRemoteOperation(
		roomId: string,
		remoteOp: OTOperation,
		ourVersion: number
	): { transformed: OTOperation; conflicts: number } {
		const doc = this.getDocument(roomId);

		if (remoteOp.version < ourVersion) {
			const existing = doc.operations.find((op) => op.id === remoteOp.id);
			if (existing) {
				logger.debug(`[OT] Operation already applied: ${remoteOp.id}`);
				return { transformed: remoteOp, conflicts: 0 };
			}
		}

		let transformedOp = { ...remoteOp };
		let conflictCount = 0;

		const concurrentOps = doc.operations.filter((op) => op.version >= remoteOp.version);

		for (const ourOp of concurrentOps) {
			const result = this.transformOperations(transformedOp, ourOp);
			transformedOp = result.remote;
			conflictCount += result.conflicts;
		}

		if (transformedOp.type === 'insert') {
			const before = doc.content.substring(0, transformedOp.position);
			const after = doc.content.substring(transformedOp.position);
			doc.content = before + (transformedOp.content || '') + after;
		} else if (transformedOp.type === 'delete') {
			const before = doc.content.substring(0, transformedOp.position);
			const after = doc.content.substring(transformedOp.position + (transformedOp.length || 1));
			doc.content = before + after;
		}

		if (!doc.operations.find((op) => op.id === transformedOp.id)) {
			doc.operations.push(transformedOp);
			doc.version++;
			doc.lastModified = Date.now();
		}

		logger.debug(
			`[OT] Applied remote ${transformedOp.type}: pos=${transformedOp.position}, conflicts=${conflictCount}`
		);

		return { transformed: transformedOp, conflicts: conflictCount };
	}

	private transformOperations(
		remoteOp: OTOperation,
		localOp: OTOperation
	): {
		remote: OTOperation;
		local: OTOperation;
		conflicts: number;
	} {
		const transformed = { ...remoteOp };
		const conflicts = 0;

		if (localOp.type === 'insert' && remoteOp.type === 'insert') {
			if (localOp.position < remoteOp.position) {
				transformed.position += (localOp.content || '').length;
			} else if (localOp.position === remoteOp.position) {
				if (localOp.peerId > remoteOp.peerId) {
					transformed.position += (localOp.content || '').length;
				}
			}
		} else if (localOp.type === 'insert' && remoteOp.type === 'delete') {
			if (localOp.position <= remoteOp.position) {
				transformed.position += (localOp.content || '').length;
			}
		} else if (localOp.type === 'delete' && remoteOp.type === 'insert') {
			if (localOp.position < remoteOp.position) {
				transformed.position -= localOp.length || 1;
				transformed.position = Math.max(0, transformed.position);
			}
		} else if (localOp.type === 'delete' && remoteOp.type === 'delete') {
			if (localOp.position < remoteOp.position) {
				transformed.position -= localOp.length || 1;
				transformed.position = Math.max(0, transformed.position);
			}
		}

		return {
			remote: transformed,
			local: localOp,
			conflicts,
		};
	}

	public getContent(roomId: string): string {
		const doc = this.getDocument(roomId);
		return doc.content;
	}

	public getVersion(roomId: string): number {
		const doc = this.getDocument(roomId);
		return doc.version;
	}

	public getHistory(roomId: string): OTOperation[] {
		const doc = this.getDocument(roomId);
		return doc.operations;
	}

	public getOperationsSince(roomId: string, sinceVersion: number): OTOperation[] {
		const doc = this.getDocument(roomId);
		return doc.operations.filter((op) => op.version > sinceVersion);
	}

	public validateOrder(roomId: string): {
		isValid: boolean;
		errors: string[];
	} {
		const doc = this.getDocument(roomId);
		const errors: string[] = [];

		for (let i = 1; i < doc.operations.length; i++) {
			const prev = doc.operations[i - 1];
			const curr = doc.operations[i];

			if (curr.version < prev.version) {
				errors.push(`Operation ${curr.id} has lower version (${curr.version}) than ${prev.id} (${prev.version})`);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
		};
	}

	public getStats(roomId: string): {
		version: number;
		contentLength: number;
		operationCount: number;
		lastModified: number;
	} {
		const doc = this.getDocument(roomId);
		return {
			version: doc.version,
			contentLength: doc.content.length,
			operationCount: doc.operations.length,
			lastModified: doc.lastModified,
		};
	}

	public exportState(roomId: string): {
		version: number;
		content: string;
		operations: OTOperation[];
	} {
		const doc = this.getDocument(roomId);
		return {
			version: doc.version,
			content: doc.content,
			operations: doc.operations,
		};
	}

	public importState(
		roomId: string,
		state: {
			version: number;
			content: string;
			operations: OTOperation[];
		}
	): void {
		const doc = this.initializeDocument(roomId, state.content);
		doc.version = state.version;
		doc.operations = state.operations;
		logger.debug(`[OT] State imported for room ${roomId} (v${state.version})`);
	}

	private getDocument(roomId: string): DocumentVersion {
		if (!this.documents.has(roomId)) {
			return this.initializeDocument(roomId);
		}
		return this.documents.get(roomId)!;
	}

	private generateOperationId(): string {
		return `ot_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}
}

export const operationalTransform = new OperationalTransform();
