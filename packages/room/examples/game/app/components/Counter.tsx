import { useEffect, useRef, useState } from "react";
import { effect } from '../../../../../reactive';
import { connection } from '../../../../../sync/src/client';
import { RoomSchema } from "../../shared/room.schema";

let val = localStorage.getItem('test')

if (!val) {
  val = ''+Math.random()
  localStorage.setItem('test', val)
}

export default function Counter() {
  const [refresh, setRefresh] = useState(0);
  const [count, setCount] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  let socket = useRef<any>(null);
  let room = useRef<any>(null);

  useEffect(() => {
    room.current = new RoomSchema();
    socket.current = connection({
      host: location.hostname == 'localhost' ? 'localhost:1999' : 'https://signe.rsamaium.partykit.dev',
      room: 'game',
      id:  val as string
    }, room.current);

    socket.current.on('user_disconnected', (data: any) => {
      console.log(data)
    })

    // Subscribe to changes
    effect(() => {
      if (room.current) {
        setCount(room.current.count());
        setUsers(Object.values(room.current.users()));
        setRefresh(refresh + 1);
      }
    });
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

  const getStorage = async () => {
    const response = await fetch('/party/game').then(res => res.json())
    console.log(JSON.stringify(response, null, 2))
  }

  return (
    <>
      {
        room.current && (
          <div key={refresh}>
            <button style={styles} onClick={increment}>
              Increment me! {count !== null && <>Count: {count}</>}
            </button>
            <button onClick={getStorage}>get storage</button>
            <ul>
              {users.map((user: any) => (
                <li key={user.id()}>{user.id()} : {user.score()}</li>
              ))}
            </ul>
          </div>
        )
      }
    </>
  );
}
