import { createRoot } from "react-dom/client";
import Counter from "./components/Counter";
import "./styles.css";


function App() {
  return (
    <main>
      <Counter />
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
