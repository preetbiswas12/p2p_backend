/**
 * Lean Entry Point
 * Start P2P server with environment config
 */

import dotenv from 'dotenv';
import { P2PServer } from './lean.server.js';

dotenv.config();

async function main() {
	const httpPort = parseInt(process.env.PORT || '3000', 10);
	const wsPort = parseInt(process.env.SIGNALING_PORT || '3001', 10);

	console.log('');
	console.log('═══════════════════════════════════════════════');
	console.log('   🚀 OctateCode P2P Collaboration Server');
	console.log('═══════════════════════════════════════════════');
	console.log('');
	console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log(`   HTTP Port:   ${httpPort}`);
	console.log(`   WebSocket:   ${wsPort}`);
	console.log('');

	try {
		const server = new P2PServer(httpPort, wsPort);
		await server.start();

		console.log('✅ Ready for connections');
		console.log('');
		console.log(`   API Health:     http://localhost:${httpPort}/api/health`);
		console.log(`   List Rooms:     http://localhost:${httpPort}/api/rooms`);
		console.log(`   WebSocket:      ws://localhost:${wsPort}`);
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
