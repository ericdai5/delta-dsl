import React, { useCallback, useEffect, useRef, useState } from "react";

import { reaction, runInAction } from "mobx";
import { observer } from "mobx-react-lite";

import { useStore } from "../../core/hooks";
import { IGraph3D, IPoint3D } from "../../types/graph3d";
import { getVariable, getVariableValue } from "../../util/computation-helpers";
import { ownTouches } from "../../util/own-touches";
import { sample3DLine, sample3DPoint, sampleSurface, getVariableRange } from "../graph2d/sampling-api";
import { resolveColor, resolveLineColor } from "./color";

type IPlotlyApi = {
  newPlot: (...args: unknown[]) => Promise<unknown>;
  react: (...args: unknown[]) => Promise<unknown>;
  purge: (element: HTMLElement) => void;
};

const resolvePlotlyApi = (module: unknown): IPlotlyApi => {
  const moduleWithDefault = module as { default?: unknown };
  return (moduleWithDefault.default ?? module) as IPlotlyApi;
};

interface Plot3DProps {
  config: IGraph3D;
}

interface LineData {
  name: string;
  points: IPoint3D[];
  color: string;
  width: number;
  showInLegend: boolean;
}

interface PointData {
  name: string;
  point: IPoint3D;
  color: string;
  size: number;
  showInLegend: boolean;
}

interface GraphSurfaceData {
  id: string;
  name: string;
  points: IPoint3D[];
  samples: number; // Number of samples per dimension for grid reshaping
  color: string | string[];
  opacity: number;
  showInLegend: boolean;
  showColorbar: boolean;
}

