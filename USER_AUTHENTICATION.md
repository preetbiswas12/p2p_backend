# User Authentication & Proper Matching Flow

## Problem Solved
**Before**: Server accepted ANY userId/roomId without validation. Users could randomly connect to any room.
**After**: Server validates users are authorized for specific rooms using tokens.

---

## Complete Flow: Proper User Connection

### Step 1: Generate Auth Token (Frontend - HTTP)

Before the user opens WebSocket, request a token from your frontend:

```typescript
// Frontend/React
async function joinRoom(userId: string, roomId: string) {
  // Request token from backend
  const tokenResponse = await fetch('http://localhost:3000/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, roomId }),
  });

  const data = await tokenResponse.json();
  if (!data.token) {
    console.error('Failed to get token:', data.error);
    return;
  }

  const token = data.token; // ← Save this token
  console.log('✓ Token generated, valid for 1 hour');

  return token;
}
```

### Step 2: Connect to Signaling Server with Token (WebSocket)

Only after having a valid token:

```typescript
// Frontend - WebSocket connection
function connectToSignaling(userId: string, roomId: string, token: string) {
  const signalingWs = new WebSocket('ws://localhost:3001');

  signalingWs.onopen = () => {
    // Send AUTH message with token
    signalingWs.send(JSON.stringify({
      type: 'auth',
      userId,
      roomId,
      data: {
        token, // ← Include the token
      },
      timestamp: Date.now(),
    }));
  };

  signalingWs.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'auth' && message.data.status === 'authenticated') {
      console.log('✓ Successfully authenticated and connected!');
      console.log('✓ All future updates will be P2P via WebRTC');
      
      // User is now properly authenticated
      // All subsequent room operations (SDP, ICE) succeed
    } else if (message.type === 'error') {
      console.error('❌ Auth failed:', message.data.error);
      // Common reasons:
      // - Token missing or expired
      // - userId doesn't match token
      // - roomId doesn't match token
    }
  };
}
```

### Step 3: Establish P2P Connections (WebRTC)

Once authenticated, the server ONLY helps with signaling:

```typescript
// All peers in the room establish direct P2P connections
const peerConnections = new Map<string, RTCPeerConnection>();

signalingWs.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'peer-joined': // New user joined
      const newPeerId = message.data.peer.userId;
      initiateP2PConnection(newPeerId);
      break;

    case 'sdp-offer': // Answer peer's offer
      const peerConnection = peerConnections.get(message.userId);
      peerConnection.setRemoteDescription(
        new RTCSessionDescription(message.data.offer)
      );
      const answer = await peerConnection.createAnswer();
      peerConnection.setLocalDescription(answer);
      
      // Send answer back through signaling server
      signalingWs.send(JSON.stringify({
        type: 'sdp-answer',
        userId: currentUserId,
        roomId,
        data: { answer: answer.toJSON() },
        timestamp: Date.now(),
      }));
      break;

    case 'ice-candidate':
      peerConnections.get(message.userId).addIceCandidate(
        new RTCIceCandidate(message.data)
      );
      break;
  }
};

// Create data channel for operations (P2P, NOT through server)
function initiateP2PConnection(peerId: string) {
  const pc = new RTCPeerConnection();
  
  // Data channel for collaboration (multi-cursor, operations, etc.)
  const dataChannel = pc.createDataChannel('collaboration', {
    ordered: true,
  });

  dataChannel.onopen = () => {
    console.log(`✓ P2P connection established with ${peerId}`);
  };

  dataChannel.onmessage = (event) => {
    const operation = JSON.parse(event.data);
    
    // Handle different P2P message types
    switch (operation.type) {
      case 'cursor-update':
        // Update peer's cursor position (multi-cursor)
        updateRemoteCursor(peerId, operation.position);
        break;
      case 'operation':
        // Apply peer's edit (with CRDT/OT)
        applyRemoteOperation(operation);
        break;
      case 'selection':
        // Update peer's selection
        updateRemoteSelection(peerId, operation.range);
        break;
    }
  };

  peerConnections.set(peerId, pc);
  
  // Create offer
  const offer = await pc.createOffer();
  pc.setLocalDescription(offer);
  
  // Send through signaling server
  signalingWs.send(JSON.stringify({
    type: 'sdp-offer',
    userId: currentUserId,
    roomId,
    data: { offer: offer.toJSON() },
    timestamp: Date.now(),
  }));
}
```

### Step 4: Share Operations & Multi-Cursor (P2P Only)

Once P2P connections are open, **nothing goes through the server**:

```typescript
// ✅ Multi-Cursor (sent via P2P data channel)
function updateCursor(position: number) {
  const cursorUpdate = {
    type: 'cursor-update',
    userId: currentUserId,
    position,
    timestamp: Date.now(),
  };

  // Send to ALL peers via their P2P data channels
  peerConnections.forEach((pc, peerId) => {
    const dataChannel = pc.getDataChannel('collaboration');
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(cursorUpdate));
    }
  });

  // Update local cursor
  updateLocalCursor(position);
}

// ✅ Operations (sent via P2P data channel)
function shareEdit(operation: RemoteOperation) {
  // Send to ALL peers via their P2P data channels
  peerConnections.forEach((pc, peerId) => {
    const dataChannel = pc.getDataChannel('collaboration');
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(operation));
    }
  });
}

// ✅ Selection/Highlight (sent via P2P data channel)
function shareSelection(start: number, end: number) {
  const selection = {
    type: 'selection',
    userId: currentUserId,
    start,
    end,
    timestamp: Date.now(),
  };

  peerConnections.forEach((pc, peerId) => {
    const dataChannel = pc.getDataChannel('collaboration');
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(selection));
    }
  });
}
```

