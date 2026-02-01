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
  draggableTop?: boolean;
  onDragTop?: (card: string) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}

interface HandRowProps {
  hand: PlayerState["hand"];
  top: string;
  isPlayer: boolean;
  onDragCard?: (card: string) => void;
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
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

    window.addEventListener("mousemove", handleMouse);
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

  // Update Stress Btn if central deck piles no. are similiar
  useEffect(() => {
    const pile1 = gameState?.center?.pile1;
    const pile2 = gameState?.center?.pile2;

    if (!pile1?.cards.length || !pile2?.cards.length) {
      setShowStressBtn(false);
      return;
    }

    const pile1Top = pile1.cards[0];
    const pile2Top = pile2.cards[0];

    const shouldShow =
      pile1Top.slice(0, -1) === pile2Top.slice(0, -1) &&
      !pile1.autoRefilled &&
      !pile2.autoRefilled;

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

  const CardStack: React.FC<CardStackProps> = ({
    stack,
    draggableTop = false,
    onDragTop,
    onDrop,
  }) => {
    return (
      <div
        style={{
          position: "relative",
          width: "7em",
          height: "11em",
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
      >
        {stack.map((card, index) => {
          const isTop = index === stack.length - 1;

          return (
            <div
              key={`${card}-${index}`}
              style={{
                position: "absolute",
                top: index * 5,  
                left: index * 5,  
                zIndex: index,
              }}
            >
              <Card
                label={card}
                draggable={isTop && draggableTop}
                onDragStart={
                  isTop && onDragTop
                    ? () => onDragTop(card)
                    : undefined
                }
              />
            </div>
          );
        })}
      </div>
    );
  };


  const HandRow: React.FC<HandRowProps> = ({
    hand,
    top,
    isPlayer,
    onDragCard,
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
            draggableTop={isPlayer}
            onDragTop={onDragCard}
            onDrop={() => handleDropOnHandStack(index)}
          />
        ))}
      </div>
    );
  };

  const handleDropOnPile = (viewPile: "left" | "right") => {
    if (!draggedCard || !playerId || !myPlayer) return;

    const pileName = viewPile === "left" ? "pile1" : "pile2";

    wsRef.current?.send(JSON.stringify({
      type: "PLAY_CARD",
      card: draggedCard,
      pile: pileName
    }));

    setDraggedCard(null); // clear local drag state
  };

  const handleDropOnHandStack = (targetStackIndex: number) => {
    if (!draggedCard || !playerId || !myPlayer) return;

    const hand = myPlayer.hand;
    const draggedStackIndex = hand.findIndex(stack => stack[0] === draggedCard);
    if (draggedStackIndex === -1 || draggedStackIndex === targetStackIndex) return;

    wsRef.current?.send(JSON.stringify({
      type: "MERGE_HAND_STACK",
      fromStack: draggedStackIndex,
      toStack: targetStackIndex
    }));

    setDraggedCard(null);
  };

  // Display Player's card count
  const myPlayer = playerId && gameState
    ? gameState[playerId] as PlayerState
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
        {(["left", "right"] as const).map((pile) => {
          const label = viewPiles[pile][0] ?? "Empty";

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
      {myHandStacks && (
        <HandRow
          hand={myHandStacks}
          top="85%"
          isPlayer={true}
          onDragCard={(card) => setDraggedCard(card)}
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

      {/* Player's Message Box */}
      <div 
        id="message_box"
        style={{
          position: "absolute",
          top: "67%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        {message || " "}
      </div>

      {/* Display Player's Own Card Count */}
      <div 
        id="cardcount"
        style={{
          position: "absolute",
          bottom: "1em",
          right: "1em",
          transform: "translate(-50%, -50%)",
        }}
      >
        Your Deck: {myPlayer?.deck.length ?? "N/A"}
      </div>
    </div>
  );
}

export default App;