// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { nanoid } = require("nanoid");

const app = express();

// Serve static in production
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

  ws.on("message", async (msg) => {
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

          const playerAHand = playerADeck.splice(0, 4);
          const playerBHand = playerBDeck.splice(0, 4);

          const room = {
            players: [ws, opponent],
            playerOrder: [ws.id, opponent.id],
            countdownActive: false,
            game_state: {
              [ws.id]: {
                deck: playerADeck,
                hand: [
                  [playerAHand[0]],
                  [playerAHand[1]],
                  [playerAHand[2]],
                  [playerAHand[3]],
                ],
              },
              [opponent.id]: {
                deck: playerBDeck,
                hand: [
                  [playerBHand[0]],
                  [playerBHand[1]],
                  [playerBHand[2]],
                  [playerBHand[3]],
                ],
              },
            center: {
              pile1: { cards: [], autoRefilled: false },
              pile2: { cards: [], autoRefilled: false },
              },
            }
          };

          rooms.set(roomId, room);
          ws.roomId = roomId;
          opponent.roomId = roomId;

          await ensurePlayableState(room, roomId);  

          broadcastRoom(roomId, {
            type: "MATCH_FOUND",
            roomId,
            players: room.playerOrder,
            state: room.game_state,
          });

          await ensurePlayableState(room, roomId);  
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

        const { fromStack, pile } = data;
        const stack = player.hand[fromStack];
        if (!stack || stack.length === 0) return;

        const card = stack[0]; 
        const topCard = room.game_state.center[pile].cards[0];

        if (topCard && !isPlayable(card, topCard)) {
          return;
        }

        stack.shift();

        if (stack.length === 0 && player.deck.length > 0) {
          stack.push(player.deck.shift());
        }

        room.game_state.center[pile].cards.unshift(card);

        broadcastRoom(ws.roomId, {
          type: "GAME_UPDATE",
          state: room.game_state,
          stressAvailable: computeStressAvailable(room.game_state),
        });

        await ensurePlayableState(room, ws.roomId);
        break;
      }
      case "MERGE_HAND_STACK": {
        const room = rooms.get(ws.roomId);
        if (!room) return;

        const { fromStack, toStack } = data;
        const player = room.game_state[ws.id];
        if (!player) return;

        if (fromStack === toStack) return;

        const from = player.hand[fromStack];
        const to = player.hand[toStack];

        if (!from.length || !to.length) return;

        const fromValue = from[0].slice(0, -1);
        const toValue = to[0].slice(0, -1);

        if (fromValue === toValue) {
          to.unshift(...from);
          from.length = 0;

          if (player.deck.length > 0) {
            from.push(player.deck.shift());
          }
        } 
        else {
          [player.hand[fromStack], player.hand[toStack]] =
            [player.hand[toStack], player.hand[fromStack]];
        }

        broadcastRoom(ws.roomId, {
          type: "GAME_UPDATE",
          state: room.game_state,
          stressAvailable: computeStressAvailable(room.game_state)
        });

        break;
      }
      case "STRESS": {
        console.log("STRESS");
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const game = room.game_state;
        const opponentId = Object.keys(game).find(
          (id) => id !== ws.id && id !== "center"
        );
        if (!opponentId) return;
        const opponent = game[opponentId];
        if (!opponent) return;
        // Collect all center cards
        const collectedCards = [
          ...game.center.pile1.cards,
          ...game.center.pile2.cards,
        ];
        if (collectedCards.length === 0) return;
        // Add to opponent's deck (bottom of deck)
        opponent.deck.push(...collectedCards);
        // Clear center piles
        game.center.pile1.cards.length = 0;
        game.center.pile2.cards.length = 0;

        const piles = ["pile1", "pile2"];
        const playerIds = Object.keys(game).filter(id => id !== "center");

        for (const pile of piles) {
          if (game.center[pile].length === 0) {
            for (const pid of playerIds) {
              const card = drawFromDeckOrHand(game[pid]);
              if (card) game.center[pile].cards.unshift(card);
            }
          }
        }

        await ensurePlayableState(room, ws.roomId);

        // Broadcast updated state
        broadcastRoom(ws.roomId, {
          type: "GAME_UPDATE",
          state: game,
          stressAvailable: computeStressAvailable(room.game_state)
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

// Convert card rank to number
function getRank(card) {
  if (!card) return null;
  const rank = card.slice(0, -1);
  switch(rank){
    case 'A': return 1;
    case 'J': return 11;
    case 'Q': return 12;
    case 'K': return 13;
    default: return parseInt(rank);
  }
}

// Check if a card can be played on top of another
function isPlayable(draggedCard, topCard) {
  if (!draggedCard || !topCard) return false;
  const d = getRank(draggedCard);
  const t = getRank(topCard);
  if (d == null || t == null) return false;
  return Math.abs(d - t) === 1 || (d === 1 && t === 13) || (d === 13 && t === 1);
}

// Ensure center piles always have playable cards
async function ensurePlayableState(room, roomId) {
  if (room.countdownActive) return;

  const game = room.game_state;
  const piles = ["pile1", "pile2"];
  const playerIds = Object.keys(game).filter(id => id !== "center");

  // Fill empty piles immediately with one card from each player's deck
  for (const pile of piles) {
    if (game.center[pile].cards.length === 0) {
      for (const pid of playerIds) {
        const card = drawFromDeckOrHand(game[pid]);
        if (card) game.center[pile].cards.unshift(card);
      }
      game.center[pile].autoRefilled = true;
    }
  }

  // Check if any pile is playable
  const anyPlayable = piles.some(pile => {
    const topCard = game.center[pile].cards[0];
    if (!topCard) return false;
    return playerIds.some(pid =>
      game[pid].hand.some(stack =>
        stack.length > 0 && isPlayable(stack[0], topCard)
      )
    );
  });

  // Check if Stress Button is available
  let stressAvailable = false;
  const pile1Top = game.center.pile1.cards[0];
  const pile2Top = game.center.pile2.cards[0];

  if (pile1Top && pile2Top) {
    stressAvailable = pile1Top.slice(0, -1) === pile2Top.slice(0, -1);
  }

  // Trigger countdown if no playable cards and stress not available
  if (!anyPlayable && !stressAvailable) {
    console.log("⏳ No playable cards on both piles — starting countdown");

    room.countdownActive = true;

    for (let i = 3; i > 0; i--) {
      broadcastCountdown(roomId, i);
      await new Promise(res => setTimeout(res, 1000));
    }

    // Refill piles with one card from each player
    for (let i = 0; i < piles.length; i++) {
      const pile = piles[i];
      const pid = playerIds[i];
      if (pid) {
        const card = drawFromDeckOrHand(game[pid]);
        if (card) game.center[pile].cards.unshift(card);
      }
      game.center[pile].autoRefilled = true;
    }

    const pile1Top = game.center.pile1.cards[0];
    const pile2Top = game.center.pile2.cards[0];

    broadcastRoom(roomId, { 
      type: "GAME_UPDATE", 
      state: game,
      stressAvailable: computeStressAvailable(game) 
    });
    room.countdownActive = false;

    for (const pile of piles) {
      game.center[pile].autoRefilled = false;
    }

    // Edge Case: refilled decks still have no playable cards 
    await ensurePlayableState(room, roomId);  
  }
}

function broadcastCountdown(roomId, seconds) {
  broadcastRoom(roomId, {
    type: "COUNTDOWN",
    seconds,
    message: `Refilling pile in ${seconds}...`
  });
}

function computeStressAvailable(game) {
  const pile1 = game.center.pile1;
  const pile2 = game.center.pile2;

  if (pile1.autoRefilled || pile2.autoRefilled) return false; 

  const pile1Top = pile1.cards[0];
  const pile2Top = pile2.cards[0];

  if (!pile1Top || !pile2Top) return false;

  return pile1Top.slice(0, -1) === pile2Top.slice(0, -1);
}

function drawFromDeckOrHand(player) {
  if (player.deck.length > 0) {
    return player.deck.shift();
  }

  const nonEmptyStacks = player.hand.filter(stack => stack.length > 0);
  if (nonEmptyStacks.length === 0) return null;

  const stack =
    nonEmptyStacks[Math.floor(Math.random() * nonEmptyStacks.length)];

  return stack.shift();
}

server.listen(8080, () => {
  console.log("Backend + WS server running on http://localhost:8080");
});