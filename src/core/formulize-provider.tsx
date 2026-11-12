import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { observer } from "mobx-react-lite";

import { refresh } from "../engine/controller";
import Store, { Config, Instance } from "../formulize";
import { MathJaxLoader } from "../internal/mathjax-loader";
import { useMathJax } from "../util/use-mathjax";
import { setCurrentStore } from "../visualizations/graph2d/sampling-api";
import { StoreContext, StoreContextValue } from "./hooks/use-formulize";

interface ProviderProps {
  config?: Config;
  children: React.ReactNode;
  onError?: (error: string | null) => void;
  onReady?: (instance: Instance) => void;
  // Shown while MathJax loads, in place of the default message
  loadingFallback?: React.ReactNode;
}

// Inner provider that runs after MathJax is loaded
const ProviderInner: React.FC<ProviderProps> = observer(
  ({ config, children, onError, onReady }) => {
    const [instance, setInstance] = useState<Instance | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const instanceRef = useRef<Instance | null>(null);
    const { isLoaded: mathJaxLoaded } = useMathJax();

    useEffect(() => {
      // Only initialize after MathJax is loaded
      if (!mathJaxLoaded) {
        return;
      }

      if (!config) {
        setInstance(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      const initialize = async () => {
        setIsLoading(true);
        setError(null);

        try {
          // Clean up previous instance
          if (instanceRef.current) {
            instanceRef.current.destroy();
            instanceRef.current = null;
          }

          // Double-check MathJax is available
          if (!window.MathJax || !window.MathJax.tex2chtml) {
            throw new Error("MathJax is not properly loaded");
          }

          // Create new instance
          const newInstance = await Store.create(config);
          instanceRef.current = newInstance;

          // Initialize steps if stepping mode is enabled
          if (config.stepping && newInstance.computationStore) {
            newInstance.computationStore.setStepping(true);
            refresh(newInstance.computationStore);
          }

          setInstance(newInstance);
          if (onReady) {
            onReady(newInstance);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          setInstance(null);

          if (onError) {
            onError(errorMessage);
          }
        } finally {
          setIsLoading(false);
        }
      };

      initialize();

      // Cleanup on unmount or config change
      return () => {
        if (instanceRef.current) {
          instanceRef.current.destroy();
          instanceRef.current = null;
        }
      };
    }, [config, onError, onReady, mathJaxLoaded]);

    // Set the current store for the sampling API whenever it changes
    useEffect(() => {
      setCurrentStore(instance?.computationStore ?? null);
      return () => setCurrentStore(null);
    }, [instance?.computationStore]);

    const reinitialize = useCallback(() => {
      if (!instance?.computationStore) {
        return;
      }
      refresh(instance.computationStore);
    }, [instance]);

    const getVariable = useCallback(
      (variableName: string): number => {
        const store = instance?.computationStore;
        if (!store) return 0;
        const variable = store.variables.get(variableName);
        return typeof variable?.value === "number" ? variable.value : 0;
      },
      [instance]
    );

    const setVariable = useCallback(
      (variableName: string, value: number): boolean => {
        if (!instance) return false;
        try {
          return instance.setVariable(variableName, value);
        } catch {
          return false;
        }
      },
      [instance]
    );

    const contextValue: StoreContextValue = useMemo(
      () => ({
        instance,
        config: config || null,
        isLoading,
        error,
        computationStore: instance?.computationStore ?? null,
        getVariable,
        setVariable,
        reinitialize,
      }),
      [instance, config, isLoading, error, getVariable, setVariable, reinitialize]
    );

    return (
      <StoreContext.Provider value={contextValue}>
        {children}
      </StoreContext.Provider>
    );
  }
);

// Outer provider that ensures MathJax is loaded first
export const Provider: React.FC<ProviderProps> = ({
  loadingFallback,
  ...props
}) => {
  return (
    <MathJaxLoader fallback={loadingFallback}>
      <ProviderInner {...props} />
    </MathJaxLoader>
  );
};

export default Provider;
