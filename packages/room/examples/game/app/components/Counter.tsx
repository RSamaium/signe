import { useEffect, useRef, useState } from "react";
import { effect } from '../../../../../reactive';
import { connection } from '../../../../../sync/src/client';
import { RoomSchema } from "../../shared/room.schema";

export default function Counter() {
  const [count, setCount] = useState<number | null>(null);
  let socket = useRef<any>(null);
  let room = useRef<any>(null);

  useEffect(() => {
    room.current = new RoomSchema();
    socket.current = connection({
      host: location.hostname == 'localhost' ? 'localhost:1999' : 'https://signe.rsamaium.partykit.dev',
      room: 'game'
    }, room.current)
    
    effect(() => {
       setCount(room.current.count())
    })
  }, []);

  const increment = () => {
    room.current.count.update((count: number) => count + 1);
    socket.current.emit('increment')
  };

  const styles = {
    backgroundColor: "#ff0f0f",
    borderRadius: "9999px",
    border: "none",
    color: "white",
    fontSize: "0.95rem",
    cursor: "pointer",
    padding: "1rem 3rem",
    margin: "1rem 0rem",
  };

  return (
    <button style={styles} onClick={increment}>
      Increment me! {count !== null && <>Count: {count}</>}
    </button>
  );
}
