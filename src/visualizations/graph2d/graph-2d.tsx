import React, { useCallback, useEffect, useRef, useState } from "react";

import { reaction } from "mobx";
import { observer } from "mobx-react-lite";

import * as d3 from "d3";

import { useStore } from "../../core/hooks";
import { type IGraph2D, type IVector } from "../../types/graph2d";
import { enableTouchDrag } from "../../util/touch-drag";
import { type AxisLabelInfo, addAxes, addGrid } from "./axes";
import { AxisLabels } from "./axis-labels";
import { PLOT2D_DEFAULTS } from "./defaults";
import { sample2DLine, sample2DPoint, getVariableRange } from "./sampling-api";
import { calculatePlotDimensions } from "./utils";
import { getAllVectorVariables, renderVectors } from "./vectors";

interface Plot2DProps {
  config: IGraph2D;
}

export interface DataPoint {
  x: number;
  y: number;
}

// Graph-based line data structure
interface GraphLineData {
  name: string;
  points: DataPoint[];
  color: string;
  lineWidth: number;
  showInLegend: boolean;
}

// Graph-based point data structure
interface GraphPointData {
  sampleId: string;
  name: string;
  point: DataPoint;
  color: string;
  size: number;
  showInLegend: boolean;
  showLabel: boolean;
  interaction?: ["horizontal-drag" | "vertical-drag", string];
  stepId?: string;
  persistence?: boolean;
}

