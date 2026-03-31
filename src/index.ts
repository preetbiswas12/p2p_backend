/**
 * Index / Entry Point
 * Starts the P2P server with configuration from environment
 */

import dotenv from 'dotenv';
import P2PServer from './p2pServer.js';

// Load environment variables
dotenv.config();

async function main(): Promise<void> {
	const httpPort = parseInt(process.env.PORT || '3000', 10);
	const signalingPort = parseInt(process.env.SIGNALING_PORT || '3001', 10);

	console.log('==================================================');
	console.log('   OctateCode P2P Collaboration Server');
	console.log('==================================================');
	console.log(`[Boot] Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log(`[Boot] HTTP Port: ${httpPort}`);
	console.log(`[Boot] WebSocket Port: ${signalingPort}`);
	console.log('');

	const server = new P2PServer(httpPort, signalingPort);

	try {
		await server.start();
		console.log('');
		console.log('✅ Server ready for connections');
		console.log(`   HTTP: http://localhost:${httpPort}`);
		console.log(`   WebSocket: ws://localhost:${signalingPort}`);
		console.log(`   Health: http://localhost:${httpPort}/api/health`);
		console.log('');
	} catch (error) {
		console.error('❌ Failed to start server:', error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