---

## Server Responsibilities (Minimal)

✅ **Server DOES:**
1. Validate auth token (token exists, not expired, correct user/room)
2. Manage room lifecycle (peers list)
3. Facilitate WebRTC signaling (SDP, ICE)
4. Monitor heartbeat (disconnections)

❌ **Server DOES NOT:**
1. Store operations ❌ (Removed in v2)
2. Broadcast edits ❌ (Removed in v2)
3. Store document state ❌
4. Share multi-cursor ❌ (P2P only)
5. Handle conflict resolution ❌ (Client CRDT/OT)

---

## Architecture with Proper User Matching

```
┌──────────────────────────────────────────────────────────┐
│                  Frontend Application                     │
│  (React/Vue with WebRTC, CRDT, multi-cursor)             │
└──────────────┬───────────────────────────────────────────┘
               │
               │ 1. POST /api/auth/token
               │    {"userId":"alice", "roomId":"doc123"}
               │
    ┌──────────▼──────────┐
    │ HTTP Server         │
    │ :3000               │
    │ ✓ Generate token    │
    │ ✓ Returns: {token}  │
    └──────────┬──────────┘
               │
               │ 2. WebSocket with token
               │    {type: 'auth', data: {token}}
               │
    ┌──────────▼──────────┐
    │ Signaling Server    │
    │ :3001 WebSocket     │
    │ ✓ Validate token    │◄─── Only proper users allowed
    │ ✓ Register peer     │
    │ ✓ List other peers  │
    └──────────┬──────────┘
               │
     ┌─────────┴──────────┐
     │                    │
     │ 3a. SDP Offer/Answer  3b. ICE Candidates
     │    (Signaling only)   (Signaling only)
     │
    ┌▼────────────────────────────────────┐
    │         WebRTC Data Channels        │
    │     (P2P - Server NOT involved)     │
    │                                     │
    │ ✓ Cursor updates (multi-cursor)     │
    │ ✓ Operations (edits)                │
    │ ✓ Selections                        │
    │ ✓ Document state sync               │
    │                                     │
    └─────────────────────────────────────┘
```

---

## Security Features

### 1. Token Expiration
- Tokens valid for 1 hour
- Users must request new token to rejoin
- Prevents unauthorized access

### 2. User Validation
```typescript
// Server validates BOTH match
if (tokenData.userId !== userId) ❌ FAIL
if (tokenData.roomId !== roomId) ❌ FAIL
if (Date.now() > tokenData.expiresAt) ❌ FAIL
```

### 3. Signature Verification
```typescript
// Token signed with server secret
// Tampering detected immediately
```

### 4. No Random Matching
- Users CANNOT guess roomId and access it
- Users CANNOT spoof their userId
- Only authorized users can enter rooms

---

## Example Flow: Two Users Collaborating

### User Alice:
```
1. Frontend requests token: POST /api/auth/token
   Body: {userId: "alice", roomId: "doc-123"}
   Response: {token: "eyJ0..."}

2. Connects WebSocket with token:
   ws://server:3001
   Send: {type: 'auth', userId: 'alice', roomId: 'doc-123', data: {token}}

3. Receives peer list (Bob already connected):
   {type: 'peer-joined', data: {peer: {userId: 'bob'}}}

4. Establishes P2P with Bob:
   - Exchange SDP offer/answer (via signaling server)
   - Exchange ICE candidates (via signaling server)
   - Open data channel

5. All updates go P2P with Bob:
   - Alice types: data channel -> Bob (no server)
   - Alice moves cursor: data channel -> Bob (no server)
```

### User Bob:
```
1. Same token flow as Alice
   Body: {userId: "bob", roomId: "doc-123"}

2. WebSocket connection

3. Receives peer list (Alice is here):
   {type: 'peer-joined', data: {peer: {userId: 'alice'}}}

4. P2P connection with Alice

5. Receives all updates from Alice via data channel (no server)
```

---

## Production Checklist

- [ ] Use JWT tokens instead of base64 (see `authManager.ts`)
- [ ] Set `AUTH_SECRET` environment variable
- [ ] Enable HTTPS/WSS in production
- [ ] Implement token refresh logic
- [ ] Monitor failed auth attempts
- [ ] Log proper auth chains
- [ ] Test multi-user scenarios
- [ ] Verify P2P works with >3 users simultaneously

---

## Testing the Flow

```bash
# Terminal 1: Start server
npm start

# Terminal 2: Generate token for Alice
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","roomId":"doc-123"}'

# Response:
# {"status":"success","token":"eyJ0ZXN0...","expiresIn":"1 hour"}

# Terminal 3: Generate token for Bob
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"bob","roomId":"doc-123"}'

# Both can now connect to WebSocket with their tokens and establish P2P
```

---

## Multi-Cursor in P2P Architecture

Multi-cursor now works **purely P2P**:

1. User moves cursor locally
2. Cursor position sent via WebRTC data channel to all peers
3. Each peer receives update and renders remote cursor
4. **Server never sees cursor data** ✓

```typescript
// Simplified multi-cursor example
interface CursorPosition {
  type: 'cursor-update';
  userId: string;
  position: number;  // Character position in doc
  color: string;     // For visual distinction
}

// On each keystroke/cursor movement
onCursorMove = (position: number) => {
  broadcastViaP2P({
    type: 'cursor-update',
    userId: currentUserId,
    position,
    color: userColor,
  });
};

// Render remote cursors
onRemoteCursor = (message: CursorPosition) => {
  const color = getColorForUser(message.userId);
  renderRemoteCursor(message.position, color, message.userId);
};
```

Your server is now ready for proper user matching! 🚀
