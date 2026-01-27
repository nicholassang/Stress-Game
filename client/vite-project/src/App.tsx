// App.tsx
import { useEffect, useRef } from "react";

interface CursorPosition {
  x: number;
  y: number;
}

interface Opponents {
  [id: string]: CursorPosition;
}

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const localCursorRef = useRef<HTMLDivElement | null>(null);
  const opponentsRef = useRef<Opponents>({}); // store latest positions
  const opponentDivsRef = useRef<Record<string, HTMLDivElement>>({}); // map playerId -> div
  const lastSentRef = useRef<number>(0);

  // Connect WS and matchmaking
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ Connected to server");
      ws.send(JSON.stringify({ type: "FIND_MATCH" }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "MATCH_FOUND":
          console.log("Match found!", data.players);
          break;

        case "MOUSE_UPDATE":
          // Update ref, not state
          opponentsRef.current[data.playerId] = { x: data.x, y: data.y };
          break;

        case "OPPONENT_DISCONNECTED":
          const div = opponentDivsRef.current[data.playerId];
          if (div && div.parentNode) div.parentNode.removeChild(div);
          delete opponentsRef.current[data.playerId];
          delete opponentDivsRef.current[data.playerId];
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
      <h1 style={{ position: "absolute", top: 10, left: 10 }}>
        1v1 Mouse Tracker
      </h1>

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
    </div>
  );
}

export default App;
