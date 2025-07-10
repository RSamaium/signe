import { useState, useEffect, useRef } from "react";
import { connectionRoom, connectionWorld } from '../../../../../sync/src/client';
import { RoomSchema } from "../../shared/room.schema";
import { effect } from "@signe/reactive";

export default function Room() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("game");
  const [count, setCount] = useState(0);
  const socketRef = useRef<any>(null);
  const roomRef = useRef<any>(null);

  const connectToRoom = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      // Initialize room schema
      roomRef.current = new RoomSchema();
      
      // Connect to the room through the World service with auto-creation enabled
      socketRef.current = await connectionRoom({
        host: 'http://localhost:1999',
        id: 'test',
        room: roomId,
      }, roomRef.current);

      socketRef.current.on('sync', (data) => {
        console.log('sync', data);
      })
      
      // Listen for disconnection events
      socketRef.current.on('disconnect', () => {
        setIsConnected(false);
        setError('Disconnected from server');
      });

      effect(() => {
        if (roomRef.current) {
          setCount(roomRef.current.count());
        }
      });
      
      setIsConnected(true);
    } catch (err) {
      console.error('Connection error:', err);
      setError(`Failed to connect to the room: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectFromRoom = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    roomRef.current = null;
    setIsConnected(false);
  };
  
  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Styles
  const buttonStyles = {
    backgroundColor: isConnected ? "#f43f5e" : "#2563eb",
    borderRadius: "9999px",
    border: "none",
    color: "white",
    fontSize: "0.95rem",
    cursor: "pointer",
    padding: "1rem 3rem",
    margin: "1rem 0rem",
    disabled: isConnecting
  };

  const inputStyles = {
    padding: "0.75rem 1rem",
    borderRadius: "0.5rem",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
    width: "100%",
    maxWidth: "300px",
    margin: "0.5rem 0"
  };

  const containerStyles = {
    display: "flex",
    flexDirection: "column" as "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    gap: "1rem"
  };

  return (
    <div style={containerStyles}>
      <h1>Room Connection</h1>
      
      {error && (
        <div style={{ color: "red", margin: "1rem 0" }}>
          {error}
        </div>
      )}
      
      {!isConnected ? (
        <>
          <div style={{ marginBottom: "1rem", width: "100%", maxWidth: "300px" }}>
            <label htmlFor="roomId" style={{ display: "block", marginBottom: "0.5rem" }}>
              Room ID:
            </label>
            <input
              id="roomId"
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              style={inputStyles}
              placeholder="Enter room ID"
              disabled={isConnecting}
            />
          </div>
          
          <button 
            style={buttonStyles} 
            onClick={connectToRoom}
            disabled={isConnecting || !roomId.trim()}
          >
            {isConnecting ? "Connecting..." : "Connect to Room"}
          </button>
        </>
      ) : (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <span style={{ fontWeight: "bold" }}>Connected to room: </span>
            <span>{roomId}</span>
          </div>
          
          <div style={{ marginBottom: "2rem" }}>
            <span>Count: {count}</span>
            <button className="btn btn-primary" onClick={() => socketRef.current.emit('increment')}>Increment</button>
          </div>
          
          <button 
            style={buttonStyles} 
            onClick={disconnectFromRoom}
          >
            Leave Room
          </button>
        </>
      )}
    </div>
  );
} 