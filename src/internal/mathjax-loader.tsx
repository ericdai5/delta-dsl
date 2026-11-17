import React, { createContext, useEffect, useRef, useState } from "react";

import {
  MATHJAX_DOCUMENT_OPTIONS,
  MATHJAX_OUTPUT_OPTIONS,
  MATHJAX_SCRIPT_INTEGRITY,
  MATHJAX_SCRIPT_URL,
} from "./mathjax-config";

declare global {
  interface Window {
    MathJax: any;
    MathJaxPromise?: Promise<void>;
  }
}

export interface MathJaxContextType {
  isLoaded: boolean;
  MathJax: any;
}

export const MathJaxContext = createContext<MathJaxContextType>({
  isLoaded: false,
  MathJax: null,
});

interface IMathJaxLoaderProps {
  children: React.ReactNode;
  // Shown while MathJax loads, in place of the default message
  fallback?: React.ReactNode;
}

export const MathJaxLoader: React.FC<IMathJaxLoaderProps> = ({
  children,
  fallback,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const loadMathJax = async () => {
      // Check if MathJax is already fully loaded
      if (
        window.MathJax &&
        window.MathJax.tex2chtml &&
        window.MathJax.startup &&
        window.MathJax.startup.document
      ) {
        console.log("MathJax already fully loaded");
        setIsLoaded(true);
        return;
      }

      // If MathJax loading promise exists, wait for it
      if (window.MathJaxPromise) {
        await window.MathJaxPromise;
        setIsLoaded(true);
        return;
      }

      // Configure MathJax BEFORE creating the loading promise
      // This must happen before the script loads
      if (!window.MathJax) {
        window.MathJax = {
          loader: {
            load: ["[tex]/html"], // Load html extension for \class and \cssId
          },
          tex: {
            packages: { "[+]": ["html"] }, // Enable \class and \cssId commands
            inlineMath: [
              ["$", "$"],
              ["\\(", "\\)"],
            ],
            displayMath: [
              ["$$", "$$"],
              ["\\[", "\\]"],
            ],
          },
          output: {
            ...MATHJAX_OUTPUT_OPTIONS,
            scale: 1.0, // Base scale - components control their own sizing
            matchFontHeight: true, // Match surrounding text for inline use
            mtextInheritFont: false, // Use MathJax fonts
            merrorInheritFont: false, // Use MathJax fonts for errors
          },
          options: MATHJAX_DOCUMENT_OPTIONS,
          startup: {
            ready: () => {
              window.MathJax.startup.defaultReady();
              window.MathJax.startup.promise.then(() => {
                console.log(
                  "MathJax loaded and ready by delta-dsl with scale 2.0"
                );
                console.log(
                  "MathJax chtml config:",
                  window.MathJax.config?.chtml
                );
              });
            },
          },
        };
      }

      // Create loading promise
      window.MathJaxPromise = new Promise((resolve) => {
        // Check if script already exists
        const existingScript = document.getElementById("MathJax-script");
        if (existingScript) {
          // Script exists, wait for MathJax to be ready
          const checkInterval = setInterval(() => {
            if (
              window.MathJax &&
              window.MathJax.tex2chtml &&
              window.MathJax.startup &&
              window.MathJax.startup.document
            ) {
              clearInterval(checkInterval);
              setIsLoaded(true);
              resolve();
            }
          }, 50);

          // Timeout after 10 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            console.error("MathJax failed to load after 10 seconds");
            setIsLoaded(true);
            resolve(); // Resolve anyway to prevent infinite waiting
          }, 10000);
        } else {
          // Load MathJax script
          const script = document.createElement("script");
          script.id = "MathJax-script";
          script.src = MATHJAX_SCRIPT_URL;
          script.integrity = MATHJAX_SCRIPT_INTEGRITY;
          script.crossOrigin = "anonymous";
          script.async = true;

          script.onload = () => {
            // Wait for MathJax to be fully ready
            if (window.MathJax && window.MathJax.startup) {
              window.MathJax.startup.promise.then(() => {
                console.log("MathJax script loaded and initialized");
                setIsLoaded(true);
                resolve();
              });
            } else {
              setIsLoaded(true);
              resolve();
            }
          };

          script.onerror = () => {
            console.error("Failed to load MathJax script");
            setIsLoaded(true);
            resolve();
          };

          document.head.appendChild(script);
        }
      });

      await window.MathJaxPromise;
    };

    loadMathJax();
  }, []);

  if (!isLoaded) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        Loading mathematical notation...
      </div>
    );
  }

  // Double-check MathJax is available before rendering children
  if (!window.MathJax || !window.MathJax.tex2chtml) {
    console.error("MathJax not properly loaded");
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "red" }}>
        Error loading MathJax
      </div>
    );
  }

  return (
    <MathJaxContext.Provider value={{ isLoaded, MathJax: window.MathJax }}>
      {children}
    </MathJaxContext.Provider>
  );
};
