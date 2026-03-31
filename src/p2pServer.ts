/**
 * P2P Server
 * Main orchestration - Express HTTP + WebSocket signaling
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { signalingServer } from './signalingServer.js';
import { roomManager } from './roomManager.js';
import { memoryManager } from './memoryManager.js';
import { setupRoutes } from './routes.js';

export class P2PServer {
	private app: Express;
	private httpPort: number;
	private signalingPort: number;
	private isRunning = false;
	private startTime = 0;

	constructor(httpPort = 3000, signalingPort = 3001) {
		this.httpPort = httpPort;
		this.signalingPort = signalingPort;
		this.app = this.setupExpress();
	}

	private setupExpress(): Express {
		const app = express();

		// Configure CORS from environment
		const corsOrigins = process.env.CORS_ORIGINS
			? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
			: ['http://localhost:3000', 'http://localhost:8080'];

		app.use(cors({
			origin: corsOrigins,
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization']
		}));

		// Middleware
		app.use(express.json({ limit: '10mb' }));
		app.use((req: Request, res: Response, next: any) => {
			console.log(`[HTTP] ${req.method} ${req.path}`);
			next();
		});

		// Routes
		const router = express.Router();
		setupRoutes(router);
		app.use('/api', router);

		// Root endpoint
		app.get('/', (req: Request, res: Response) => {
			res.json({
				name: 'OctateCode P2P Backend',
				status: 'running',
				version: '1.0.0',
				docs: '/api/info',
			});
		});

		// 404 handler
		app.use((req: Request, res: Response) => {
			res.status(404).json({
				error: 'Not found',
				path: req.path,
				timestamp: Date.now(),
			});
		});

		// Error handler
		app.use((err: Error, req: Request, res: Response) => {
			console.error('[ERROR]', err);
			res.status(500).json({
				error: 'Internal server error',
				message: err.message,
				timestamp: Date.now(),
			});
		});

		return app;
	}

	public async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.startTime = Date.now();

				// Start HTTP server
				this.app.listen(this.httpPort, () => {
					console.log(`[P2PServer] HTTP server listening on port ${this.httpPort}`);
				});

				// Start WebSocket signaling server
				signalingServer
					.start(this.signalingPort)
					.then(() => {
						console.log(
							`[P2PServer] WebSocket signaling on port ${this.signalingPort}`
						);
					})
					.catch((error) => {
						console.error('[P2PServer] Failed to start signaling server:', error);
						reject(error);
					});

				// Start memory manager
				memoryManager.start();

				// Setup graceful shutdown
				process.on('SIGTERM', () => this.stop());
				process.on('SIGINT', () => this.stop());

				this.isRunning = true;
				console.log('[P2PServer] Started successfully');
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}

	public async stop(): Promise<void> {
		try {
			this.isRunning = false;
			console.log('[P2PServer] Shutting down...');

			await signalingServer.stop();
			memoryManager.stop();
			roomManager.shutdown();

			console.log('[P2PServer] Stopped');
			process.exit(0);
		} catch (error) {
			console.error('[P2PServer] Error during shutdown:', error);
			process.exit(1);
		}
	}

	public getStatus(): Record<string, unknown> {
		const stats = roomManager.getStats();
		return {
			isRunning: this.isRunning,
			httpPort: this.httpPort,
			signalingPort: this.signalingPort,
			uptime: Date.now() - this.startTime,
			rooms: stats.activeRooms,
			connections: stats.totalConnections,
		};
	}
}

export default P2PServer;
