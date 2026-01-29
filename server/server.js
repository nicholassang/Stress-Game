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

  ws.send(JSON.stringify({
    type: "ASSIGN_ID",
    playerId: ws.id
  }));

  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {
      case "FIND_MATCH":
        if (waitingPlayers.length > 0) {
          const opponent = waitingPlayers.shift();
          const roomId = nanoid();

          const deck = createDeck();

          const playerADeck = deck.slice(0, 26);
          const playerBDeck = deck.slice(26, 52);

          const room = {
            players: [ws, opponent],
            game_state: {
              [ws.id]: {
                deck: playerADeck,
                hand: []
              },
              [opponent.id]: {
                deck: playerBDeck,
                hand: []
              },
              center: {
                pile1: [],
                pile2: []
              }
            }
          };

          rooms.set(roomId, room);
          ws.roomId = roomId;
          opponent.roomId = roomId;

          broadcastRoom(roomId, {
            type: "MATCH_FOUND",
            roomId,
            players: [ws.id, opponent.id],
            state: room.game_state,
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

      case "PLAY_CARD": {
        const room = rooms.get(ws.roomId);
        if (!room) return;

        const player = room.game_state[ws.id];
        if (!player) return;

        const { card, pile } = data;

        // Remove card from player's deck (or hand later)
        player.deck = player.deck.filter((c) => c !== card);

        // Add card to center pile
        room.game_state.center[pile].unshift(card);

        // Broadcast updated state
        broadcastRoom(ws.roomId, {
          type: "GAME_UPDATE",
          state: room.game_state,
        });

        break;
      }
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
        opponent.send(JSON.stringify({ type: "OPPONENT_DISCONNECTED" , playerId: ws.id}));
        opponent.roomId = null;
      }
      rooms.delete(ws.roomId);
    }
  });
});

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const values = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck = [];

  for (const suit of suits) {
    for (const value of values) {
      deck.push(`${value}${suit}`);
    }
  }
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

server.listen(8080, () => {
  console.log("Backend + WS server running on http://localhost:8080");
});