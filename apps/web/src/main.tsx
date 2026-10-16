import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "./components/ui/toast";
import { createQueryClient } from "./lib/query";
import { ThemeProvider } from "./providers/theme";
import { createAppRouter } from "./router";
import "./styles.css";

const queryClient = createQueryClient({
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
  },
});

const router = createAppRouter(queryClient);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Elemento #root não encontrado.");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
