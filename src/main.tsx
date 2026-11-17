import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./app.tsx";
import "./index.css";
import {
  MATHJAX_DOCUMENT_OPTIONS,
  MATHJAX_OUTPUT_OPTIONS,
  MATHJAX_SCRIPT_INTEGRITY,
  MATHJAX_SCRIPT_URL,
} from "./internal/mathjax-config";

// Only enable react-scan in development
if (import.meta.env.DEV) {
  import("react-scan")
    .then(({ scan }) => {
      scan({
        enabled: true,
      });
    })
    .catch((error) => {
      console.warn("Failed to load react-scan:", error);
    });
}

const loadMathJax = () => {
  return new Promise((resolve) => {
    window.MathJax = {
      loader: {
        load: [
          "input/tex",
          "output/chtml",
          "[tex]/html",
          "[tex]/color",
          "[tex]/cancel",
        ],
      },
      tex: {
        packages: { "[+]": ["html", "color", "cancel"] },
      },
      output: {
        ...MATHJAX_OUTPUT_OPTIONS,
        scale: 1.0,
      },
      options: MATHJAX_DOCUMENT_OPTIONS,
      startup: {
        pageReady: () => {
          // @ts-expect-error MathJax startup types are incomplete
          return MathJax.startup.defaultPageReady().then(() => {
            console.log("MathJax is ready");
            // @ts-expect-error Promise resolve callback lacks proper typing
            resolve();
          });
        },
      },
    };

    const script = document.createElement("script");
    script.src = MATHJAX_SCRIPT_URL;
    script.integrity = MATHJAX_SCRIPT_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.async = true;
    document.head.appendChild(script);
  });
};

// starting app only after MathJax is loaded
loadMathJax().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
