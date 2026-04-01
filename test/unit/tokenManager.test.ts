/**
 * Token Manager Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Mock the tokenManager
class TokenManager {
	private tokens: Map<string, { roomId: string; peerId: string; expiresAt: number }> = new Map();

	generateSessionToken(roomId: string, peerId: string, expirationMs = 3600000): string {
		const token = `token_${Math.random().toString(36).substring(7)}`;
		this.tokens.set(token, {
			roomId,
			peerId,
			expiresAt: Date.now() + expirationMs,
		});
		return token;
	}

	validateToken(token: string): { roomId: string; peerId: string } | null {
		const entry = this.tokens.get(token);
		if (!entry) return null;
		if (Date.now() > entry.expiresAt) {
			this.tokens.delete(token);
			return null;
		}
		return { roomId: entry.roomId, peerId: entry.peerId };
	}

	revokeToken(token: string): void {
		this.tokens.delete(token);
	}
}

describe('TokenManager', () => {
	let tokenManager: TokenManager;

	beforeEach(() => {
		tokenManager = new TokenManager();
	});

	it('should generate a valid token', () => {
		const token = tokenManager.generateSessionToken('room-1', 'peer-1');
		expect(token).toBeDefined();
		expect(token).toContain('token_');
	});

	it('should validate a valid token', () => {
		const token = tokenManager.generateSessionToken('room-1', 'peer-1');
		const result = tokenManager.validateToken(token);

		expect(result).toBeDefined();
		if (result) {
			expect(result.roomId).toBe('room-1');
			expect(result.peerId).toBe('peer-1');
		}
	});

	it('should return null for invalid token', () => {
		const result = tokenManager.validateToken('invalid-token');
		expect(result).toBeNull();
	});

	it('should revoke a token', () => {
		const token = tokenManager.generateSessionToken('room-1', 'peer-1');
		tokenManager.revokeToken(token);

		const result = tokenManager.validateToken(token);
		expect(result).toBeNull();
	});

	it('should handle token expiration', () => {
		const token = tokenManager.generateSessionToken('room-1', 'peer-1', 100); // 100ms expiration

		// Token should be valid immediately
		expect(tokenManager.validateToken(token)).toBeDefined();

		// Wait for expiration
		return new Promise((resolve) => {
			setTimeout(() => {
				const result = tokenManager.validateToken(token);
				expect(result).toBeNull();
				resolve(null);
			}, 150);
		});
	});
});
