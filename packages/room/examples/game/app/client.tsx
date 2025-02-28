import { createRoot } from "react-dom/client";
import Counter from "./components/Counter";
import  Admin  from "./components/Admin";
import "./styles.css";


function App() {
  return (
    <main>
      <Counter />
      <Admin />
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
