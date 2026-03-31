# Frontend Integration Guide

This document describes how to integrate the OctateCode P2P Backend into your frontend application.

## Backend Server Information

### HTTP API
- **Base URL:** `http://your-backend-domain:3000`
- **Health Check:** `GET /api/health`
- **List Rooms:** `GET /api/rooms`
- **Room Details:** `GET /api/rooms/:roomId`

### WebSocket Signaling
- **URL:** `ws://your-backend-domain:3001`
- **Protocol:** JSON messages over WebSocket
- **Purpose:** Real-time signaling for WebRTC, chat, and code synchronization

## Environment Configuration

Set these environment variables in your frontend:

```env
VITE_BACKEND_HTTP_URL=http://localhost:3000
VITE_BACKEND_WS_URL=ws://localhost:3001
```

For production:
```env
VITE_BACKEND_HTTP_URL=https://your-backend-domain.com
VITE_BACKEND_WS_URL=wss://your-backend-domain.com
```

Note: Use `wss://` (WebSocket Secure) for production HTTPS backends.

## Data Types

### SignalMessage (Frontend → Backend)

```typescript
interface SignalMessage {
  type: 'auth' | 'offer' | 'answer' | 'ice' | 'chat' | 'sync';
  roomId: string;
  from: string;        // Your peer ID (UUID)
  to?: string;         // Target peer ID (for direct signals)
  data?: any;          // Message payload
  timestamp?: number;  // Optional: current timestamp
}
```

### ServerMessage (Backend → Frontend)

```typescript
interface ServerMessage {
  type: 'peerList' | 'peerJoined' | 'peerLeft' | 'offer' | 'answer' | 'ice' | 'chat' | 'sync' | 'error';
  roomId?: string;
  peerId?: string;
  peerName?: string;
  peers?: PeerInfo[];
  data?: any;
  timestamp?: number;
}

interface PeerInfo {
  id: string;
  name: string;
  joinedAt?: number;
}
```

## Connection Flow

### 1. Initialize WebSocket Connection

```typescript
import { v4 as uuidv4 } from 'uuid';

const peerId = uuidv4();
const roomId = 'room-123';  // or get from URL/params
const backendWsUrl = import.meta.env.VITE_BACKEND_WS_URL;

const socket = new WebSocket(backendWsUrl);

socket.addEventListener('open', () => {
  console.log('Connected to backend');
  joinRoom();
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  handleServerMessage(message);
});

socket.addEventListener('close', () => {
  console.log('Disconnected from backend');
});

socket.addEventListener('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### 2. Send Auth Message to Join Room

```typescript
function joinRoom() {
  const authMessage = {
    type: 'auth',
    roomId: roomId,
    from: peerId,
    data: {
      name: 'Your User Name',
      roomName: 'Optional Room Display Name'
    }
  };

  socket.send(JSON.stringify(authMessage));
}
```

### 3. Handle Peer List Response

```typescript
function handleServerMessage(message) {
  const { type, roomId, peers, peerId, peerName, data } = message;

  switch (type) {
    case 'peerList':
      // You've joined the room, here are existing peers
      console.log('Connected peers:', peers);
      peers.forEach(peer => {
        initiatePeerConnection(peer);
      });
      break;

    case 'peerJoined':
      // A new peer has joined
      console.log(`${peerName} (${peerId}) joined`);
      initiatePeerConnection({ id: peerId, name: peerName });
      break;

    case 'peerLeft':
      // A peer has disconnected
      console.log(`${peerId} left the room`);
      closePeerConnection(peerId);
      break;

    case 'offer':
      // WebRTC offer from another peer
      handleWebRTCOffer(peerId, data);
      break;

    case 'answer':
      // WebRTC answer from another peer
      handleWebRTCAnswer(peerId, data);
      break;

    case 'ice':
      // ICE candidate from another peer
      handleICECandidate(peerId, data);
      break;

    case 'chat':
      // Chat message from another peer
      console.log(`${peerName}: ${data.message}`);
      break;

    case 'sync':
      // Code/document sync from another peer
      handleCodeSync(data);
      break;

    case 'error':
      console.error('Backend error:', data.error);
      break;
  }
}
```

## WebRTC Setup

### Establishing Peer Connection

```typescript
const peerConnections = new Map(); // Map<peerId, RTCPeerConnection>

async function initiatePeerConnection(peer) {
  if (peerConnections.has(peer.id)) {
    return; // Connection already exists
  }

  const peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] }
    ]
  });

  peerConnections.set(peer.id, peerConnection);

  // Add your local stream
  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  });

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle ICE candidates
  peerConnection.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ice',
        roomId: roomId,
        from: peerId,
        to: peer.id,
        data: event.candidate
      }));
    }
  });

  // Handle remote stream
  peerConnection.addEventListener('track', (event) => {
    console.log('Received remote track:', event.track.kind);
    displayRemoteStream(peer.id, event.streams[0]);
  });

  // Create and send offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: 'offer',
    roomId: roomId,
    from: peerId,
    to: peer.id,
    data: offer
  }));
}

