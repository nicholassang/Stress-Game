const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { nanoid } = require("nanoid");

const app = express();

// Serve static in production (after `vite build`)
app.use(express.static("../client/vite-project/dist")); 

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// --- Matchmaking ---
const waitingPlayers = [];
const rooms = new Map();

// Broadcast to all in a room
function broadcastRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach((player) => {
    if (player.readyState === WebSocket.OPEN) {
      player.send(JSON.stringify(message));
    }
  });
}

// Upgrade HTTP to WS
server.on("upgrade", (request, socket, head) => {
  if (request.url === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSocket connection
wss.on("connection", (ws) => {
  ws.id = nanoid();
  ws.roomId = null;
  console.log(`Player connected: ${ws.id}`);

  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {
      case "FIND_MATCH":
        if (waitingPlayers.length > 0) {
          const opponent = waitingPlayers.shift();
          const roomId = nanoid();
          rooms.set(roomId, { players: [ws, opponent] });
          ws.roomId = roomId;
          opponent.roomId = roomId;

          broadcastRoom(roomId, {
            type: "MATCH_FOUND",
            roomId,
            players: [ws.id, opponent.id]
          });
        } else {
          waitingPlayers.push(ws);
        }
        break;

      case "MOUSE_MOVE":
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        room.players.forEach((player) => {
          if (player !== ws && player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify({
              type: "MOUSE_UPDATE",
              playerId: ws.id,
              x: data.x,
              y: data.y
            }));
          }
        });
        break;

      default:
        console.log("Unknown type:", data.type);
    }
  });

  ws.on("close", () => {
    console.log(`Player disconnected: ${ws.id}`);
    // Remove from waiting queue
    const idx = waitingPlayers.indexOf(ws);
    if (idx !== -1) waitingPlayers.splice(idx, 1);

    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      const opponent = room.players.find(p => p !== ws);
      if (opponent && opponent.readyState === WebSocket.OPEN) {
        opponent.send(JSON.stringify({ type: "OPPONENT_DISCONNECTED" }));
        opponent.roomId = null;
      }
      rooms.delete(ws.roomId);
    }
  });
});

server.listen(8080, () => {
  console.log("Backend + WS server running on http://localhost:8080");
});