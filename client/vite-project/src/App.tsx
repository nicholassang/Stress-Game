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

interface MatchRecord {
  matchId: string;          
  opponentId: string;        
  result: "win" | "lose" | "tie";
  timestamp: number;         
  allowRematch: boolean;    
}

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const localCursorRef = useRef<HTMLDivElement | null>(null);
  const opponentsRef = useRef<Opponents>({}); // store latest positions
  const opponentDivsRef = useRef<Record<string, HTMLDivElement>>({}); // visual div (red)
  const lastSentRef = useRef<number>(0);
  const [showStressBtn, setShowStressBtn] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const [playerId, setPlayerId] = useState<string>(() => {
    let pid = localStorage.getItem("playerId");
    if (!pid) {
      pid = crypto.randomUUID();
      localStorage.setItem("playerId", pid);
    }
    playerIdRef.current = pid;
    return pid;
  });
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
  const [lobbyMode, setLobbyMode] = useState<
    "idle" | "hosting" | "finding"
  >("idle");
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [rematchInvite, setRematchInvite] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);
  const [allowRematch, setAllowRematch] = useState(true);
  const [recentMatches, setRecentMatches] = useState<MatchRecord[]>([]);
  const opponentIdRef = useRef<string | null>(null);
  const cursorEnabledRef = useRef(true);

  // Call on game start / lobby load (from DB)
  useEffect(() => {
    if (playerId) fetchRecentMatches();
  }, [playerId]);

  // When the game starts, clear message baord
  useEffect(() => {
    if (gameState && !gameEnded) {
      setMessage("");
      setLobbyMode("idle");
      setHostJoinGameDisabled(false);
    }
  }, [gameState, gameEnded]);

  // Stop opponent's cursor after a match
  useEffect(() => {
    cursorEnabledRef.current = !gameEnded;

    if (gameEnded) {
      for (const div of Object.values(opponentDivsRef.current)) {
        if (div.parentNode) div.parentNode.removeChild(div);
      }
      opponentDivsRef.current = {};
      opponentsRef.current = {};
    }
  }, [gameEnded]);

  // Prevent zoom
  useEffect(() => {
    const preventZoom = (e: WheelEvent | KeyboardEvent) => {
      // Ctrl + wheel
      if ('ctrlKey' in e && e.ctrlKey) {
        e.preventDefault();
      }

      // Ctrl + +/- or Ctrl + 0
      if ('key' in e && e.ctrlKey) {
        const keys = ['+', '-', '=', '0'];
        if (keys.includes(e.key)) e.preventDefault();
      }
    };

    window.addEventListener('wheel', preventZoom as any, { passive: false });
    window.addEventListener('keydown', preventZoom as any, { passive: false });

    return () => {
      window.removeEventListener('wheel', preventZoom as any);
      window.removeEventListener('keydown', preventZoom as any);
    };
  }, [])

  // Connect WS and matchmaking
  useEffect(() => {
    const ws = new WebSocket("ws://https://www.stressgame.nicholassang.com/ws");
    wsRef.current = ws;

    // Connection Begin
    ws.onopen = () => {
      // console.log("Connected to server");
    };

    // From Server
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "ROOM_HOSTED":
          // console.log("Room hosted! ID:", data.roomId);
          setMessage(`Room ID: ${data.roomId}. Waiting for opponent...`);
          break;

        case "ERROR":
          setMessage(data.message);
          break;

        case "TIME_UPDATE":
          setRemainingTime(data.remainingTime);
          break;

        case "MATCH_FOUND":
          // console.log("Match found!", data.players);
          // console.log("Room State", data.state);
          setGameState(data.state);
          if (playerIdRef.current) {
            const opponentId = Object.keys(data.state).find(
              id => id !== "center" && id !== playerIdRef.current
            );
            opponentIdRef.current = opponentId ?? null;
          }
          break;

        case "MOUSE_UPDATE":
          if (!cursorEnabledRef.current) return;
          opponentsRef.current[data.playerId] = { x: data.x, y: data.y };
          break;

        case "OPPONENT_DISCONNECTED":
          // console.log("OPPONENT DISCONNECTED")
          const div = opponentDivsRef.current[data.playerId];
          if (div && div.parentNode) div.parentNode.removeChild(div);
          delete opponentsRef.current[data.playerId];
          delete opponentDivsRef.current[data.playerId];
          setAllowRematch(false);
          setRematchInvite(false);
          setRematchPending(false);
          break;

        case "ASSIGN_ID":
          // console.log("ASSIGN_ID")
          playerIdRef.current = data.playerId;
          setPlayerId(data.playerId);
          localStorage.setItem("playerId", data.playerId); 
          // console.log(playerIdRef)
          break;

        case "GAME_UPDATE":
          // console.log("GAME_UPDATE")
          // console.log("Updated Game_State: ", data.state)
          setMessage("");
          setGameState(data.state);
          setShowStressBtn(!!data.stressAvailable);
          if (!gameEnded) {
            setMessage("");
          }
          break;

        case "COUNTDOWN":
          setMessage(data.message);
          break;

        case "GAME_END":
          setGameEnded(true);

          opponentsRef.current = {};
          for (const div of Object.values(opponentDivsRef.current)) {
            div.remove();
          }
          opponentDivsRef.current = {};

          if (data.message) {
            setMessage(data.message);
          } else {
            const serverWinner: string | null = data.winner;
            const currentPlayerId = playerIdRef.current;
            if (serverWinner === null) {
              setMessage("It's a tie!");
            } else if (currentPlayerId && serverWinner === currentPlayerId) {
              setMessage("You won!");
            } else {
              setMessage("You lost!");
            }
          }
          setWinner(data.winner ?? null);
          setAllowRematch(data.allowRematch ?? true);

          if (data.allowRematch === false) {
            setRematchInvite(false);
            setRematchPending(false);
            setHostJoinGameDisabled(true);
          }

          const opponentId = opponentIdRef.current ?? "Unknown";

          // For recent matches
          setRecentMatches(prev => {
            const newMatch: MatchRecord = {
              matchId: data.matchId ?? `${Date.now()}`,
              opponentId,
              result:
                playerIdRef.current === data.winner
                  ? "win"
                  : data.winner === null
                  ? "tie"
                  : "lose",
              timestamp: Date.now(),
              allowRematch: data.allowRematch ?? true,
            };

            saveMatchToDB({
              ...newMatch,
              playerId,
            });

            return [newMatch, ...prev.slice(0, 3)];
          });
          break;

        case "REMATCH_INVITE":
          setRematchInvite(true);
          setMessage("Opponent wants a rematch");
          break;

        case "REMATCH_PENDING":
          setRematchPending(true);
          setMessage("Waiting for opponent...");
          break;

        case "REMATCH_START":
          setGameEnded(false);
          setWinner(null);
          setRematchInvite(false);
          setRematchPending(false);
          setRemainingTime(600000);
          setGameState(data.state);
          setMessage("");
          break;

        default:
          break;
      }
    };

    return () => ws.close();
  }, []);

  // Track local mouse
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Move local cursor
      if (localCursorRef.current) {
        localCursorRef.current.style.left = `${e.clientX}px`;
        localCursorRef.current.style.top = `${e.clientY}px`;
      }

      // Move floating card
      if (floatingCardRef.current) {
        floatingCardRef.current.style.left = `${e.clientX}px`;
        floatingCardRef.current.style.top = `${e.clientY}px`;
      }

      // Throttle WS messages (~20Hz)
      const now = Date.now();
      if (now - lastSentRef.current > 50) {
        lastSentRef.current = now;
        wsRef.current?.readyState === WebSocket.OPEN &&
          wsRef.current.send(
            JSON.stringify({
              type: "MOUSE_MOVE",
              x: e.clientX,
              y: e.clientY,
            })
          );
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // requestAnimationFrame loop to render opponent cursors
  useEffect(() => {
    if (gameEnded) {
      for (const div of Object.values(opponentDivsRef.current)) {
        div.remove();
      }
      opponentDivsRef.current = {};
      opponentsRef.current = {};
      return;
    }

    let animationId: number;

    const animate = () => {
      if (!cursorEnabledRef.current) return;

      const container = document.getElementById("cursor-container");
      if (!container) return;

      const height = window.innerHeight;

      for (const [id, pos] of Object.entries(opponentsRef.current)) {
        let div = opponentDivsRef.current[id];

        if (!div) {
          div = document.createElement("div");
          div.style.position = "absolute";
          div.style.width = "12px";
          div.style.height = "12px";
          div.style.borderRadius = "50%";
          div.style.background = "red";
          div.style.zIndex = "100";
          div.style.pointerEvents = "none";
          div.style.transform = "translate(-50%, -50%)";
          container.appendChild(div);
          opponentDivsRef.current[id] = div;
        }

        div.style.left = `${pos.x}px`;
        div.style.top = `${height - pos.y}px`;
      }

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [gameEnded]);

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

  // console.log("My Hand: ", myHandStacks)
  // console.log("Opponent: ", opponentHandStacks)
  // console.log("Central Piles: ", gameState?.center)

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
      draggable={draggable ?? false}
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
        color: "black",
        fontSize: "1em",
      }}
      onMouseDown={(e) => {
        if (winner) return;
        e.preventDefault()
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
        {showCount && gameState && (
          <div
            style={{
              position: "absolute",
              bottom: "-1.5em",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.8em",
              fontWeight: "bold",
              userSelect: 'none'
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
        draggable={false}
        onDragStart={() => onDragStart?.(stackIndex)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop?.(stackIndex)}
        onMouseDown={(e) => {
          if (winner) return;
          onMouseDown?.(e);
          e.preventDefault(); 
        }}
        className={className}     
        style={{
          position: "relative",
          width: "7em",
          height: "11em",
          cursor: draggable ? "grab" : "default",
          userSelect: "none",
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
              if (winner) return;
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

  const RecentMatches: React.FC<{ matches: MatchRecord[] }> = ({ matches }) => {
    return (
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "5%",
          width: "260px",
          padding: "1rem",
          background: "rgba(0,0,0,0.6)",
          borderRadius: "12px",
          color: "white",
          fontSize: "0.85rem",
          zIndex: 300,
          userSelect: "none",
        }}
      >
        <h3 style={{ marginBottom: "0.5rem" }}>Recent Matches</h3>
        {matches.length === 0 && <div>No recent matches</div>}
        {matches.map((m) => (
          <div
            key={m.matchId}
            style={{
              display: "flex",
              flexDirection: "column",
              marginBottom: "0.5rem",
              background: "rgba(255,255,255,0.1)",
              padding: "0.5rem",
              borderRadius: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>ID: {m.matchId}</span>
              <span
                style={{
                  color:
                    m.result === "win"
                      ? "#4ade80"
                      : m.result === "lose"
                      ? "#f87171"
                      : "#facc15",
                  fontWeight: "bold",
                }}
              >
                {m.result.toUpperCase()}
              </span>
            </div>
            <div>Opponent: {m.opponentId}</div>
            <div>
              Time: {new Date(m.timestamp).toLocaleString()}
            </div>
            <div>Rematch allowed: {m.allowRematch ? "Yes" : "No"}</div>
          </div>
        ))}
      </div>
    );
  };

  // Save recent matches to Dynamo
  const saveMatchToDB = async (match: MatchRecord & { playerId: string }) => {
    try {
      await fetch("https://ioqdbpqs68.execute-api.ap-southeast-1.amazonaws.com/Main/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(match),
      });
      // const text = await res.text();
      // console.log("Save match response:", res.status, text);
    } catch (err) {
      console.error("Failed to save match:", err);
    }
  };

  // Get recent matches from Dynamo
  const fetchRecentMatches = async () => {
    try {
      const res = await fetch(`https://ioqdbpqs68.execute-api.ap-southeast-1.amazonaws.com/Main?playerId=${playerId}`);
      const data = await res.json();
      if (data.matches) {
        setRecentMatches(data.matches);
      } 
    } catch (err) {
      console.error("Failed to fetch matches:", err);
    }
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
        userSelect: 'none'
      }}
    >
      {message || ""}
    </div>
  );

  // Return Button
  const handleReturnToLobby = () => {
    setGameState(null);
    setGameEnded(false);
    setWinner(null);
    setRemainingTime(null);
    setRematchInvite(false);
    setRematchPending(false);
    setMessage(null);
  };

  // Util function for timer
  const formatTime = (ms: number) => {
    const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2,'0')}`;
  };

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
              style={{ padding: "0.9rem 2rem", fontSize: "1.1rem", width: "100%" }}
              onClick={() => {
                wsRef.current?.send(JSON.stringify({ type: "HOST_ROOM" }));
                setLobbyMode("hosting");
                setHostJoinGameDisabled(true);
              }}
              disabled={lobbyMode !== "idle"}
            >
              Host Room
            </button>

            {/* Join Room */}
            <div style={{ display: "flex", gap: "0.5rem", width: "100%" }}>
              <input
                type="text"
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                placeholder="Room ID"
                style={{
                  flex: 1,
                  padding: "0.7rem",
                  fontSize: "1rem",
                  textTransform: "uppercase",
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
                setLobbyMode("finding");
                setMessage("Finding a match...");
              }}
              disabled={lobbyMode !== "idle"}
            >
              Find Match
            </button>

            {/* Cancel Button */}
            {lobbyMode === "hosting" && (
              <button
                style={{
                  padding: "0.7rem 1.5rem",
                  fontSize: "1rem",
                  width: "100%",
                }}
                onClick={() => {
                  wsRef.current?.send(JSON.stringify({ type: "CANCEL_HOST" }));
                  setLobbyMode("idle");
                  setHostJoinGameDisabled(false);
                  setMessage(null);
                }}
              >
                Cancel Hosting
              </button>
            )}

            {lobbyMode === "finding" && (
              <button
                style={{
                  padding: "0.7rem 1.5rem",
                  fontSize: "1rem",
                  width: "100%",
                }}
                onClick={() => {
                  wsRef.current?.send(JSON.stringify({ type: "CANCEL_FIND_MATCH" }));
                  setLobbyMode("idle");
                  setMessage(null);
                }}
              >
                Cancel Matchmaking
              </button>
            )}

            {/* Landing Page Message Box */}
            {message !== null && (
              <div style={{ marginTop: "0.75rem", width: "100%" }}>
                {MessageBox}
              </div>
            )}
          </div>

          {/* Recent Matches Panel */}
          {(
            <RecentMatches matches={recentMatches} />
          )}
        </div>
      )}

      {/* Player's Message Box */}
      {gameState && !gameEnded && (
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
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            gap: "4.5em",
            padding: "2.6em 3.4em",
            background: "radial-gradient(circle at center, #b08968 0%, #7a4a2e 70%)",
            borderRadius: "999px", 
            border: "4px solid #5a3218",
            boxShadow: `
              inset 0 6px 12px rgba(0,0,0,0.35),
              0 10px 25px rgba(0,0,0,0.4)
            `,

            zIndex: 10,
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
          top="88%"
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
          zIndex: 100,
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
          // console.log("STRESS !")
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

    {/* 10min Timer */}
    {remainingTime !== null && gameState && !gameEnded && (
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "90%",
          transform: "translateX(-50%)",
          fontSize: "2rem",
          fontWeight: "bold",
          color: "#fff",
          textShadow: "0 0 5px black",
          zIndex: 200,
        }}
      >
        {formatTime(remainingTime)}
      </div>
    )}

    {/* Game End Screen */}
    {gameEnded && (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 500,
          color: "white",
          gap: "1rem",
          userSelect: "none",
        }}
      >
        <h1>{message}</h1>

        {!rematchPending && !rematchInvite && allowRematch && (
          <button
            style={{ padding: "0.8rem 1.5rem", fontSize: "1rem" }}
            onClick={() => {
              wsRef.current?.send(JSON.stringify({ type: "INVITE_REMATCH" }));
            }}
          >
            Rematch
          </button>
        )}

        {rematchInvite && (
          <button
            style={{ padding: "0.8rem 1.5rem", fontSize: "1rem" }}
            onClick={() => {
              wsRef.current?.send(JSON.stringify({ type: "ACCEPT_REMATCH" }));
            }}
          >
            Accept Rematch
          </button>
        )}
        <button
          style={{
            padding: "0.6rem 1.2rem",
            fontSize: "0.9rem",
            background: "#444",
            color: "white",
          }}
          onClick={()=>{
            handleReturnToLobby()
            wsRef.current?.send(JSON.stringify({ type: "LEAVE_ROOM" }));
          }}
        >
          Return to Lobby
        </button>
      </div>
    )}
    </div>
  );
}

export default App;