// App.tsx
import { useState, useEffect, useRef } from "react";

type CardLabel = string;
type CardStackType = CardLabel[];

interface PlayerState {
  deck: string[];
  hand: [CardStackType, CardStackType, CardStackType, CardStackType];
}

interface CardStackProps {
  stack: string[];
  stackIndex: number;
  draggable?: boolean;
  onDragStart?: (stackIndex: number) => void;
  onDrop?: (stackIndex: number) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
}

interface HandRowProps {
  hand: PlayerState["hand"];
  top: string;
  isPlayer: boolean;
}

interface CursorPosition {
  x: number;
  y: number;
}

interface Opponents {
  [id: string]: CursorPosition;
}

interface Pile {
  cards: string[];
  autoRefilled: boolean;
}

interface DeckPileProps {
  count: number;      
  label?: string;   
  mirrored?: boolean;
  showCount?: boolean; 
}

interface GameState {
  [playerId: string]: PlayerState | { pile1: Pile; pile2: Pile };
  center: {
    pile1: Pile;
    pile2: Pile;
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
  const [draggedStackIndex, setDraggedStackIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draggingCard, setDraggingCard] = useState<{
    label: string;
    originStack: number;
  } | null>(null);
  const [floatingCardPos, setFloatingCardPos] = useState<{ x: number; y: number } | null>(null);
  const floatingCardRef = useRef<HTMLDivElement | null>(null);
  const [roomIdInput, setRoomIdInput] = useState("");
  const [hostJoinGameDisabled, setHostJoinGameDisabled] = useState<boolean>(false);

  // When the game starts, clear message baord
  useEffect(() => {
    if (gameState) {
      setMessage(null);
    }
  }, [gameState]);

  // Connect WS and matchmaking
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    wsRef.current = ws;

    // Connection Begin
    ws.onopen = () => {
      console.log("Connected to server");
    };

    // From Server
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "ROOM_HOSTED":
          console.log("Room hosted! ID:", data.roomId);
          setMessage(`Room ID: ${data.roomId}. Waiting for opponent...`);
          break;

        case "ERROR":
          setMessage(data.message);
          break;

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
          setMessage("");
          setGameState(data.state);
          setShowStressBtn(!!data.stressAvailable);
          break;

        case "COUNTDOWN":
          setMessage(data.message);
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

    window.addEventListener("mousemove", (e) => {
      if (floatingCardRef.current) {
        floatingCardRef.current.style.left = `${e.clientX}px`;
        floatingCardRef.current.style.top = `${e.clientY}px`;
      }
      setFloatingCardPos({ x: e.clientX, y: e.clientY }); // optional, keeps state in sync
    });
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  // requestAnimationFrame loop to render opponent cursors
  useEffect(() => {
    const animate = () => {
      const container = document.getElementById("cursor-container");
      if (container) {
        const height = window.innerHeight;
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

          // Inverse Opponent Cursor
          const mirroredX = pos.x;
          const mirroredY = height - pos.y;

          div.style.left = `${mirroredX}px`;
          div.style.top = `${mirroredY}px`;
        }
      }
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  // Card Moving Animation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (floatingCardRef.current) {
        floatingCardRef.current.style.left = `${e.clientX}px`;
        floatingCardRef.current.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // "On Mouse" listener
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!draggingCard || draggedStackIndex === null || !playerId) return;

      const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
      if (!dropTarget) return;

      // Check if dropped on central piles
      const leftPile = document.getElementById("pile-left");
      const rightPile = document.getElementById("pile-right");

      if (leftPile && leftPile.contains(dropTarget)) {
        handleDropOnPile("left");
      } else if (rightPile && rightPile.contains(dropTarget)) {
        handleDropOnPile("right");
      } else {
        // Check hand stacks
        const handStacks = Array.from(
          document.getElementsByClassName("hand-stack")
        ) as HTMLElement[];

        handStacks.forEach((stackEl, idx) => {
          if (stackEl.contains(dropTarget)) {
            handleDropOnHandStack(idx);
          }
        });
      }

      setDraggingCard(null);
      setDraggedStackIndex(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [draggingCard, draggedStackIndex]);

  const myHandStacks =
    playerId && gameState
      ? (gameState[playerId] as PlayerState).hand
      : null;

  const opponentHandStacks =
    playerId && gameState
      ? Object.keys(gameState)
          .filter(id => id !== "center" && id !== playerId)
          .map(id => (gameState[id] as PlayerState).hand)[0]
      : null;

  console.log("My Hand: ", myHandStacks)
  console.log("Opponent: ", opponentHandStacks)
  console.log("Central Piles: ", gameState?.center)

  // Order Central Deck
  const viewPiles = gameState
    ? {
        left: gameState.center.pile1.cards,
        right: gameState.center.pile2.cards,
      }
    : {
        left: [],
        right: [],
      };

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
        background: "white",
        borderRadius: "20px",
        cursor: draggable ? "grab" : "default",
        userSelect: "none",
        color: "black"
      }}
    >
      {label}
    </div>
  );

  const DeckPile: React.FC<DeckPileProps> = ({ count, label, mirrored = false, showCount = true }) => {
    const maxVisible = 10; 
    const visibleCount = Math.min(count, maxVisible);

    return (
      <div style={{ position: "relative", width: "7em", height: "11em" }}>
        {[...Array(visibleCount)].map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: mirrored ? i * 2 : -i * 2,
              left: mirrored ? -i * 1.5 : i * 1.5,
              width: "7em",
              height: "9.8em",
              borderRadius: "20px",
              background: "gray",
              border: "1px solid black",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              color: "white",
              fontWeight: "bold",
              zIndex: i,
              userSelect: "none",
            }}
          >
            {i === 0 && label ? label : ""}
          </div>
        ))}
        {showCount && count > maxVisible && (
          <div
            style={{
              position: "absolute",
              bottom: "-1.5em",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.8em",
              fontWeight: "bold",
            }}
          >
            {count} cards
          </div>
        )}
      </div>
    );
  };

  const CardStack: React.FC<CardStackProps> = ({
    stack,
    stackIndex,
    draggable = false,
    onDragStart,
    onDrop,
    onMouseDown,
    className,
  }) => {
    return (
      <div
        draggable={draggable}
        onDragStart={() => onDragStart?.(stackIndex)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop?.(stackIndex)}
        onMouseDown={onMouseDown} 
        className={className}     
        style={{
          position: "relative",
          width: "7em",
          height: "11em",
          cursor: draggable ? "grab" : "default",
        }}
      >
        {stack.map((card, index) => (
          <div
            key={`${card}-${index}`}
            style={{
              position: "absolute",
              top: -index * 3,
              left: index * 2,
              zIndex: index,
            }}
          >
            <Card label={card} />
          </div>
        ))}
      </div>
    );
  };


  const HandRow: React.FC<HandRowProps> = ({
    hand,
    top,
    isPlayer,
  }) => {
    return (
      <div
        style={{
          display: "flex",
          position: "absolute",
          top,
          left: "50%",
          transform: "translate(-50%, -50%)",
          gap: "5em",
        }}
      >
        {hand.map((stack, index) => (
          <CardStack
            key={index}
            stack={stack}
            stackIndex={index}
            draggable={false} 
            onDragStart={undefined}
            onMouseDown={(e) => {
              if (isPlayer && stack.length > 0) {
                setDraggedStackIndex(index);
                setDraggingCard({ label: stack[0], originStack: index });
                setFloatingCardPos({ x: e.clientX, y: e.clientY });
              }
            }}
            className="hand-stack"
          />
        ))}
      </div>
    );
  };

  const handleDropOnPile = (viewPile: "left" | "right") => {
    if (draggedStackIndex === null || !playerId) return;

    const pileName = viewPile === "left" ? "pile1" : "pile2";

    wsRef.current?.send(JSON.stringify({
      type: "PLAY_CARD",
      fromStack: draggedStackIndex,
      pile: pileName
    }));

    setDraggedStackIndex(null); 
  };

  const handleDropOnHandStack = (toStackIndex: number) => {
    if (draggedStackIndex === null || !playerId) return;
    if (draggedStackIndex === toStackIndex) return;

    wsRef.current?.send(JSON.stringify({
      type: "MERGE_HAND_STACK",
      fromStack: draggedStackIndex,
      toStack: toStackIndex
    }));

    setDraggedStackIndex(null);
  };

  // Player's Message Box
  const MessageBox = (
    <div
      id="message_box"
      style={{
        padding: "0.75rem 1.25rem",
        borderRadius: "8px",
        minWidth: "200px",
        textAlign: "center",
      }}
    >
      {message || ""}
    </div>
  );

  // Display Player's cards
  const myPlayer = playerId && gameState
    ? gameState[playerId] as PlayerState
    : null;

  // Display Player's cards
  const opponentPlayer =
    playerId && gameState
      ? Object.keys(gameState)
          .filter(id => id !== "center" && id !== playerId)
          .map(id => gameState[id] as PlayerState)[0]
      : null;

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

      {/* Lobby / Landing UI */}
      {!gameState && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            paddingTop: "10vh",
            zIndex: 200,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
              padding: "2rem 3rem",
              borderRadius: "12px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              minWidth: "320px",
            }}
          >
            <h1 style={{ marginBottom: "0.5rem" }}>Stress Game</h1>

            {/* Host Room */}
            <button
              style={{ 
                padding: "0.9rem 2rem", 
                fontSize: "1.1rem", 
                width: "100%",
              }}
              onClick={() => {
                setHostJoinGameDisabled(true)
                wsRef.current?.send(JSON.stringify({ type: "HOST_ROOM" }));
              }}
              disabled = {hostJoinGameDisabled}
            >
              Host Room
            </button>

            {/* Join Room */}
            <div style={{ display: "flex", gap: "0.5rem", width: "100%" }}>
              <input
                type="text"
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                placeholder="Room ID"
                style={{
                  flex: 1,
                  padding: "0.7rem",
                  fontSize: "1rem",
                }}
                disabled = {hostJoinGameDisabled}
              />
              <button
                style={{ padding: "0.7rem 1.2rem", fontSize: "1rem" }}
                onClick={() => {
                  setHostJoinGameDisabled(false)
                  wsRef.current?.send(
                    JSON.stringify({ type: "JOIN_ROOM", roomId: roomIdInput })
                  );
                }}
                disabled = {hostJoinGameDisabled}
              >
                Join
              </button>
            </div>

            {/* Divider */}
            <div
              style={{
                width: "100%",
                height: "1px",
                background: "#ddd",
                margin: "0.5rem 0",
              }}
            />

            {/* Find Match */}
            <button
              style={{
                padding: "0.9rem 2rem",
                fontSize: "1.1rem",
                width: "100%",
              }}
              onClick={() => {
                wsRef.current?.send(JSON.stringify({ type: "FIND_MATCH" }));
                setHostJoinGameDisabled(false)
                setFindMatchDisabled(true);
                setMessage("Finding a match...")
              }}
              disabled={findMatchDisabled}
            >
              Find Match
            </button>
            {message && (
              <div style={{ marginTop: "0.75rem", width: "100%" }}>
                {MessageBox}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Player's Message Box */}
      {gameState && (
        <div
          style={{
            position: "absolute",
            top: "67%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 100,
          }}
        >
          {MessageBox}
        </div>
      )}

      {/* Central Decks */}
      {gameState && (
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
          <div id="pile-left" onMouseOver={() => {}}>
            <Card label={viewPiles.left[0] ?? "Empty"} />
          </div>

          <div id="pile-right">
            <Card label={viewPiles.right[0] ?? "Empty"} />
          </div>
        </div>
      )}

      {/* Local Hand */}
      {myHandStacks && (
        <HandRow
          hand={myHandStacks}
          top="85%"
          isPlayer={true}
        />
      )}

      {/* Opponent Hand */}
      {opponentHandStacks && (
        <HandRow
          hand={opponentHandStacks}
          top="15%"
          isPlayer={false}
        />
      )}

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

      {/* Player's Deck */}
      <div 
        id="playerDeck"
        style={{
          position: "absolute",
          bottom: "20%",
          right: "9%",
          transform: "translate(50%, 50%)",
        }}
      >
        <DeckPile count={myPlayer?.deck.length ?? 0} showCount={true} />
      </div>

      {/* Opponent's Deck */}
      <div 
        id="opponentDeck"
        style={{
          position: "absolute",
          top: "20%",
          left: "9%",
          transform: "translate(-50%, -50%) rotate(180deg)",
        }}
      >
        <DeckPile count={opponentPlayer?.deck.length ?? 0} showCount={false} />
      </div>

      {/* Card Moving Animation */}
      {draggingCard && floatingCardPos && (
        <div
          ref={floatingCardRef}
          style={{
            position: "absolute",
            left: floatingCardPos.x,
            top: floatingCardPos.y,
            width: "7em",
            height: "9.8em",
            borderRadius: "20px",
            background: "white",
            border: "1px solid black",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            pointerEvents: "none",
            color: "black",
            transform: "translate(-50%, -50%)",
            zIndex: 1000,
          }}
        >
          {draggingCard.label}
        </div>
      )}

    </div>
  );
}

export default App;