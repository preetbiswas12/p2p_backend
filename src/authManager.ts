/**
 * Authentication Manager
 * Validates users and ensures they only join authorized rooms
 */

interface AuthToken {
	userId: string;
	roomId: string;
	issuedAt: number;
	expiresAt: number;
	signature: string;
}

interface UserCredential {
	userId: string;
	token: string;
	roomId: string;
}

class AuthManager {
	private validTokens = new Map<string, AuthToken>();
	private readonly TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
	private readonly SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production';

	/**
	 * Generate a token for a user to join a specific room
	 * This should be called by your frontend BEFORE the user tries to connect
	 */
	public generateToken(userId: string, roomId: string): string {
		const token = {
			userId,
			roomId,
			issuedAt: Date.now(),
			expiresAt: Date.now() + this.TOKEN_EXPIRY,
			signature: this.sign(userId, roomId),
		};

		const tokenStr = Buffer.from(JSON.stringify(token)).toString('base64');
		this.validTokens.set(tokenStr, token);

		console.log(`[AuthManager] Generated token for ${userId} in room ${roomId}`);
		return tokenStr;
	}

	/**
	 * Validate a user's credentials before allowing them to join
	 * Returns: { valid: boolean, userId: string, roomId: string, error?: string }
	 */
	public validateCredentials(userId: string, roomId: string, token: string): {
		valid: boolean;
		userId?: string;
		roomId?: string;
		error?: string;
	} {
		// Check if token exists and is valid
		const tokenData = this.validTokens.get(token);
		if (!tokenData) {
			return { valid: false, error: 'Invalid or expired token' };
		}

		// Check expiration
		if (Date.now() > tokenData.expiresAt) {
			this.validTokens.delete(token);
			return { valid: false, error: 'Token expired' };
		}

		// Check userId matches
		if (tokenData.userId !== userId) {
			return { valid: false, error: 'User ID mismatch' };
		}

		// Check roomId matches
		if (tokenData.roomId !== roomId) {
			return {
				valid: false,
				error: `Not authorized for this room. Token is for room ${tokenData.roomId}`,
			};
		}

		// Verify signature
		if (tokenData.signature !== this.sign(userId, roomId)) {
			return { valid: false, error: 'Invalid token signature' };
		}

		console.log(
			`[AuthManager] ✓ Validated ${userId} for room ${roomId}`
		);
		return { valid: true, userId, roomId };
	}

	/**
	 * Invalidate a token (logout)
	 */
	public invalidateToken(token: string): void {
		this.validTokens.delete(token);
	}

	/**
	 * Get list of users currently in a room
	 */
	public getRoomUsers(roomId: string): string[] {
		const users: string[] = [];
		for (const [, tokenData] of this.validTokens) {
			if (tokenData.roomId === roomId && Date.now() <= tokenData.expiresAt) {
				users.push(tokenData.userId);
			}
		}
		return users;
	}

	private sign(userId: string, roomId: string): string {
		// Simple signature (in production, use JWT or HMAC)
		const data = `${userId}:${roomId}:${this.SECRET}`;
		return Buffer.from(data).toString('base64');
	}
}

export const authManager = new AuthManager();
