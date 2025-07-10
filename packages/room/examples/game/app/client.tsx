import { createRoot } from "react-dom/client";
import  Admin  from "./components/Admin";
import "./styles.css";
import Room from "./components/Room";


function App() {
  return (
    <main>
      <Room />
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
