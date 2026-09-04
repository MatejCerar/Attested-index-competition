import "@/mantine-layer.css";
import "@/satoshi.css";
import "@/global.css";
import "@mantine/charts/styles.css";

import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "@/app.tsx";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