const Plot3D: React.FC<Plot3DProps> = observer(({ config }) => {
  const context = useStore();
  const computationStore = context?.computationStore;
    const plotRef = useRef<HTMLDivElement>(null);
    const plotlyRef = useRef<IPlotlyApi | null>(null);
    const clickHandlerRegistered = useRef(false);
    const [currentPoint, setCurrentPoint] = useState<IPoint3D | null>(null);
    const [linesData, setLinesData] = useState<LineData[]>([]);
    const [graphPointsData, setGraphPointsData] = useState<PointData[]>([]);
    const [graphSurfacesData, setGraphSurfacesData] = useState<
      GraphSurfaceData[]
    >([]);
    const [isPlotInitialized, setIsPlotInitialized] = useState(false);
    const [isPlotlyLoaded, setIsPlotlyLoaded] = useState(false);
    const [plotlyLoadError, setPlotlyLoadError] = useState<string | null>(null);

    useEffect(() => {
      let isMounted = true;

      void import("plotly.js-dist")
        .then((plotlyModule) => {
          if (!isMounted) return;
          plotlyRef.current = resolvePlotlyApi(plotlyModule);
          setIsPlotlyLoaded(true);
        })
        .catch((error: unknown) => {
          if (!isMounted) return;
          const message =
            error instanceof Error ? error.message : "Unknown Plotly load error";
          setPlotlyLoadError(message);
          console.error("Error loading Plotly:", error);
        });

      return () => {
        isMounted = false;
      };
    }, []);

    // Parse configuration options with defaults
    const {
      xAxis = "x",
      xRange = [0, 10],
      yAxis = "y",
      yRange = [0, 10],
      zVar = "z",
      zRange = [0, 100],
      width = 600,
      height = 600,
      showCurrentPointInLegend = false,
      lines,
      points,
      surfaces,
    } = config;

    // Get min/max values from ranges
    const [xMin, xMax] = xRange;
    const [yMin, yMax] = yRange;
    const [zMin, zMax] = zRange;

    // Helper function to get variable label from computation store
    const getVariableLabel = useCallback(
      (variableName: string): string => {
        if (!computationStore) return variableName;
        const varId = variableName;
        const variable = getVariable(varId, computationStore);
        return variable?.name || variableName; // Fallback to variable name if no name
      },
      [computationStore]
    );

    // Calculate all graph-based visualizations using the sample() collection mechanism
    const calculateGraphData = useCallback(() => {
      if (!computationStore) return { lines: [], points: [], surfaces: [] };

      const lineResults: LineData[] = [];
      const pointResults: PointData[] = [];
      const surfaceResults: GraphSurfaceData[] = [];

      for (const lineConfig of lines ?? []) {
        const {
          sampleId,
          name,
          showInLegend = true,
          parameter,
          range,
          samples = 100,
          color = "blue",
          width = 4,
        } = lineConfig;
        const displayName = name || sampleId;
        // Sample the line using sampling API
        const resolvedRange = range ?? getVariableRange(parameter);
        const sampledPoints = sample3DLine(parameter, resolvedRange, samples, sampleId);
        if (sampledPoints.length > 0) {
          lineResults.push({
            name: displayName,
            points: sampledPoints,
            color: resolveLineColor(color),
            width,
            showInLegend,
          });
        }
      }

      for (const surfaceConfig of surfaces ?? []) {
        const {
          sampleId,
          name,
          showInLegend = true,
          parameters,
          ranges,
          samples = 50,
          color = "Viridis",
          opacity = 0.8,
          showColorbar = false,
        } = surfaceConfig;
        const displayName = name || sampleId;
        // Sample the surface using sampling API
        const resolvedRanges: [[number, number], [number, number]] = [
          ranges?.[0] ?? getVariableRange(parameters[0]),
          ranges?.[1] ?? getVariableRange(parameters[1]),
        ];
        const sampledPoints = sampleSurface(parameters, resolvedRanges, samples, sampleId);
        if (sampledPoints.length > 0) {
          surfaceResults.push({
            id: sampleId,
            name: displayName,
            points: sampledPoints,
            samples, // Include sample count for grid reshaping
            color,
            opacity,
            showInLegend,
            showColorbar,
          });
        }
      }

      for (const pointConfig of points ?? []) {
        const {
          sampleId,
          name,
          showInLegend = true,
          color = "red",
          size = 8,
        } = pointConfig;
        const displayName = name || sampleId;
        // Sample the point using sampling API
        const point = sample3DPoint(sampleId);
        if (point) {
          pointResults.push({
            name: displayName,
            point,
            color: resolveLineColor(color),
            size,
            showInLegend,
          });
        }
      }

      return {
        lines: lineResults,
        points: pointResults,
        surfaces: surfaceResults,
      };
    }, [lines, points, surfaces, computationStore]);

    // Direct calculation function without debouncing
    const calculateDataPoints = useCallback(() => {
      if (!computationStore) return;
      try {
        const graphResults = calculateGraphData();

        // Set graph-based data
        setGraphSurfacesData(graphResults.surfaces);
        setLinesData(graphResults.lines);
        setGraphPointsData(graphResults.points);

        // Update current point
        const currentX = getVariableValue(xAxis, computationStore);
        const currentY = getVariableValue(yAxis, computationStore);
        const currentZ = getVariableValue(zVar, computationStore);
        setCurrentPoint({ x: currentX, y: currentY, z: currentZ });
      } catch (error) {
        console.error("Error calculating 3D plot data:", error);
        setLinesData([]);
        setCurrentPoint(null);
      }
    }, [calculateGraphData, xAxis, yAxis, zVar, computationStore]);

    useEffect(() => {
      setLinesData([]);
      setCurrentPoint(null);
      calculateDataPoints();
    }, [calculateDataPoints]);

    // Optimized MobX reaction without debouncing
    // Watch all input variables (not just axis variables) to update point graphs
    useEffect(() => {
      if (!computationStore) return;
      const disposer = reaction(
        () => {
          const xValue = getVariableValue(xAxis, computationStore);
          const yValue = getVariableValue(yAxis, computationStore);
          const zValue = getVariableValue(zVar, computationStore);

          // Also track all input variables for point graph updates
          const inputVarValues: Record<string, number> = {};
          for (const [
            varName,
            variable,
          ] of computationStore.variables.entries()) {
            if (variable.input && typeof variable.value === "number") {
              inputVarValues[varName] = variable.value;
            }
          }

          return { xValue, yValue, zValue, inputVarValues };
        },
        (newValues, oldValues) => {
          // Check if axis values changed significantly
          const axisChanged =
            !oldValues ||
            Math.abs(newValues.xValue - oldValues.xValue) >= 0.01 ||
            Math.abs(newValues.yValue - oldValues.yValue) >= 0.01 ||
            Math.abs(newValues.zValue - oldValues.zValue) >= 0.01;

          // Check if any input variable changed
          const inputVarsChanged =
            !oldValues ||
            Object.keys(newValues.inputVarValues).some(
              (key) =>
                newValues.inputVarValues[key] !== oldValues.inputVarValues[key]
            );

          if (axisChanged || inputVarsChanged) {
            calculateDataPoints();
          }
        },
        {
          fireImmediately: false,
        }
      );

      return disposer;
    }, [xAxis, yAxis, zVar, calculateDataPoints, computationStore]);

    // Optimized plotting effect
    useEffect(() => {
      const plotly = plotlyRef.current;
      if (
        !isPlotlyLoaded ||
        !plotly ||
        !plotRef.current ||
        (linesData.length === 0 &&
          graphSurfacesData.length === 0 &&
          graphPointsData.length === 0)
      )
        return;

      const plotData: Record<string, unknown>[] = [];

      // Process each line
      linesData.forEach((lineData) => {
        const validPoints = lineData.points.filter((p) => p.z !== null);
        if (validPoints.length > 0) {
          plotData.push({
            type: "scatter3d",
            mode: "lines",
            x: validPoints.map((p) => p.x),
            y: validPoints.map((p) => p.y),
            z: validPoints.map((p) => p.z),
            line: {
              width: lineData.width,
              color: lineData.color,
            },
            name: lineData.name,
            showlegend: lineData.showInLegend,
          });
        }
      });

      // Process graph-based surfaces (track rendered IDs to prevent duplicates)
      const renderedSurfaceIds = new Set<string>();
      graphSurfacesData.forEach((surfaceData) => {
        // Skip if we've already rendered a surface with this ID
        if (renderedSurfaceIds.has(surfaceData.id)) {
          return;
        }
        renderedSurfaceIds.add(surfaceData.id);

        const points = surfaceData.points;
        if (points.length > 0) {
          // For parametric surfaces, reshape the flat points array into 2D matrices
          // Calculate actual grid size from point count (should be a perfect square)
          const actualGridSize = Math.round(Math.sqrt(points.length));
          const expectedGridSize = surfaceData.samples + 1;

          // Use the grid size that best matches the actual point count
          const gridSize =
            actualGridSize * actualGridSize === points.length
              ? actualGridSize
              : expectedGridSize;

          // Log warning if there's a mismatch
          if (points.length !== gridSize * gridSize) {
            console.warn(
              `Surface ${surfaceData.id}: point count ${points.length} doesn't match grid ${gridSize}x${gridSize}=${gridSize * gridSize}`
            );
          }

          // Build x, y, z matrices from the flat point list
          // Points are ordered: for each value of param1, iterate through all values of param2
          const xMatrix: number[][] = [];
          const yMatrix: number[][] = [];
          const zMatrix: (number | null)[][] = [];

          for (let i = 0; i < gridSize; i++) {
            const xRow: number[] = [];
            const yRow: number[] = [];
            const zRow: (number | null)[] = [];
            for (let j = 0; j < gridSize; j++) {
              const idx = i * gridSize + j;
              if (idx < points.length) {
                const p = points[idx];
                xRow.push(p.x);
                yRow.push(p.y);
                zRow.push(p.z);
              }
            }
            xMatrix.push(xRow);
            yMatrix.push(yRow);
            zMatrix.push(zRow);
          }

          plotData.push({
            type: "surface",
            x: xMatrix,
            y: yMatrix,
            z: zMatrix,
            colorscale: resolveColor(surfaceData.color),
            showscale: surfaceData.showColorbar,
            opacity: surfaceData.opacity,
            connectgaps: false,
            name: surfaceData.name,
            showlegend: surfaceData.showInLegend,
            contours: {
              x: { show: false },
              y: { show: false },
              z: { show: false },
            },
          });
        }
      });

      // Process graph-based points
      graphPointsData.forEach((pointData) => {
        if (pointData.point.z !== null) {
          plotData.push({
            type: "scatter3d",
            mode: "markers",
            x: [pointData.point.x],
            y: [pointData.point.y],
            z: [pointData.point.z],
            marker: {
              size: pointData.size,
              color: pointData.color,
              symbol: "circle",
            },
            name: pointData.name,
            showlegend: pointData.showInLegend,
          });
        }
      });

      // Add current point marker
      if (
        currentPoint &&
        currentPoint.z !== null &&
        currentPoint.x >= xMin &&
        currentPoint.x <= xMax &&
        currentPoint.y >= yMin &&
        currentPoint.y <= yMax &&
        currentPoint.z >= zMin &&
        currentPoint.z <= zMax
      ) {
        plotData.push({
          type: "scatter3d",
          mode: "markers",
          x: [currentPoint.x],
          y: [currentPoint.y],
          z: [currentPoint.z],
          marker: {
            size: 8,
            color: "red",
            symbol: "diamond",
          },
          name: `Current Point`,
          showlegend: showCurrentPointInLegend,
        });
      }

      // Layout configuration
      const layout = {
        uirevision: "persistent", // This key setting preserves user interactions like camera angle
        autosize: true, // Let Plotly automatically size to container
        scene: {
          xaxis: {
            title: {
              text: getVariableLabel(xAxis),
            },
            range: [xMin, xMax],
            autorange: false,
          },
          yaxis: {
            title: {
              text: getVariableLabel(yAxis),
            },
            range: [yMin, yMax],
            autorange: false,
          },
          zaxis: {
            title: {
              text: getVariableLabel(zVar),
            },
            range: [zMin, zMax],
            autorange: false,
          },
          aspectratio: { x: 1, y: 1, z: 1 },
          aspectmode: "manual",
        },
        margin: { l: 0, r: 0, b: 0, t: 0 },
        legend: {
          x: 0,
          y: 1,
          xanchor: "left",
          yanchor: "top",
          bgcolor: "rgba(255, 255, 255, 0.8)",
          bordercolor: "rgba(0, 0, 0, 0.05)",
          borderwidth: 1,
          font: {
            size: 11,
          },
          itemsizing: "constant",
          traceorder: "normal",
        },
        modebar: {
          orientation: "v",
          bgcolor: "rgba(255, 255, 255, 0.8)",
          color: "rgba(0, 0, 0, 0.7)",
          activecolor: "rgba(0, 0, 0, 0.9)",
        },
      };

      // Plotly configuration
      const plotlyConfig = {
        displayModeBar: true,
        displaylogo: false,
        responsive: true, // This is the key for proper container sizing
        modeBarButtonsToRemove: [], // Keep all buttons but position them properly
      };

      // Use newPlot for initial creation, react for updates to preserve user interactions
      const plotMethod = isPlotInitialized
        ? plotly.react
        : plotly.newPlot;

      plotMethod(plotRef.current, plotData, layout, plotlyConfig)
        .then(() => {
          // Mark plot as initialized after first render
          if (!isPlotInitialized) {
            setIsPlotInitialized(true);
          }

          // Register click handler (only once, but handler uses refs for current values)
          if (plotRef.current && !clickHandlerRegistered.current) {
            clickHandlerRegistered.current = true;

            (plotRef.current as any).on("plotly_click", (data: any) => {
              if (!computationStore) return;
              if (data.points && data.points.length > 0) {
                const point = data.points[0];
                try {
                  runInAction(() => {
                    // First try to use xAxis/yAxis if they exist as variables
                    let xVarId = config.xAxis || "x";
                    let yVarId = config.yAxis || "y";

                    // If xAxis/yAxis don't exist, look for surface parameters
                    if (
                      !computationStore.variables.has(xVarId) ||
                      !computationStore.variables.has(yVarId)
                    ) {
                      const surface = config.surfaces?.[0];
                      if (surface?.parameters) {
                        xVarId = surface.parameters[0];
                        yVarId = surface.parameters[1];
                      }
                    }

                    if (computationStore.variables.has(xVarId)) {
                      computationStore.setValue(xVarId, point.x);
                    }
                    if (computationStore.variables.has(yVarId)) {
                      computationStore.setValue(yVarId, point.y);
                    }
                  });
                } catch (error) {
                  console.error("Error updating variables:", error);
                }
              }
            });
          }
        })
        .catch((error: any) => {
          console.error("Error rendering 3D plot:", error);
        });
    }, [
      linesData,
      graphSurfacesData,
      graphPointsData,
      currentPoint,
      isPlotlyLoaded,
      isPlotInitialized,
      showCurrentPointInLegend,
      getVariableLabel,
      xMin,
      xMax,
      yMin,
      yMax,
      zMin,
      zMax,
      computationStore,
      xAxis,
      yAxis,
      zVar,
      config,
    ]);

    // A finger on the plot turns it. Keep that touch from also moving a
    // canvas that pans. Runs after every render, as the plot's element is
    // not there while Plotly is loading.
    useEffect(() => {
      ownTouches(plotRef.current);
    });

    // Cleanup on unmount
    useEffect(() => {
      const currentPlotRef = plotRef.current;
      return () => {
        // Cleanup Plotly instance and event listeners
        if (currentPlotRef && plotlyRef.current) {
          try {
            plotlyRef.current.purge(currentPlotRef);
          } catch (error) {
            console.debug("Error during Plotly cleanup:", error);
          }
        }
        // Reset click handler ref so it can be re-registered on remount
        clickHandlerRegistered.current = false;
      };
    }, []);

  // Guard: computationStore must be available
  if (!computationStore) {
    return <div className="plot3d-loading">Loading plot...</div>;
  }

  if (plotlyLoadError) {
    return (
      <div className="plot3d-error">
        Unable to load 3D plotting: {plotlyLoadError}
      </div>
    );
  }

  return (
    <div
      ref={plotRef}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
});

export default Plot3D;