async function handleWebRTCOffer(peerId, offer) {
  let peerConnection = peerConnections.get(peerId);

  if (!peerConnection) {
    peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] }
      ]
    });

    peerConnections.set(peerId, peerConnection);

    // Add your local stream
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        socket.send(JSON.stringify({
          type: 'ice',
          roomId: roomId,
          from: peerId,
          to: peerId,
          data: event.candidate
        }));
      }
    });

    // Handle remote stream
    peerConnection.addEventListener('track', (event) => {
      displayRemoteStream(peerId, event.streams[0]);
    });
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: 'answer',
    roomId: roomId,
    from: peerId,
    to: peerId,
    data: answer
  }));
}

async function handleWebRTCAnswer(peerId, answer) {
  const peerConnection = peerConnections.get(peerId);
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

async function handleICECandidate(peerId, candidate) {
  const peerConnection = peerConnections.get(peerId);
  if (peerConnection && candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }
}

function closePeerConnection(peerId) {
  const peerConnection = peerConnections.get(peerId);
  if (peerConnection) {
    peerConnection.close();
    peerConnections.delete(peerId);
  }
}

function displayRemoteStream(peerId, stream) {
  // Add remote video/audio to your UI
  const videoElement = document.getElementById(`video-${peerId}`);
  if (videoElement) {
    videoElement.srcObject = stream;
  }
}
```

## Sending Messages

### Send Chat Message

```typescript
function sendChat(message) {
  socket.send(JSON.stringify({
    type: 'chat',
    roomId: roomId,
    from: peerId,
    data: {
      message: message,
      timestamp: Date.now()
    }
  }));
}
```

### Send Code/Document Sync

```typescript
function sendCodeSync(changes) {
  socket.send(JSON.stringify({
    type: 'sync',
    roomId: roomId,
    from: peerId,
    data: {
      changes: changes,
      timestamp: Date.now()
    }
  }));
}
```

## Health Check

Before establishing connections, verify the backend is running:

```typescript
async function checkBackendHealth() {
  try {
    const response = await fetch(`${import.meta.env.VITE_BACKEND_HTTP_URL}/api/health`);
    const data = await response.json();
    console.log('Backend status:', data);
    return data.status === 'ok';
  } catch (error) {
    console.error('Backend health check failed:', error);
    return false;
  }
}
```

## Get Room Information

```typescript
async function getRoomInfo(roomId) {
  try {
    const response = await fetch(`${import.meta.env.VITE_BACKEND_HTTP_URL}/api/rooms/${roomId}`);
    const data = await response.json();
    console.log('Room info:', data);
    return data;
  } catch (error) {
    console.error('Failed to get room info:', error);
  }
}
```

## Error Handling

Always handle connection errors gracefully:

```typescript
function handleConnectionError(error) {
  console.error('Connection error:', error);
  
  // Attempt to reconnect after a delay
  setTimeout(() => {
    console.log('Attempting to reconnect...');
    const newSocket = new WebSocket(backendWsUrl);
    // Re-setup socket listeners
  }, 3000);
}
```

## Best Practices

1. **Unique Peer IDs:** Use UUID v4 for peer IDs
2. **Connection State:** Track connection state and prevent duplicate operations
3. **Memory Management:** Clean up peer connections when peers leave
4. **Error Handling:** Always handle network errors and timeouts
5. **CORS:** Backend has CORS enabled, no special headers needed
6. **Message Validation:** Validate message data before processing
7. **Local Stream:** Request media permissions before offering to connect
8. **Close Gracefully:** Close WebSocket and peer connections on unmount

## Troubleshooting

### WebSocket Connection Fails
- Check backend is running and accessible
- Verify firewall allows WebSocket traffic (port 3001)
- Use `wss://` for HTTPS/production backends
- Check browser console for CORS errors

### No Peers Appearing
- Verify `auth` message was sent
- Check room ID is correct
- Verify backend logs show peer connected

### No Audio/Video
- Ensure microphone/camera permissions granted
- Check local stream is being added to peer connection
- Verify `addTrack` is called before creating offer

### ICE Connectivity Issues
- Check STUN server is accessible
- Add TURN server for production:
  ```typescript
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    {
      urls: ['turn:your-turn-server.com'],
      username: 'user',
      credential: 'password'
    }
  ]
  ```

## Production Deployment

1. Update environment variables to use your backend domain
2. Use `wss://` for secure WebSocket connections
3. Configure TURN server for reliable peer connections across NATs
4. Implement proper error recovery and reconnection logic
5. Add logging/monitoring for debugging production issues
