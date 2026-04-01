/**
 * Token Manager Service
 * Handles token lifecycle: generation, validation, expiration, and cleanup
 * Persists all tokens to Supabase for durability across server restarts
 */

import { supabaseDB } from './supabaseDB.js';
import { getLogger } from './logger.js';

const logger = getLogger('[Token]');
import * as crypto from 'crypto';

interface TokenMetadata {
	tokenId: string;
	userId: string;
	roomId: string;
	token: string;
	issuedAt: number;
	expiresAt: number;
	signature: string;
	isValid: boolean;
	lastValidated?: number;
}

interface ValidationResult {
	valid: boolean;
	userId?: string;
	roomId?: string;
	error?: string;
	tokenMetadata?: TokenMetadata;
}

class TokenManager {
	private readonly TOKEN_EXPIRY = 60 * 60 * 1000;
	private readonly SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production';
	private readonly CLEANUP_INTERVAL = 5 * 60 * 1000;
	private readonly VALIDATION_CACHE_TTL = 30 * 1000;

	private validationCache = new Map<string, { result: ValidationResult; timestamp: number }>();
	private cleanupInterval: NodeJS.Timeout | null = null;
	private tokenGenerationCount = 0;
	private tokenValidationCount = 0;

	constructor() {
		this.startCleanup();
	}

	public async generateToken(userId: string, roomId: string): Promise<string> {
		try {
			if (!userId || !roomId) {
				throw new Error('userId and roomId are required');
			}

			const issuedAt = Date.now();
			const expiresAt = issuedAt + this.TOKEN_EXPIRY;
			const signature = this.createSignature(userId, roomId);

			const tokenPayload = {
				userId,
				roomId,
				issuedAt,
				expiresAt,
				signature,
			};

			const tokenStr = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

			if (supabaseDB.isReady()) {
				const saved = await supabaseDB.saveToken(
					userId,
					roomId,
					tokenStr,
					signature,
					expiresAt
				);

				if (!saved) {
					logger.warn(
						'[TokenManager] Failed to persist token to Supabase, operating in degraded mode'
					);
				}
			} else {
				logger.warn(
					'[TokenManager] Supabase unavailable, token will not persist across restarts'
				);
			}

			this.tokenGenerationCount++;
			logger.info(
				`[TokenManager] Token generated for ${userId} in room ${roomId} (total: ${this.tokenGenerationCount})`
			);

			return tokenStr;
		} catch (error) {
			logger.error('[TokenManager] Error generating token:', error);
			throw error;
		}
	}