const Plot2D: React.FC<Plot2DProps> = observer(({ config }) => {
  const context = useStore();
  const computationStore = context?.computationStore;
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Where the axis labels go. The plot is drawn in an effect, after the first
  // render, so this is state: setting it renders the labels the draw placed.
  const [axisLabelInfo, setAxisLabelInfo] = useState<AxisLabelInfo>({});
  // Track if drag is happening on THIS plot (to distinguish from formula variable drag)
  const isLocalDragRef = useRef(false);
  // Track focus state for graph interaction (persists across re-renders)
  // Now includes index to support multiple lines/points
  const focusStateRef = useRef<{
    type: "line" | "point";
    index: number;
  } | null>(null);
  // Track if currently dragging (persists across re-renders to fix closure issue)
  const isDraggingRef = useRef(false);
  // Store event handler references to properly remove them across re-renders
  const globalMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const globalMouseUpRef = useRef<(() => void) | null>(null);

  // Parse configuration options with defaults
  const {
    xAxisInterval,
    xAxisPos,
    xLabelPos,
    xGrid = "show",
    yAxisInterval,
    yAxisPos,
    yLabelPos,
    yGrid = "show",
    vectors,
    lines,
    points,
    width = PLOT2D_DEFAULTS.width,
    height = PLOT2D_DEFAULTS.height,
    interaction,
  } = config;

  // Get axis labels from config (purely cosmetic, don't affect graphing)
  const xAxisLabel = config.xAxisLabel;
  const yAxisLabel = config.yAxisLabel;
  // Get axis variables for hover highlighting (optional)
  const xAxisVar = config.xAxisVar;
  const yAxisVar = config.yAxisVar;
  // Resolve axis ranges - prefer explicit config, then axis variable range, then defaults
  const xAxisVarRange = xAxisVar
    ? computationStore?.variables.get(xAxisVar)?.range
    : undefined;
  const yAxisVarRange = yAxisVar
    ? computationStore?.variables.get(yAxisVar)?.range
    : undefined;
  const xRange = config.xRange || xAxisVarRange || PLOT2D_DEFAULTS.xRange;
  const yRange = config.yRange || yAxisVarRange || PLOT2D_DEFAULTS.yRange;

  // Calculate plot dimensions using helper function
  const { plotWidth, plotHeight, margin } = calculatePlotDimensions(
    width,
    height
  );

  // Get min/max values from ranges
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;

  // Function to draw the plot
  const drawPlot = useCallback(() => {
    // Guard: computationStore must be available
    if (!computationStore) return;

    // Check if we have graph data early (needed for drag check)
    const hasGraphs = (lines?.length ?? 0) > 0 || (points?.length ?? 0) > 0;

    // Only skip redraw during an ACTIVE drag (when both ref and store confirm dragging)
    // This allows redraws when external updates happen (e.g., stopwatch reset) even if
    // a point is in a focused state after a previous interaction
    if (isLocalDragRef.current && computationStore.isDragging) {
      return;
    }
    // Reset stale refs if drag has ended but refs weren't properly cleared
    if (isLocalDragRef.current && !computationStore.isDragging) {
      isLocalDragRef.current = false;
      isDraggingRef.current = false;
    }

    // Clean up any stale global event listeners from previous renders
    if (globalMouseMoveRef.current) {
      document.removeEventListener("mousemove", globalMouseMoveRef.current);
      globalMouseMoveRef.current = null;
    }
    if (globalMouseUpRef.current) {
      document.removeEventListener("mouseup", globalMouseUpRef.current);
      globalMouseUpRef.current = null;
    }

    // Clear focus state only when external drag is happening (formula variable drag)
    // This allows the plot to update freely during external interactions
    // but preserves focus during normal redraws (hover changes, etc.)
    if (hasGraphs && computationStore.isDragging && !isLocalDragRef.current) {
      focusStateRef.current = null;
      isDraggingRef.current = false;
    }

    // Don't full-redraw during standard drag operations to prevent losing the interaction element
    // The 'reaction' below handles live updates via DOM manipulation instead
    // For graphs mode with formula variable drag, we allow redraw to update line and point
    if (computationStore.isDragging && !interaction && !hasGraphs) {
      return;
    }

    if (!svgRef.current) return;

    // Check if we have vectors or graphs
    const hasVectors = vectors && vectors.length > 0;
    if (!hasVectors && !hasGraphs) return;

    // Clear previous graph
    d3.select(svgRef.current).selectAll("*").remove();

    // Create SVG container
    const svg = d3
      .select(svgRef.current)
      .attr("width", plotWidth + margin.left + margin.right)
      .attr("height", plotHeight + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // How much the plot is scaled on screen, by the canvas's zoom
    const svgElement = svgRef.current;
    const plotScale = () => {
      const container = svgElement.parentElement;
      const layoutWidth = container?.offsetWidth ?? 0;
      if (!container || layoutWidth <= 0) return 1;
      return container.getBoundingClientRect().width / layoutWidth || 1;
    };
    // Where a pointer is on the plot, in the plot's own units. d3.pointer
    // maps through getScreenCTM, which Safari on iOS 17 works out without
    // the canvas's zoom, so a finger on a zoomed canvas missed what it
    // touched. The plot's box on screen does include the zoom.
    const plotPointer = (point: {
      clientX: number;
      clientY: number;
    }): [number, number] => {
      const box = svgElement.getBoundingClientRect();
      const scale = plotScale();
      return [
        (point.clientX - box.left) / scale - margin.left,
        (point.clientY - box.top) / scale - margin.top,
      ];
    };

    // Create scales
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, plotWidth]);
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([plotHeight, 0]);

    // Get vector variables for enhanced axis hovering
    const vectorVars =
      hasVectors && vectors
        ? getAllVectorVariables(vectors)
        : { allXVariables: [], allYVariables: [] };

    const resolveAxisLabel = (
      axisLabel: string | undefined,
      axisVar: string | undefined,
      fallback: string
    ) => {
      if (axisLabel) {
        return axisLabel;
      }
      if (!axisVar) {
        return fallback;
      }
      const axisVariable = computationStore.variables.get(axisVar);
      if (axisVariable?.name) {
        // Match label-node name rendering (text mode)
        return `\\text{${axisVariable.name}}`;
      }
      return axisVar;
    };

    const resolvedXAxisLabel = resolveAxisLabel(xAxisLabel, xAxisVar, "X");
    const resolvedYAxisLabel = resolveAxisLabel(yAxisLabel, yAxisVar, "Y");

    // Add axes using helper function and capture label info
    const labelInfo = addAxes(svg, {
      xScale,
      yScale,
      plotWidth,
      plotHeight,
      margin,
      xLabel: resolvedXAxisLabel,
      yLabel: resolvedYAxisLabel,
      xAxis: xAxisVar, // Variable for hover highlighting (optional)
      yAxis: yAxisVar,
      xAxisInterval,
      yAxisInterval,
      xAxisPos,
      yAxisPos,
      xLabelPos,
      yLabelPos,
      allXVariables: vectorVars.allXVariables,
      allYVariables: vectorVars.allYVariables,
    });

    // Hand the labels to React to render, unless this draw left them as they were
    setAxisLabelInfo((current) =>
      JSON.stringify(current) === JSON.stringify(labelInfo)
        ? current
        : labelInfo
    );

    // Add grid using helper function
    addGrid(svg, {
      xScale,
      yScale,
      plotWidth,
      plotHeight,
      margin,
      xGrid,
      yGrid,
      xAxisInterval,
      yAxisInterval,
    });

    if (hasVectors) {
      // Vector mode
      const defs = svg.append("defs");

      // Create clip path for vectors to cut off at grid boundaries
      const vectorClipId = `vector-clip-${Math.random().toString(36).slice(2)}`;
      defs
        .append("clipPath")
        .attr("id", vectorClipId)
        .append("rect")
        .attr("width", plotWidth)
        .attr("height", plotHeight);

      // Create a clipped group for all vectors
      const vectorGroup = svg
        .append("g")
        .attr("class", "vectors-group")
        .attr("clip-path", `url(#${vectorClipId})`);

      // Refresh step data to ensure vectors update when variables change
      // This is needed for smooth updates during line/variable drags
      if (computationStore.stepping) {
        computationStore.sampleSteps();
      }

      // Separate regular vectors from step-dependent vectors
      const regularVectors: IVector[] = [];
      const stepVectors: Array<{
        config: IVector;
        startPoints: DataPoint[];
        endPoints: DataPoint[];
      }> = [];

      for (const vector of vectors as IVector[]) {
        if (!vector.stepId) {
          // No stepId - always visible
          regularVectors.push(vector);
        } else if (computationStore.stepping) {
          // Has stepId and in stepping mode - collect accumulated points
          const steps = computationStore.steps;
          const currentStepIndex = computationStore.currentStepIndex;

          // Get accumulated points for both start and end sample IDs
          const startPoints = (computationStore.stepDataPointMap.get(
            vector.startSampleId
          ) ?? []) as unknown as DataPoint[];
          const endPoints = (computationStore.stepDataPointMap.get(
            vector.endSampleId
          ) ?? []) as unknown as DataPoint[];

          // Count how many steps with matching stepId are in range [0, currentStepIndex]
          let matchingStepCount = 0;
          for (let i = 0; i <= currentStepIndex && i < steps.length; i++) {
            if (steps[i].id === vector.stepId) {
              matchingStepCount++;
            }
          }

          // Get accumulated data based on step progress and persistence
          const accumulatedStartPoints: DataPoint[] =
            vector.persistence === false
              ? // Only show the current step's vector (no persistence)
                matchingStepCount > 0 && startPoints[matchingStepCount - 1]
                ? [startPoints[matchingStepCount - 1]]
                : []
              : // Default (true): show all vectors up to current step
                startPoints.slice(0, matchingStepCount);

          const accumulatedEndPoints: DataPoint[] =
            vector.persistence === false
              ? matchingStepCount > 0 && endPoints[matchingStepCount - 1]
                ? [endPoints[matchingStepCount - 1]]
                : []
              : endPoints.slice(0, matchingStepCount);

          if (
            accumulatedStartPoints.length > 0 &&
            accumulatedEndPoints.length > 0
          ) {
            stepVectors.push({
              config: vector,
              startPoints: accumulatedStartPoints,
              endPoints: accumulatedEndPoints,
            });
          }
        // If vector has stepId but stepping is disabled, don't render it at all
        }
      }

      // Render regular vectors
      renderVectors(
        vectorGroup,
        defs,
        regularVectors,
        xScale,
        yScale,
        plotWidth,
        plotHeight,
        computationStore
      );

      // Render accumulated step vectors
      let stepVectorIndex = regularVectors.length;
      stepVectors.forEach(({ config, startPoints, endPoints }) => {
        const minLength = Math.min(startPoints.length, endPoints.length);
        for (let i = 0; i < minLength; i++) {
          const isLastVector = i === minLength - 1;
          const startPt = startPoints[i];
          const endPt = endPoints[i];

          if (startPt && endPt) {
            const color = config.color || "#3b82f6";
            const lineWidth = config.lineWidth || 2;
            const shape = config.shape || "arrow";
            const opacity = isLastVector ? 1 : 0.5;
            const curvature = config.curved ?? 0;

            // Generate path string (curved or straight)
            const startScreen = { x: xScale(startPt.x), y: yScale(startPt.y) };
            const endScreen = { x: xScale(endPt.x), y: yScale(endPt.y) };

            // Helper to generate curved path
            const generateCurvedPath = (
              start: { x: number; y: number },
              end: { x: number; y: number },
              curve: number
            ): string => {
              if (curve === 0) {
                return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
              }
              const midX = (start.x + end.x) / 2;
              const midY = (start.y + end.y) / 2;
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length === 0) {
                return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
              }
              const normalX = -dy / length;
              const normalY = dx / length;
              const offset = curve * length * 0.5;
              const controlX = midX + normalX * offset;
              const controlY = midY + normalY * offset;
              return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
            };

            const pathString = generateCurvedPath(startScreen, endScreen, curvature);

            // Create arrow marker if needed
            if (shape === "arrow") {
              const markerId = `step-arrowhead-${stepVectorIndex}-${i}`;
              defs
                .append("marker")
                .attr("id", markerId)
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 8)
                .attr("refY", 0)
                .attr("markerWidth", config.markerSize || 6)
                .attr("markerHeight", config.markerSize || 6)
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M0,-5L10,0L0,5")
                .attr("fill", color);

              const vectorId = `step-vector-${stepVectorIndex}-${i}`;
              vectorGroup
                .append("path")
                .attr("id", vectorId)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", lineWidth)
                .attr("opacity", opacity)
                .attr("marker-end", `url(#${markerId})`)
                .attr("d", pathString);
            } else if (shape === "dash") {
              const vectorId = `step-vector-${stepVectorIndex}-${i}`;
              vectorGroup
                .append("path")
                .attr("id", vectorId)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", lineWidth)
                .attr("stroke-dasharray", "5,5")
                .attr("opacity", opacity)
                .attr("d", pathString);
            } else if (shape === "point") {
              vectorGroup
                .append("circle")
                .attr("cx", xScale(endPt.x))
                .attr("cy", yScale(endPt.y))
                .attr("r", config.markerSize || 4)
                .attr("fill", color)
                .attr("opacity", opacity);
            } else {
              // Default line
              const vectorId = `step-vector-${stepVectorIndex}-${i}`;
              vectorGroup
                .append("path")
                .attr("id", vectorId)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", lineWidth)
                .attr("opacity", opacity)
                .attr("d", pathString);
            }

            // Add label only for the last (most recent) vector
            if (isLastVector && config.label) {
              const position = config.labelPosition || "end";
              const labelColor = config.labelColor || color;
              const fontSize = config.labelFontSize || 12;

              let labelPt: DataPoint;
              if (position === "start") {
                labelPt = startPt;
              } else if (position === "mid") {
                labelPt = {
                  x: (startPt.x + endPt.x) / 2,
                  y: (startPt.y + endPt.y) / 2,
                };
              } else {
                labelPt = endPt;
              }

              const offsetX = config.labelOffsetX || 10;
              const offsetY = config.labelOffsetY || -10;

              vectorGroup
                .append("text")
                .attr("x", xScale(labelPt.x) + offsetX)
                .attr("y", yScale(labelPt.y) + offsetY)
                .attr("fill", labelColor)
                .attr("font-size", fontSize)
                .text(config.label);
            }
          }
        }
        stepVectorIndex++;
      });
    }

    // Render graph-based visualizations
    if (hasGraphs) {
      // Refresh step data to ensure points update when variables change
      // (Skip if already called in vectors section above)
      if (computationStore.stepping && !hasVectors) {
        computationStore.sampleSteps();
      }

      // Process line configs into renderable data
      const graphLines: GraphLineData[] = [];
      if (lines) {
        for (const lineConfig of lines) {
          const {
            sampleId,
            parameter,
            range,
            samples = 100,
            color = "#3b82f6",
            lineWidth = PLOT2D_DEFAULTS.lineWidth,
            name,
            showInLegend = true,
          } = lineConfig;
          const resolvedRange = range ?? getVariableRange(parameter);
          const linePoints = sample2DLine(parameter, resolvedRange, samples, sampleId);
          graphLines.push({ name: name || sampleId, points: linePoints, color, lineWidth, showInLegend });
        }
      }

      // Process point configs into renderable data
      const graphPoints: GraphPointData[] = [];
      if (points) {
        for (const pointConfig of points) {
          const {
            sampleId,
            color = "#ef4444",
            size = 6,
            name,
            showInLegend = true,
            showLabel = false,
            interaction,
            stepId,
            persistence,
          } = pointConfig;
          const point = sample2DPoint(sampleId);
          graphPoints.push({
            sampleId,
            name: name || sampleId,
            point: point || { x: 0, y: 0 },
            color,
            size,
            showInLegend,
            showLabel,
            interaction,
            stepId,
            persistence,
          });
        }
      }

      // Separate regular points from step-dependent points
      const regularPoints: GraphPointData[] = [];
      const stepPoints: Array<{
        config: GraphPointData;
        accumulatedPoints: DataPoint[];
      }> = [];

      for (const pointData of graphPoints) {
        if (!pointData.stepId) {
          // No stepId - always visible as a single point
          regularPoints.push(pointData);
        } else if (computationStore.stepping) {
          // Has stepId and in stepping mode - collect accumulated points from dataPointMap
          const steps = computationStore.steps;
          const currentStepIndex = computationStore.currentStepIndex;
          const sampleId = pointData.sampleId;
          const allPoints = (computationStore.stepDataPointMap.get(sampleId) ??
            []) as unknown as DataPoint[];

          // Count how many steps with matching stepId are in range [0, currentStepIndex]
          let matchingStepCount = 0;
          for (let i = 0; i <= currentStepIndex && i < steps.length; i++) {
            if (steps[i].id === pointData.stepId) {
              matchingStepCount++;
            }
          }

          // Get accumulated points based on step progress
          const accumulatedPoints: DataPoint[] =
            pointData.persistence === false
              ? // Only show the current step's point (no persistence)
                matchingStepCount > 0 && allPoints[matchingStepCount - 1]
                ? [allPoints[matchingStepCount - 1]]
                : []
              : // Default (true): show all points up to current step
                allPoints.slice(0, matchingStepCount);

          if (accumulatedPoints.length > 0) {
            stepPoints.push({ config: pointData, accumulatedPoints });
          }
        }
        // If has stepId but not in stepping mode, point is not visible
      }

      // Generate unique clipPath id for graph elements (lines and points)
      const graphClipId = `graph-clip-${Math.random().toString(36).slice(2)}`;

      // Create clip path for graph elements
      svg
        .append("defs")
        .append("clipPath")
        .attr("id", graphClipId)
        .append("rect")
        .attr("width", plotWidth)
        .attr("height", plotHeight);

      // Create line generator
      const lineGenerator = d3
        .line<DataPoint>()
        .x((d) => xScale(d.x))
        .y((d) => yScale(d.y))
        .curve(d3.curveLinear);

      // Render graph-based lines
      graphLines.forEach((lineData, index) => {
        if (lineData.points.length > 0) {
          svg
            .append("path")
            .attr("class", `graph-line graph-line-${index}`)
            .datum(lineData.points)
            .attr("fill", "none")
            .attr("stroke", lineData.color)
            .attr("stroke-width", lineData.lineWidth)
            .attr("clip-path", `url(#${graphClipId})`)
            .attr("d", lineGenerator)
            .style("pointer-events", "none");
        }
      });

      // Create a group for points AFTER lines so points render on top
      const pointsGroup = svg.append("g").attr("class", "points-group");

      // Store point data for rendering after interaction layer
      const graphPointsData = regularPoints;

      // Add drag interaction for graph-based visualization
      // Find the first line config to use its parameter/interaction for dragging
      const lineConfig = lines?.[0];

      if (lineConfig) {
        const { parameter, interaction: lineInteraction } = lineConfig;

        // Only set up line drag if line has an interaction property
        const lineHasInteraction = !!lineInteraction;

        // Determine drag mode and variable from line interaction config (only if line has interaction)
        const isVerticalDrag = lineInteraction?.[0] === "vertical-drag";
        const dragVariable = lineInteraction?.[1] || parameter;
        const dragVarConfig = lineHasInteraction
          ? computationStore.variables.get(dragVariable)
          : null;
        const dragRange =
          dragVarConfig?.range ||
          (isVerticalDrag ? [yMin, yMax] : [xMin, xMax]);

        // Create line generator for updating line path during drag
        const lineGenerator = d3
          .line<DataPoint>()
          .x((d) => xScale(d.x))
          .y((d) => yScale(d.y))
          .curve(d3.curveLinear);

        // Track the point's x-coordinate during drag (for finding point on curve)
        let dragPointX: number | null = null;

        // Track initial values for relative drag (so clicking doesn't cause a jump)
        let dragStartMousePos: number | null = null;
        let dragStartValue: number | null = null;

        // Helper function to update line and point position during drag
        // Updates ALL lines and ALL points since shared variables may affect multiple elements
        const updatePointPosition = () => {
          // Re-sample ALL lines with current variable values (since variables may affect multiple lines)
          const lineConfigs = lines ?? [];
          const pointConfigs = points ?? [];

          // Cache line points for reuse when updating points
          const linePointsCache: Map<string, DataPoint[]> = new Map();

          lineConfigs.forEach((config, lineIndex) => {
            const {
              range,
              samples = 100,
              parameter: lineParam,
              sampleId: lineGraphId,
            } = config;
            // Get line points using sampling API
            const resolvedRange = range ?? getVariableRange(lineParam);
            const linePoints = sample2DLine(lineParam, resolvedRange, samples, lineGraphId);

            // Cache for point updates
            linePointsCache.set(lineGraphId, linePoints);

            // Update the line path
            if (linePoints.length > 0) {
              svg
                .select(`path.graph-line-${lineIndex}`)
                .attr("d", lineGenerator(linePoints));
            }
          });

          // Determine the focused point index (for tracking dragPointX on the focused point's curve)
          const focusState = focusStateRef.current;
          let focusedPointIndex: number | null = null;
          if (focusState?.type === "point") {
            focusedPointIndex = focusState.index;
          } else if (focusState?.type === "line") {
            // When dragging a line, the associated point is the one we track dragPointX for
            const focusedLineConfig = lineConfigs[focusState.index];
            if (focusedLineConfig) {
              focusedPointIndex = pointConfigs.findIndex(
                (p) => p.sampleId === focusedLineConfig.sampleId
              );
              if (focusedPointIndex < 0) focusedPointIndex = null;
            }
          }

          // Update ALL points (since shared variables may affect multiple points)
          pointConfigs.forEach((pointConfig, pointIndex) => {
            // Get cached line points for this point's associated line
            const linePoints = linePointsCache.get(pointConfig.sampleId) || [];
            let pointOnCurve: DataPoint | null = null;
            // For the focused point, use dragPointX to find position on curve
            // For other points, just run the graph once to get current position
            if (
              pointIndex === focusedPointIndex &&
              dragPointX !== null &&
              linePoints.length > 0
            ) {
              // Find the point on the curve closest to dragPointX
              let closestPoint = linePoints[0];
              let minDist = Math.abs(linePoints[0].x - dragPointX);
              for (const p of linePoints) {
                const dist = Math.abs(p.x - dragPointX);
                if (dist < minDist) {
                  minDist = dist;
                  closestPoint = p;
                }
              }
              pointOnCurve = closestPoint;
            } else {
              // For non-focused points or when not tracking, use current values
              const point = sample2DPoint(pointConfig.sampleId);
              if (point) {
                pointOnCurve = point;
                // Initialize dragPointX for focused point if needed
                if (pointIndex === focusedPointIndex && dragPointX === null) {
                  dragPointX = point.x;
                }
              }
            }

            if (!pointOnCurve) {
              return;
            }

            const newCx = xScale(pointOnCurve.x);
            const newCy = yScale(pointOnCurve.y);

            // Check if point is within bounds
            const isInBounds =
              pointOnCurve.x >= xMin &&
              pointOnCurve.x <= xMax &&
              pointOnCurve.y >= yMin &&
              pointOnCurve.y <= yMax;

            // Update circle and hit area positions and visibility
            d3.select(`#graph-point-${pointIndex}`)
              .attr("cx", newCx)
              .attr("cy", newCy)
              .style("display", isInBounds ? "" : "none");
            d3.select(`#graph-point-hit-${pointIndex}`)
              .attr("cx", newCx)
              .attr("cy", newCy)
              .style("display", isInBounds ? "" : "none");

            // Hide label during drag for performance (will redraw after drag ends)
            svg
              .select(`rect.graph-point-label-bg-${pointIndex}`)
              .style("display", "none");
            svg
              .select(`text.graph-point-label-${pointIndex}`)
              .style("display", "none");
          });

          // Also update step points (points with stepId) during drag
          // These need to be recomputed from stepDataPointMap since their positions
          // depend on the semantics function which re-runs when variables change
          if (computationStore.stepping) {
            pointConfigs.forEach((pointConfig, stepPointIndex) => {
              if (!pointConfig.stepId) return; // Skip non-step points

              const sampleId = pointConfig.sampleId;
              const allPoints = (computationStore.stepDataPointMap.get(
                sampleId
              ) ?? []) as unknown as DataPoint[];

              // Count matching steps up to current step
              const steps = computationStore.steps;
              const currentStepIndex = computationStore.currentStepIndex;
              let matchingStepCount = 0;
              for (let i = 0; i <= currentStepIndex && i < steps.length; i++) {
                if (steps[i].id === pointConfig.stepId) {
                  matchingStepCount++;
                }
              }

              // Get accumulated points
              const accumulatedPoints: DataPoint[] =
                pointConfig.persistence === false
                  ? matchingStepCount > 0 && allPoints[matchingStepCount - 1]
                    ? [allPoints[matchingStepCount - 1]]
                    : []
                  : allPoints.slice(0, matchingStepCount);

              // Update each step point's position and visibility
              accumulatedPoints.forEach((pt, ptIndex) => {
                const pointId = `step-point-${stepPointIndex}-${ptIndex}`;
                const isInBounds =
                  pt.x >= xMin &&
                  pt.x <= xMax &&
                  pt.y >= yMin &&
                  pt.y <= yMax;

                if (isInBounds) {
                  const newCx = xScale(pt.x);
                  const newCy = yScale(pt.y);

                  svg
                    .select(`#${pointId}`)
                    .attr("cx", newCx)
                    .attr("cy", newCy)
                    .style("display", "");
                  svg
                    .select(`#${pointId}-hit`)
                    .attr("cx", newCx)
                    .attr("cy", newCy)
                    .style("display", "");
                } else {
                  // Hide points that are out of bounds
                  svg.select(`#${pointId}`).style("display", "none");
                  svg.select(`#${pointId}-hit`).style("display", "none");
                }
              });
            });

            // Also update step vectors during drag
            // Refresh step data first to get updated positions
            computationStore.sampleSteps();

            const vectorConfigs = vectors ?? [];
            // Count non-step vectors to get the starting index (matching render logic)
            const regularVectorCount = vectorConfigs.filter(v => !v.stepId).length;
            let stepVectorIdx = regularVectorCount;

            vectorConfigs.forEach((vectorConfig) => {
              if (!vectorConfig.stepId) return; // Skip non-step vectors

              const startSampleId = vectorConfig.startSampleId;
              const endSampleId = vectorConfig.endSampleId;
              const allStartPoints = (computationStore.stepDataPointMap.get(
                startSampleId
              ) ?? []) as unknown as DataPoint[];
              const allEndPoints = (computationStore.stepDataPointMap.get(
                endSampleId
              ) ?? []) as unknown as DataPoint[];

              // Count matching steps up to current step
              const steps = computationStore.steps;
              const currentStepIndex = computationStore.currentStepIndex;
              let matchingStepCount = 0;
              for (let i = 0; i <= currentStepIndex && i < steps.length; i++) {
                if (steps[i].id === vectorConfig.stepId) {
                  matchingStepCount++;
                }
              }

              // Get accumulated points
              const accumulatedStartPoints: DataPoint[] =
                vectorConfig.persistence === false
                  ? matchingStepCount > 0 && allStartPoints[matchingStepCount - 1]
                    ? [allStartPoints[matchingStepCount - 1]]
                    : []
                  : allStartPoints.slice(0, matchingStepCount);

              const accumulatedEndPoints: DataPoint[] =
                vectorConfig.persistence === false
                  ? matchingStepCount > 0 && allEndPoints[matchingStepCount - 1]
                    ? [allEndPoints[matchingStepCount - 1]]
                    : []
                  : allEndPoints.slice(0, matchingStepCount);

              const curvature = vectorConfig.curved ?? 0;
              const minLength = Math.min(accumulatedStartPoints.length, accumulatedEndPoints.length);

              // Update each step vector's path
              for (let ptIndex = 0; ptIndex < minLength; ptIndex++) {
                const startPt = accumulatedStartPoints[ptIndex];
                const endPt = accumulatedEndPoints[ptIndex];

                if (startPt && endPt) {
                  const vectorId = `step-vector-${stepVectorIdx}-${ptIndex}`;
                  const startScreen = { x: xScale(startPt.x), y: yScale(startPt.y) };
                  const endScreen = { x: xScale(endPt.x), y: yScale(endPt.y) };

                  // Generate curved path
                  let pathString: string;
                  if (curvature === 0) {
                    pathString = `M ${startScreen.x} ${startScreen.y} L ${endScreen.x} ${endScreen.y}`;
                  } else {
                    const midX = (startScreen.x + endScreen.x) / 2;
                    const midY = (startScreen.y + endScreen.y) / 2;
                    const dx = endScreen.x - startScreen.x;
                    const dy = endScreen.y - startScreen.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    if (length === 0) {
                      pathString = `M ${startScreen.x} ${startScreen.y} L ${endScreen.x} ${endScreen.y}`;
                    } else {
                      const normalX = -dy / length;
                      const normalY = dx / length;
                      const offset = curvature * length * 0.5;
                      const controlX = midX + normalX * offset;
                      const controlY = midY + normalY * offset;
                      pathString = `M ${startScreen.x} ${startScreen.y} Q ${controlX} ${controlY} ${endScreen.x} ${endScreen.y}`;
                    }
                  }

                  svg.select(`#${vectorId}`).attr("d", pathString);
                }
              }

              stepVectorIdx++;
            });
          }
        };

        // Use refs for state so it persists across re-renders (closure fix)
        let rafId: number | null = null;
        let pendingValue: number | null = null;

        const processDrag = () => {
          if (pendingValue !== null) {
            computationStore.setValue(dragVariable, pendingValue);
            updatePointPosition();
            pendingValue = null;
          }
          rafId = null;
        };

        const scheduleDragUpdate = (value: number) => {
          pendingValue = value;
          if (rafId === null) {
            rafId = requestAnimationFrame(processDrag);
          }
        };

        const endDrag = () => {
          // Always reset isLocalDragRef to ensure reaction tracks variables properly
          // even if isDraggingRef was somehow already false
          const wasDragging = isDraggingRef.current;
          isDraggingRef.current = false;
          isLocalDragRef.current = false;

          if (wasDragging) {
            dragPointX = null; // Reset tracked point position
            dragStartMousePos = null; // Reset relative drag tracking
            dragStartValue = null;
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            if (pendingValue !== null) {
              computationStore.setValue(dragVariable, pendingValue);
              pendingValue = null;
            }
            computationStore.setDragging(false);
            drawPlot();
          }
        };

        const updateCursors = () => {
          const focusState = focusStateRef.current;

          // Reset all lines and points first
          graphLines.forEach((lineData, i) => {
            svg
              .select(`path.graph-line-${i}`)
              .attr("stroke-width", lineData.lineWidth)
              .attr("filter", null);
          });
          graphPointsData.forEach((_, i) => {
            d3.select(`#graph-point-${i}`).attr("r", 6).attr("filter", null);
            d3.select(`#graph-point-hit-${i}`).style("cursor", "pointer");
          });

          if (focusState?.type === "line" && lineHasInteraction) {
            const lineIndex = focusState.index;
            interactionRect.style(
              "cursor",
              isVerticalDrag ? "ns-resize" : "ew-resize"
            );
            // Add a visual indicator without changing the configured line width
            svg
              .select(`path.graph-line-${lineIndex}`)
              .attr("filter", "drop-shadow(0 0 3px rgba(59, 130, 246, 0.5))");
          } else if (focusState?.type === "point") {
            const pointIndex = focusState.index;
            interactionRect.style("cursor", "default");
            d3.select(`#graph-point-hit-${pointIndex}`).style("cursor", "grab");
            // Add visual indicator for focused point
            d3.select(`#graph-point-${pointIndex}`)
              .attr("r", 8)
              .attr("filter", "drop-shadow(0 0 4px rgba(59, 130, 246, 0.7))");
          } else {
            // Unfocused - show pointer only if line has interaction, otherwise default
            interactionRect.style(
              "cursor",
              lineHasInteraction ? "pointer" : "default"
            );
          }
        };

        const unfocus = () => {
          focusStateRef.current = null;
          updateCursors();
        };

        // Create interaction rect (rendered first, under points)
        // Only enable pointer events if line has interaction OR any point has interaction
        const anyPointHasInteraction = graphPointsData.some(
          (p) => !!p.interaction
        );
        const interactionRect = svg
          .append("rect")
          .attr("class", "graph-interaction-rect nodrag")
          .attr("width", plotWidth)
          .attr("height", plotHeight)
          .style("fill", "none")
          .style(
            "pointer-events",
            lineHasInteraction || anyPointHasInteraction ? "all" : "none"
          )
          .style("cursor", lineHasInteraction ? "pointer" : "default");

        // Helper to clean up any existing global listeners before adding new ones
        const cleanupGlobalListeners = () => {
          if (globalMouseMoveRef.current) {
            document.removeEventListener(
              "mousemove",
              globalMouseMoveRef.current
            );
            globalMouseMoveRef.current = null;
          }
          if (globalMouseUpRef.current) {
            document.removeEventListener("mouseup", globalMouseUpRef.current);
            globalMouseUpRef.current = null;
          }
        };

        // Global mouse move handler for dragging (only used if line has interaction)
        // Uses relative drag - calculates delta from initial position
        // Maps pixel movement proportionally to the drag variable's range (not axis range)
        const handleGlobalMouseMove = (event: MouseEvent) => {
          if (!isDraggingRef.current || !lineHasInteraction) return;
          if (dragStartMousePos === null || dragStartValue === null) return;
          const [mouseX, mouseY] = plotPointer(event);

          // Calculate pixel delta and convert to variable range proportionally
          const variableRange = dragRange[1] - dragRange[0];
          let pixelDelta: number;
          let delta: number;

          if (isVerticalDrag) {
            // Vertical: moving up (negative pixel delta) should increase value
            pixelDelta = dragStartMousePos - mouseY;
            // Map pixel movement to variable range (full plot height = full variable range)
            delta = (pixelDelta / plotHeight) * variableRange;
          } else {
            // Horizontal: moving right (positive pixel delta) should increase value
            pixelDelta = mouseX - dragStartMousePos;
            delta = (pixelDelta / plotWidth) * variableRange;
          }

          const newValue = dragStartValue + delta;
          const clampedValue = Math.max(
            dragRange[0],
            Math.min(dragRange[1], newValue)
          );
          scheduleDragUpdate(clampedValue);
        };

        const handleGlobalMouseUp = () => {
          cleanupGlobalListeners();
          if (focusStateRef.current?.type === "point") {
            const pointIndex = focusStateRef.current.index;
            d3.select(`#graph-point-hit-${pointIndex}`).style("cursor", "grab");
          }
          endDrag();
        };

        // Helper to find which line is closest to click position
        // Returns the index of the closest line with interaction, or -1 if none
        // is within reach (in the plot's own units)
        const findClosestLine = (
          mouseX: number,
          mouseY: number,
          reach = 30
        ): number => {
          const lineConfigs = lines ?? [];
          let closestLineIndex = -1;
          let minDistance = Infinity;

          lineConfigs.forEach((config, lineIndex) => {
            // Only consider lines with interaction
            if (!config.interaction) return;

            const {
              range,
              samples = 100,
              parameter: lineParam,
              sampleId: lineGraphId,
            } = config;
            // Get line points using sampling API
            const resolvedRange = range ?? getVariableRange(lineParam);
            const linePoints = sample2DLine(lineParam, resolvedRange, samples, lineGraphId);

            // Find minimum distance from click to any point on this line
            for (const point of linePoints) {
              const px = xScale(point.x);
              const py = yScale(point.y);
              const dist = Math.sqrt((px - mouseX) ** 2 + (py - mouseY) ** 2);
              if (dist < minDistance) {
                minDistance = dist;
                closestLineIndex = lineIndex;
              }
            }
          });

          // Only return if within a reasonable threshold (e.g., 30 pixels)
          return minDistance < reach ? closestLineIndex : -1;
        };

        // Interaction rect handles line focus and line dragging (only if line has interaction)
        // A finger drags a line in one go: a touch that starts on a line
        // focuses it, taking the focus from a point that had it, and the
        // press that follows drags it. Touches anywhere else on the plot are
        // left alone, even with a line focused, so they can scroll the page
        // or, on a canvas that pans, move and zoom the canvas.
        const interactionRectNode = interactionRect.node();
        if (interactionRectNode && lineHasInteraction) {
          enableTouchDrag(interactionRectNode, {
            when: (touch) => {
              const [touchX, touchY] = plotPointer(touch);
              // A finger reaches 30px on the screen, however far the canvas
              // is zoomed out
              const touchedLineIndex = findClosestLine(
                touchX,
                touchY,
                Math.max(30, 30 / plotScale())
              );
              if (touchedLineIndex < 0) return false;
              focusStateRef.current = { type: "line", index: touchedLineIndex };
              updateCursors();
              return true;
            },
          });
        }
        interactionRect.on("mousedown", (event: MouseEvent) => {
          event.preventDefault();

          // If line doesn't have interaction, only handle unfocusing point
          if (!lineHasInteraction) {
            if (focusStateRef.current?.type === "point") {
              unfocus();
            }
            return;
          }

          const [mouseX, mouseY] = plotPointer(event);

          if (focusStateRef.current === null) {
            // First click: find and focus the closest line
            const closestLineIndex = findClosestLine(mouseX, mouseY);
            if (closestLineIndex >= 0) {
              focusStateRef.current = { type: "line", index: closestLineIndex };
              updateCursors();
            }
            // If no line is close enough, don't focus anything
          } else if (focusStateRef.current.type === "line") {
            // Check if user clicked on a different line
            const closestLineIndex = findClosestLine(mouseX, mouseY);
            if (
              closestLineIndex >= 0 &&
              closestLineIndex !== focusStateRef.current.index
            ) {
              // Switch focus to the new line
              focusStateRef.current = { type: "line", index: closestLineIndex };
              updateCursors();
              return; // Don't start dragging yet, just switch focus
            }
            // Already focused on line: start dragging
            isDraggingRef.current = true;
            isLocalDragRef.current = true;
            computationStore.setDragging(true);

            // Capture initial mouse position and variable value for relative drag
            // mouseX, mouseY already captured above
            dragStartMousePos = isVerticalDrag ? mouseY : mouseX;
            dragStartValue =
              (computationStore.variables.get(dragVariable)?.value as number) ??
              0;

            // Clean up any stale listeners before adding new ones
            cleanupGlobalListeners();
            // Store references and add listeners
            globalMouseMoveRef.current = handleGlobalMouseMove;
            globalMouseUpRef.current = handleGlobalMouseUp;
            document.addEventListener("mousemove", handleGlobalMouseMove);
            document.addEventListener("mouseup", handleGlobalMouseUp);
            // Don't set value immediately - wait for actual mouse movement
          } else if (focusStateRef.current.type === "point") {
            // Clicking on line area while point is focused: unfocus
            unfocus();
          }
        });

        // Render points ON TOP of interaction rect
        graphPointsData.forEach((pointData, index) => {
          const { point, color, interaction: pointInteraction } = pointData;

          // Only calculate drag config if point has its own interaction
          // Points without interaction are display-only (not draggable)
          const pointIsVerticalDrag = pointInteraction
            ? pointInteraction[0] === "vertical-drag"
            : false;
          const pointDragVariable = pointInteraction ? pointInteraction[1] : "";
          const pointDragVarConfig = pointInteraction
            ? computationStore.variables.get(pointDragVariable)
            : null;
          const pointDragRange =
            pointDragVarConfig?.range ||
            (pointIsVerticalDrag ? [yMin, yMax] : [xMin, xMax]);

          if (
            point.x >= xMin &&
            point.x <= xMax &&
            point.y >= yMin &&
            point.y <= yMax
          ) {
            // Create invisible larger hit area for easier clicking (only if point has interaction)
            const hitArea = svg
              .append("circle")
              .attr("id", `graph-point-hit-${index}`)
              .attr("class", `graph-point-hit graph-point-hit-${index}`)
              .attr("cx", xScale(point.x))
              .attr("cy", yScale(point.y))
              .attr("r", pointInteraction ? 20 : 0) // Large hit area only if interactive
              .attr("fill", "transparent")
              .style("pointer-events", pointInteraction ? "all" : "none")
              .style("cursor", pointInteraction ? "pointer" : "default");

            // Visual point circle (hit area handles clicks)
            pointsGroup
              .append("circle")
              .attr("id", `graph-point-${index}`)
              .attr("class", `graph-point graph-point-${index} current-point`)
              .attr("cx", xScale(point.x))
              .attr("cy", yScale(point.y))
              .attr("r", 6)
              .attr("fill", color)
              .attr("stroke", "#fff")
              .attr("stroke-width", 2)
              .style("pointer-events", "none");

            // Point click handler (on hit area for easier clicking) - only if point has interaction
            if (pointInteraction) {
              // Track initial values for relative point drag
              let pointDragStartMousePos: number | null = null;
              let pointDragStartValue: number | null = null;

              // Create point-specific mouse move handler that uses point's interaction config
              // Uses relative drag - calculates delta from initial position
              // For points, use AXIS range so the point visually tracks the mouse position
              // (This differs from line drag which uses variable range for full range access)
              const handlePointMouseMove = (event: MouseEvent) => {
                if (!isDraggingRef.current) return;
                if (
                  pointDragStartMousePos === null ||
                  pointDragStartValue === null
                )
                  return;
                const [mouseX, mouseY] = plotPointer(event);

                // Calculate pixel delta and convert to AXIS range proportionally
                // This makes the point visually track the mouse position
                const axisRange = pointIsVerticalDrag
                  ? yMax - yMin
                  : xMax - xMin;
                let pixelDelta: number;
                let delta: number;

                if (pointIsVerticalDrag) {
                  // Vertical: moving up (negative pixel delta) should increase value
                  pixelDelta = pointDragStartMousePos - mouseY;
                  delta = (pixelDelta / plotHeight) * axisRange;
                } else {
                  // Horizontal: moving right (positive pixel delta) should increase value
                  pixelDelta = mouseX - pointDragStartMousePos;
                  delta = (pixelDelta / plotWidth) * axisRange;
                }

                const newValue = pointDragStartValue + delta;
                // Still clamp to the variable's range (not axis range) to prevent invalid values
                const clampedValue = Math.max(
                  pointDragRange[0],
                  Math.min(pointDragRange[1], newValue)
                );
                // Update the drag variable and point position
                computationStore.setValue(pointDragVariable, clampedValue);
                // For horizontal drag (changing x-position), update dragPointX
                if (!pointIsVerticalDrag) {
                  dragPointX = clampedValue;
                }
                updatePointPosition();
              };

              const handlePointMouseUp = () => {
                cleanupGlobalListeners();
                // Reset point drag start tracking
                pointDragStartMousePos = null;
                pointDragStartValue = null;
                if (focusStateRef.current?.type === "point") {
                  d3.select(
                    `#graph-point-hit-${focusStateRef.current.index}`
                  ).style("cursor", "grab");
                }
                endDrag();
              };

              const hitAreaNode = hitArea.node();
              if (hitAreaNode) enableTouchDrag(hitAreaNode);
              hitArea.on("mousedown", (event: MouseEvent) => {
                event.stopPropagation();
                event.preventDefault();

                // Capture the point's x-coordinate for tracking during drag
                dragPointX = point.x;

                // Capture initial mouse position and variable value for relative drag
                const [mouseX, mouseY] = plotPointer(event);
                pointDragStartMousePos = pointIsVerticalDrag ? mouseY : mouseX;
                pointDragStartValue =
                  (computationStore.variables.get(pointDragVariable)
                    ?.value as number) ?? 0;

                if (
                  focusStateRef.current === null ||
                  focusStateRef.current?.type === "line"
                ) {
                  // First click or switching from line: focus this point AND prepare for drag
                  focusStateRef.current = { type: "point", index };
                  updateCursors();

                  // Start drag immediately so user can click-and-drag in one motion
                  isDraggingRef.current = true;
                  isLocalDragRef.current = true;
                  computationStore.setDragging(true);
                  hitArea.style("cursor", "grabbing");

                  // Clean up any stale listeners before adding new ones
                  cleanupGlobalListeners();
                  // Store references and add listeners
                  globalMouseMoveRef.current = handlePointMouseMove;
                  globalMouseUpRef.current = handlePointMouseUp;
                  document.addEventListener("mousemove", handlePointMouseMove);
                  document.addEventListener("mouseup", handlePointMouseUp);
                  // Don't set value immediately - wait for actual mouse movement
                } else if (focusStateRef.current?.type === "point") {
                  // Already focused on a point: focus this point and start dragging
                  focusStateRef.current = { type: "point", index };
                  updateCursors();

                  isDraggingRef.current = true;
                  isLocalDragRef.current = true;
                  computationStore.setDragging(true);
                  hitArea.style("cursor", "grabbing");

                  // Clean up any stale listeners before adding new ones
                  cleanupGlobalListeners();
                  // Store references and add listeners
                  globalMouseMoveRef.current = handlePointMouseMove;
                  globalMouseUpRef.current = handlePointMouseUp;
                  document.addEventListener("mousemove", handlePointMouseMove);
                  document.addEventListener("mouseup", handlePointMouseUp);
                  // Don't set value immediately - wait for actual mouse movement
                }
              });
            }

            // Add label with background if enabled
            if (pointData.showLabel) {
              const labelX = xScale(point.x) + 10;
              const labelY = yScale(point.y) - 10;
              const labelText = `x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}`;

              const tempText = svg
                .append("text")
                .attr("font-size", "14px")
                .attr("font-family", "Arial, sans-serif")
                .attr("font-weight", "500")
                .text(labelText)
                .style("visibility", "hidden");

              const tempTextNode = tempText.node() as SVGTextElement;
              const bbox = tempTextNode?.getBBox();
              tempText.remove();

              if (bbox) {
                const rectHeight = bbox.height + 8;
                const rectY = labelY - bbox.height - 4;
                const centeredTextY = rectY + rectHeight / 2 + bbox.height / 3;

                svg
                  .append("rect")
                  .attr(
                    "class",
                    `graph-point-label-bg graph-point-label-bg-${index}`
                  )
                  .attr("x", labelX - 8)
                  .attr("y", rectY)
                  .attr("width", bbox.width + 16)
                  .attr("height", rectHeight)
                  .attr("fill", "white")
                  .attr("stroke", "#e2e8f0")
                  .attr("stroke-width", 1)
                  .attr("rx", 6);

                svg
                  .append("text")
                  .attr("class", `graph-point-label graph-point-label-${index}`)
                  .attr("x", labelX)
                  .attr("y", centeredTextY)
                  .attr("fill", "#000")
                  .attr("text-anchor", "start")
                  .attr("font-size", "14px")
                  .attr("font-family", "Arial, sans-serif")
                  .attr("font-weight", "500")
                  .text(labelText);
              }
            }
          }
        });

        // Restore visual focus state after re-render (if focus was maintained)
        if (focusStateRef.current !== null) {
          updateCursors();
        }
      } else {
        // No line config - render points without interaction
        graphPointsData.forEach((pointData, index) => {
          const { point, color } = pointData;

          if (
            point.x >= xMin &&
            point.x <= xMax &&
            point.y >= yMin &&
            point.y <= yMax
          ) {
            pointsGroup
              .append("circle")
              .attr("class", `graph-point graph-point-${index} current-point`)
              .attr("cx", xScale(point.x))
              .attr("cy", yScale(point.y))
              .attr("r", 6)
              .attr("fill", color)
              .attr("stroke", "#fff")
              .attr("stroke-width", 2);

            if (pointData.showLabel) {
              const labelX = xScale(point.x) + 10;
              const labelY = yScale(point.y) - 10;
              const labelText = `x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}`;

              const tempText = svg
                .append("text")
                .attr("font-size", "14px")
                .attr("font-family", "Arial, sans-serif")
                .attr("font-weight", "500")
                .text(labelText)
                .style("visibility", "hidden");

              const tempTextNode = tempText.node() as SVGTextElement;
              const bbox = tempTextNode?.getBBox();
              tempText.remove();

              if (bbox) {
                const rectHeight = bbox.height + 8;
                const rectY = labelY - bbox.height - 4;
                const centeredTextY = rectY + rectHeight / 2 + bbox.height / 3;

                svg
                  .append("rect")
                  .attr(
                    "class",
                    `graph-point-label-bg graph-point-label-bg-${index}`
                  )
                  .attr("x", labelX - 8)
                  .attr("y", rectY)
                  .attr("width", bbox.width + 16)
                  .attr("height", rectHeight)
                  .attr("fill", "white")
                  .attr("stroke", "#e2e8f0")
                  .attr("stroke-width", 1)
                  .attr("rx", 6);

                svg
                  .append("text")
                  .attr("class", `graph-point-label graph-point-label-${index}`)
                  .attr("x", labelX)
                  .attr("y", centeredTextY)
                  .attr("fill", "#000")
                  .attr("text-anchor", "start")
                  .attr("font-size", "14px")
                  .attr("font-family", "Arial, sans-serif")
                  .attr("font-weight", "500")
                  .text(labelText);
              }
            }
          }
        });
      }

      // Render accumulated step points (points with stepId that collect from multiple steps)
      stepPoints.forEach(({ config, accumulatedPoints }, stepPointIndex) => {
        const { color, size = 6, interaction: stepPointInteraction } = config;

        // Set up interaction config if the step point has an interaction property
        const stepPointIsVerticalDrag = stepPointInteraction
          ? stepPointInteraction[0] === "vertical-drag"
          : false;
        const stepPointDragVariable = stepPointInteraction
          ? stepPointInteraction[1]
          : "";
        const stepPointDragVarConfig = stepPointInteraction
          ? computationStore.variables.get(stepPointDragVariable)
          : null;
        const stepPointDragRange =
          stepPointDragVarConfig?.range ||
          (stepPointIsVerticalDrag ? [yMin, yMax] : [xMin, xMax]);

        accumulatedPoints.forEach((pt, ptIndex) => {
          if (pt.x >= xMin && pt.x <= xMax && pt.y >= yMin && pt.y <= yMax) {
            const isLastPoint = ptIndex === accumulatedPoints.length - 1;
            const pointId = `step-point-${stepPointIndex}-${ptIndex}`;

            // Only make the most recent point interactive (if interaction is configured)
            const isInteractive = stepPointInteraction && isLastPoint;

            if (isInteractive) {
              // Create invisible larger hit area for easier clicking
              const stepHitArea = svg
                .append("circle")
                .attr("id", `${pointId}-hit`)
                .attr("class", `step-point-hit ${pointId}-hit`)
                .attr("cx", xScale(pt.x))
                .attr("cy", yScale(pt.y))
                .attr("r", 20)
                .attr("fill", "transparent")
                .style("pointer-events", "all")
                .style("cursor", "pointer");

              // Track initial values for relative point drag
              let stepPointDragStartMousePos: number | null = null;
              let stepPointDragStartValue: number | null = null;

              const handleStepPointMouseMove = (event: MouseEvent) => {
                if (!isDraggingRef.current) return;
                if (
                  stepPointDragStartMousePos === null ||
                  stepPointDragStartValue === null
                )
                  return;
                const [mouseX, mouseY] = plotPointer(event);

                const axisRange = stepPointIsVerticalDrag
                  ? yMax - yMin
                  : xMax - xMin;
                let pixelDelta: number;
                let delta: number;

                if (stepPointIsVerticalDrag) {
                  pixelDelta = stepPointDragStartMousePos - mouseY;
                  delta = (pixelDelta / plotHeight) * axisRange;
                } else {
                  pixelDelta = mouseX - stepPointDragStartMousePos;
                  delta = (pixelDelta / plotWidth) * axisRange;
                }

                const newValue = stepPointDragStartValue + delta;
                const clampedValue = Math.max(
                  stepPointDragRange[0],
                  Math.min(stepPointDragRange[1], newValue)
                );
                computationStore.setValue(stepPointDragVariable, clampedValue);
              };

              // Helper to clean up global listeners for step point drag
              const cleanupStepPointListeners = () => {
                if (globalMouseMoveRef.current) {
                  document.removeEventListener(
                    "mousemove",
                    globalMouseMoveRef.current
                  );
                  globalMouseMoveRef.current = null;
                }
                if (globalMouseUpRef.current) {
                  document.removeEventListener(
                    "mouseup",
                    globalMouseUpRef.current
                  );
                  globalMouseUpRef.current = null;
                }
              };

              const handleStepPointMouseUp = () => {
                cleanupStepPointListeners();
                stepPointDragStartMousePos = null;
                stepPointDragStartValue = null;
                stepHitArea.style("cursor", "grab");
                // End drag state
                isDraggingRef.current = false;
                computationStore.setDragging(false);
              };

              const stepHitAreaNode = stepHitArea.node();
              if (stepHitAreaNode) enableTouchDrag(stepHitAreaNode);
              stepHitArea.on("mousedown", (event: MouseEvent) => {
                event.stopPropagation();
                event.preventDefault();

                const [mouseX, mouseY] = plotPointer(event);
                stepPointDragStartMousePos = stepPointIsVerticalDrag
                  ? mouseY
                  : mouseX;
                stepPointDragStartValue =
                  (computationStore.variables.get(stepPointDragVariable)
                    ?.value as number) ?? 0;

                isDraggingRef.current = true;
                // Don't set isLocalDragRef for step points - let MobX reaction handle redraws
                // This ensures the graph lines and step points update live during drag
                computationStore.setDragging(true);
                stepHitArea.style("cursor", "grabbing");

                cleanupStepPointListeners();
                globalMouseMoveRef.current = handleStepPointMouseMove;
                globalMouseUpRef.current = handleStepPointMouseUp;
                document.addEventListener("mousemove", handleStepPointMouseMove);
                document.addEventListener("mouseup", handleStepPointMouseUp);
              });
            }

            // Visual point circle
            pointsGroup
              .append("circle")
              .attr("id", pointId)
              .attr("class", `step-point ${pointId}`)
              .attr("cx", xScale(pt.x))
              .attr("cy", yScale(pt.y))
              .attr("r", size)
              .attr("fill", color)
              .attr("stroke", "#fff")
              .attr("stroke-width", 2)
              .attr("opacity", isLastPoint ? 1 : 0.7)
              .style("pointer-events", "none");
          }
        });
      });
    }

    // Note: Hover lines for variables removed - labels are now purely cosmetic
  }, [
    vectors,
    lines,
    points,
    plotWidth,
    plotHeight,
    margin,
    xMin,
    xMax,
    yMin,
    yMax,
    xAxisLabel,
    yAxisLabel,
    xAxisVar,
    yAxisVar,
    xLabelPos,
    yLabelPos,
    xAxisInterval,
    yAxisInterval,
    xAxisPos,
    yAxisPos,
    xGrid,
    yGrid,
    interaction,
    computationStore,
  ]);

  // Set up reaction to re-render when any variable changes
  useEffect(() => {
    // Guard: computationStore must be available
    if (!computationStore) return;

    const hasGraphs = (lines?.length ?? 0) > 0 || (points?.length ?? 0) > 0;

    const disposer = reaction(
      () => {
        // ALWAYS track all variables to maintain proper MobX dependency tracking
        // This ensures the reaction fires when any variable changes, even after local drag ends
        const allVariables: Record<string, number | boolean | string> = {};
        for (const [id, variable] of computationStore.variables.entries()) {
          const value = variable.value;
          allVariables[id] = typeof value === "number" ? value : 0;
        }

        // Always track isDragging for proper state management
        allVariables._isDragging = computationStore.isDragging;
        // Track step state for step-dependent point visibility
        allVariables._stepping = computationStore.stepping;
        allVariables._currentStepIndex = computationStore.currentStepIndex;
        allVariables._stepsLength = computationStore.steps.length;
        // Include local drag state as a marker (not for MobX tracking, just for effect logic)
        // We read the ref here to include it in the returned data
        const localDragActive = isLocalDragRef.current;
        return { ...allVariables, _isLocalDrag: localDragActive };
      },
      (data: Record<string, unknown>) => {
        const isLocalDrag = data._isLocalDrag as boolean;
        const isDragging = data._isDragging as boolean;

        // During active local drag, skip redraw - DOM manipulation handles updates
        if (isLocalDrag && isDragging) {
          return;
        }

        // If local drag just ended (marker says local but store says not dragging),
        // ensure refs are reset
        if (isLocalDrag && !isDragging) {
          isLocalDragRef.current = false;
          isDraggingRef.current = false;
        }

        // Safeguard: If local drag ref is stuck true but computationStore says we're not dragging,
        // this is an inconsistent state (e.g., mouseup was missed). Reset it.
        if (isLocalDragRef.current && !computationStore.isDragging) {
          isLocalDragRef.current = false;
          isDraggingRef.current = false;
        }

        // Re-render if not dragging OR if using custom interaction OR if using graphs
        const shouldDraw =
          !computationStore.isDragging || interaction || hasGraphs;
        if (shouldDraw) {
          drawPlot();
        }
      },
      { fireImmediately: true }
    );

    return () => disposer();
  }, [drawPlot, interaction, lines, points, computationStore]);

  // Clean up global event listeners on unmount
  useEffect(() => {
    return () => {
      if (globalMouseMoveRef.current) {
        document.removeEventListener("mousemove", globalMouseMoveRef.current);
      }
      if (globalMouseUpRef.current) {
        document.removeEventListener("mouseup", globalMouseUpRef.current);
      }
    };
  }, []);

  // Re-draw when config changes
  useEffect(() => {
    drawPlot();
  }, [config, drawPlot]);

  // Guard: computationStore must be provided - placed after all hooks
  if (!computationStore) {
    return <div className="plot2d-loading">Loading plot...</div>;
  }

  return (
    <div className="mn-plot2d" style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
          overflow: "visible",
        }}
      />
      <AxisLabels
        labelInfo={axisLabelInfo}
        xAxisHovered={
          xAxisVar
            ? computationStore.isVariableHighlighted(xAxisVar)
            : axisLabelInfo.xLabel?.allXVariables.some((varId) =>
                computationStore.isVariableHighlighted(varId)
              ) || false
        }
        yAxisHovered={
          yAxisVar
            ? computationStore.isVariableHighlighted(yAxisVar)
            : axisLabelInfo.yLabel?.allYVariables.some((varId) =>
                computationStore.isVariableHighlighted(varId)
              ) || false
        }
      />
      <div ref={tooltipRef} className="tooltip" />
    </div>
  );
});

export default Plot2D;
