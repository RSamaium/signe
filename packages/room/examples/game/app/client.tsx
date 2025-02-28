import { createRoot } from "react-dom/client";
import  Admin  from "./components/Admin";
import "./styles.css";


function App() {
  return (
    <main>
      <Admin />
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