	public async validateToken(
		token: string,
		userId: string,
		roomId: string
	): Promise<ValidationResult> {
		try {
			this.tokenValidationCount++;

			const cacheKey = `${token}-${userId}-${roomId}`;
			const cached = this.validationCache.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < this.VALIDATION_CACHE_TTL) {
				logger.debug('[TokenManager] Validation cache hit');
				return cached.result;
			}

			let tokenData;
			try {
				const decoded = Buffer.from(token, 'base64').toString('utf-8');
				tokenData = JSON.parse(decoded);
			} catch (error) {
				return {
					valid: false,
					error: 'Invalid token format',
				};
			}

			if (!tokenData.userId || !tokenData.roomId || !tokenData.signature) {
				return {
					valid: false,
					error: 'Token missing required fields',
				};
			}

			if (tokenData.userId !== userId) {
				return {
					valid: false,
					error: `User ID mismatch: token for ${tokenData.userId}, request for ${userId}`,
				};
			}

			if (tokenData.roomId !== roomId) {
				return {
					valid: false,
					error: `Room mismatch: token for ${tokenData.roomId}, request for ${roomId}`,
				};
			}

			const now = Date.now();
			if (now > tokenData.expiresAt) {
				if (supabaseDB.isReady()) {
					await supabaseDB.invalidateToken(token);
				}

				return {
					valid: false,
					error: `Token expired at ${new Date(tokenData.expiresAt).toISOString()}`,
				};
			}

			const expectedSignature = this.createSignature(userId, roomId);
			if (tokenData.signature !== expectedSignature) {
				logger.warn('[TokenManager] Token signature mismatch for user:', userId);
				return {
					valid: false,
					error: 'Token signature verification failed',
				};
			}

			if (supabaseDB.isReady()) {
				const isValid = await supabaseDB.validateToken(token, userId, roomId);
				if (!isValid) {
					logger.warn('[TokenManager] Token not found or marked invalid in database:', userId);
					return {
						valid: false,
						error: 'Token not found in database or has been revoked',
					};
				}
			}

			const result: ValidationResult = {
				valid: true,
				userId,
				roomId,
				tokenMetadata: {
					tokenId: this.hashToken(token),
					userId,
					roomId,
					token: token.substring(0, 20) + '...',
					issuedAt: tokenData.issuedAt,
					expiresAt: tokenData.expiresAt,
					signature: tokenData.signature.substring(0, 20) + '...',
					isValid: true,
					lastValidated: now,
				},
			};

			this.validationCache.set(cacheKey, {
				result,
				timestamp: now,
			});

			logger.debug(`[TokenManager] Token validated for ${userId} in ${roomId}`);
			return result;
		} catch (error) {
			logger.error('[TokenManager] Error validating token:', error);
			return {
				valid: false,
				error: 'Token validation error',
			};
		}
	}

	public async revokeToken(token: string, userId?: string): Promise<boolean> {
		try {
			if (supabaseDB.isReady()) {
				await supabaseDB.invalidateToken(token);
				logger.info(`[TokenManager] Token revoked for user ${userId || 'unknown'}`);
				return true;
			} else {
				logger.warn('[TokenManager] Cannot revoke token - database unavailable');
				return false;
			}
		} catch (error) {
			logger.error('[TokenManager] Error revoking token:', error);
			return false;
		}
	}

	public async getTokenStats() {
		return {
			totalTokens: this.tokenGenerationCount,
			validTokens: this.validationCache.size,
			expiredTokens: 0,
			revokedTokens: 0,
		};
	}

	public clearValidationCache(userId?: string): void {
		if (userId) {
			const keysToDelete: string[] = [];
			for (const [key] of this.validationCache) {
				if (key.includes(userId)) {
					keysToDelete.push(key);
				}
			}
			keysToDelete.forEach(key => this.validationCache.delete(key));
			logger.debug(`[TokenManager] Cleared cache for user ${userId}`);
		} else {
			this.validationCache.clear();
			logger.debug('[TokenManager] Cleared all validation cache');
		}
	}

	private startCleanup(): void {
		this.cleanupInterval = setInterval(async () => {
			await this.cleanupExpiredTokens();
		}, this.CLEANUP_INTERVAL);

		logger.info('[TokenManager] Cleanup service started (interval: 5 minutes)');
	}

	private async cleanupExpiredTokens(): Promise<void> {
		try {
			if (!supabaseDB.isReady()) {
				logger.debug('[TokenManager] Skipping cleanup - database unavailable');
				return;
			}

			const deleted = await supabaseDB.cleanupExpiredTokens();
			if (deleted > 0) {
				logger.info(`[TokenManager] Cleaned up ${deleted} expired tokens`);
			}

			const now = Date.now();
			const keysToDelete: string[] = [];

			for (const [key, value] of this.validationCache) {
				if (now - value.timestamp > this.VALIDATION_CACHE_TTL * 2) {
					keysToDelete.push(key);
				}
			}

			if (keysToDelete.length > 0) {
				keysToDelete.forEach(key => this.validationCache.delete(key));
				logger.debug(`[TokenManager] Cleared ${keysToDelete.length} stale cache entries`);
			}
		} catch (error) {
			logger.error('[TokenManager] Error during cleanup:', error);
		}
	}

	public shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.validationCache.clear();
		logger.info('[TokenManager] Shutdown complete');
	}

	private createSignature(userId: string, roomId: string): string {
		const data = `${userId}:${roomId}:${this.SECRET}`;
		return crypto.createHmac('sha256', this.SECRET).update(data).digest('hex');
	}

	private hashToken(token: string): string {
		return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
	}

	public getStatus(): {
		isRunning: boolean;
		cacheSize: number;
		tokensGenerated: number;
		validationsPerformed: number;
		cleanupInterval: number;
		databaseReady: boolean;
	} {
		return {
			isRunning: this.cleanupInterval !== null,
			cacheSize: this.validationCache.size,
			tokensGenerated: this.tokenGenerationCount,
			validationsPerformed: this.tokenValidationCount,
			cleanupInterval: this.CLEANUP_INTERVAL / 1000,
			databaseReady: supabaseDB.isReady(),
		};
	}
}

export const tokenManager = new TokenManager();
