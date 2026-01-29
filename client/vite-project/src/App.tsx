// App.tsx
import { useState, useEffect, useRef } from "react";

interface CursorPosition {
  x: number;
  y: number;
}

interface Opponents {
  [id: string]: CursorPosition;
}

interface PlayerState {
  deck: string[];
  hand: string[];
}

interface GameState {
  // index signature: player IDs map to PlayerState
  [playerId: string]: PlayerState | { pile1: string[]; pile2: string[] };
  center: {
    pile1: string[];
    pile2: string[];
  };
}

interface CardProps {
  label: string;
  draggable?: boolean;
  onDragStart?: () => void;
}

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const localCursorRef = useRef<HTMLDivElement | null>(null);
  const opponentsRef = useRef<Opponents>({}); // store latest positions
  const opponentDivsRef = useRef<Record<string, HTMLDivElement>>({}); // visual div (red)
  const lastSentRef = useRef<number>(0);
  const [findMatchDisabled, setFindMatchDisabled] = useState(false);
  const [showStressBtn, setShowStressBtn] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [draggedCard, setDraggedCard] = useState<string | null>(null);


  // Connect WS and matchmaking
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    wsRef.current = ws;

    // Connection Begin
    ws.onopen = () => {
      console.log("✅ Connected to server");
    };

    // From Server
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "MATCH_FOUND":
          console.log("Match found!", data.players);
          console.log("Room State", data.state);
          setGameState(data.state);
          setFindMatchDisabled(true);
          break;

        case "MOUSE_UPDATE":
          opponentsRef.current[data.playerId] = { x: data.x, y: data.y };
          break;

        case "OPPONENT_DISCONNECTED":
          console.log("OPPONENT DISCONNECTED")
          setFindMatchDisabled(false);
          const div = opponentDivsRef.current[data.playerId];
          if (div && div.parentNode) div.parentNode.removeChild(div);
          delete opponentsRef.current[data.playerId];
          delete opponentDivsRef.current[data.playerId];
          break;

        case "ASSIGN_ID":
          console.log("ASSIGN_ID")
          playerIdRef.current = data.playerId
          setPlayerId(data.playerId);
          console.log(playerIdRef)
          break;

        case "GAME_UPDATE":
          console.log("GAME_UPDATE")
          console.log("Updated Game_State: ", data.state)
          setGameState(data.state);
          break;

        default:
          break;
      }
    };

    return () => ws.close();
  }, []);

  // Track local mouse
  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      // Update local cursor instantly
      if (localCursorRef.current) {
        localCursorRef.current.style.left = `${e.clientX}px`;
        localCursorRef.current.style.top = `${e.clientY}px`;
      }

      // Throttle WS messages (~20Hz)
      const now = Date.now();
      if (now - lastSentRef.current > 50) {
        lastSentRef.current = now;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ type: "MOUSE_MOVE", x: e.clientX, y: e.clientY })
          );
        }
      }
    };

    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  // requestAnimationFrame loop to render opponent cursors
  useEffect(() => {
    const animate = () => {
      const container = document.getElementById("cursor-container");
      if (container) {
        for (const [id, pos] of Object.entries(opponentsRef.current)) {
          let div = opponentDivsRef.current[id];
          if (!div) {
            // create div if it doesn't exist
            div = document.createElement("div");
            div.style.position = "absolute";
            div.style.width = "12px";
            div.style.height = "12px";
            div.style.borderRadius = "50%";
            div.style.background = "red";
            div.style.pointerEvents = "none";
            div.style.transform = "translate(-50%, -50%)";
            container.appendChild(div);
            opponentDivsRef.current[id] = div;
          }
          // update position
          div.style.left = `${pos.x}px`;
          div.style.top = `${pos.y}px`;
        }
      }
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  const myHand =
    playerId && gameState
      ? (gameState[playerId] as PlayerState).deck.slice(0, 4)
      : [];

  const opponentHand =
    playerId && gameState
      ? Object.keys(gameState)
          .filter((id) => id !== "center" && id !== playerId)
          .map((id) => (gameState[id] as PlayerState).deck.slice(0, 4))[0] ?? []
      : [];

  console.log("My Hand: ", myHand)
  console.log("Opponent: ", opponentHand)
  console.log("Central Piles: ", gameState?.center)

  // Update Stress Btn if central deck piles are similiar
  useEffect(() => {
    const pile1Top = gameState?.center?.pile1?.[0];
    const pile2Top = gameState?.center?.pile2?.[0];

    const shouldShow =
      !!pile1Top &&
      !!pile2Top &&
      pile1Top.slice(0, -1) === pile2Top.slice(0, -1);

    setShowStressBtn(shouldShow);
  }, [gameState]);


  const Card: React.FC<CardProps> = ({ 
    label,
    draggable,
    onDragStart
  }) => (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        border: "1px solid black",
        height: "9.8em",
        width: "7em",
        background: "pink",
        borderRadius: "20px",
        cursor: draggable ? "grab" : "default",
        userSelect: "none",
        color: "black"
      }}
    >
      {label}
    </div>
  );

  const renderRow = (
    items: string[], 
    top: string,
    draggable = false,
  ) => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        position: "absolute",
        top,
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "orange",
        gap: "5em",
      }}
    >
      {items.map((label, idx) => (
        <Card 
        key={idx} 
        label={label} 
        draggable={draggable}
        onDragStart={() => setDraggedCard(label)}
        />
      ))}
    </div>
  );

  const handleDropOnPile = (pile: "pile1" | "pile2") => {
  if (!draggedCard || !playerId || !gameState) return;

  const topCard = gameState.center[pile][0];

  // Allow drop if pile is empty
  if (!topCard) {
    sendPlay();
    return;
  }

  const draggedRank = parseInt(draggedCard.slice(0, -1));
  const topRank = parseInt(topCard.slice(0, -1));

  const isValid =
    draggedRank === topRank + 1 ||
    draggedRank === topRank - 1;

  if (!isValid) return;

  sendPlay();

  function sendPlay() {
    wsRef.current?.send(
      JSON.stringify({
        type: "PLAY_CARD",
        card: draggedCard,
        pile,
      })
    );
    setDraggedCard(null);
  }
  };

  return (
    <div
      id="cursor-container"
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <button
        id="find_match_btn"
        style={{
          position: 'absolute',
          top: "10%",
          left: "10%",
          zIndex: 100,
        }}
        onClick={() => {
          console.log("FIND_MATCH")
          wsRef.current?.send(JSON.stringify({ type: "FIND_MATCH" }));
          setFindMatchDisabled(true);
        }}
        disabled={findMatchDisabled}
      >
        Find Match
      </button>

      {/* Central Decks */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          gap: "5em",
        }}
      >
        {(["pile1", "pile2"] as const).map((pile) => {
          const label =
            gameState?.center[pile]?.[0] ?? "Empty";

          return (
            <div
              key={pile}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropOnPile(pile)}
            >
              <Card label={label} />
            </div>
          );
        })}
      </div>

      {/* Local Hand */}
      {renderRow(myHand, "85%", true)}

      {/* Opponent Hand */}
      {renderRow(opponentHand, "15%")}

      {/* Local cursor */}
      <div
        ref={localCursorRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "blue",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />

      {/* Stress Btn */}
      <button
        id="stress_btn"
        style={{
          position: 'absolute',
          top: "50%",
          left: "50%",
          zIndex: 100,
          transform: "translate(-50%, -50%)",
          visibility: showStressBtn ? "visible" : "hidden",
        }}
        onClick={() => {
          console.log("STRESS !")
          wsRef.current?.send(JSON.stringify({ type: "STRESS" }));
          setShowStressBtn(false);
        }}
      >
        STRESS !
      </button>
    </div>
  );
}

export default App;