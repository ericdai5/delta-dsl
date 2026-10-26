import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { reaction } from "mobx";
import { observer } from "mobx-react-lite";

import {
  Edge,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ComputationStore } from "../store/computation";
import { debugStore } from "../store/debug";
import { IControls } from "../types/control";
import { IEnvironment } from "../types/environment";
import { computeLabelVariableEdges } from "../util/canvas/edges";
import {
  addLabelNodes as addLabelNodesUtil,
  adjustLabelPositions as adjustLabelPositionsUtil,
  updateAllLabelNodes as updateAllLabelNodesUtil,
} from "../util/canvas/label-node";
import {
  NODE_TYPES,
  checkAllNodesMeasured,
  getFormulaNodes,
  getLabelNodes,
  positionAndShowstepNodes,
} from "../util/canvas/node-helpers";
import { addstepNodes as addstepNodesUtil } from "../util/canvas/step-node";
import {
  useAddVariableNodes,
  useUpdateVariableNodes,
} from "../util/canvas/variable-nodes";
import { CanvasControls } from "./canvas-controls";
import { nodeTypes as defaultNodeTypes } from "./nodes/node";
import BayesProbabilityChart from "../visualizations/custom/components/bayes-probability-chart";

interface CanvasProps {
  controls?: IControls[];
  environment?: IEnvironment;
  computationStore: ComputationStore;
}

const BAYES_EXAMPLE_ID = "bayesWithCustomVisualization";
const BAYES_FORMULA_ID = "bayes-theorem";

// Space between the widest formula and the graphs placed beside it.
const VISUALIZATION_GAP = 80;

const isVisualizationNode = (node: Node) =>
  node.type === "graph" || node.id === "bayes-chart";

const CanvasFlow = observer(
  ({ controls, environment, computationStore }: CanvasProps) => {
    // Toggle state for showing all drag handles
    const [showGrips, setShowGrips] = useState(false);
    const toggleGrips = useCallback(() => setShowGrips((prev) => !prev), []);

    // Ref for the canvas container to observe size changes
    const canvasContainerRef = useRef<HTMLDivElement>(null);

    // Tracks completion of the variable/label bootstrap pipeline
    const bootstrapCompleteRef = useRef(false);

    // Track if initial fitView has been called to prevent re-fitting on every render
    const initialFitViewCalledRef = useRef(false);

    // Track if graphs have been placed beside the measured formulas
    const visualizationsPlacedRef = useRef(false);

    // Track pending label update animation frame (outside useEffect for persistence)
    const labelUpdateFrameRef = useRef<number | null>(null);
    // Track nested animation frame for label/step node rebuild
    const labelRebuildFrameRef = useRef<number | null>(null);

    // Track if step nodes have been repositioned after label adjustment
    const stepNodeRepositionedRef = useRef(false);

    // React Flow hooks for accessing measured node data
    const { getNodes, getViewport, fitView } = useReactFlow();
    const nodesInitialized = useNodesInitialized();

    // Helper function to get expressions to render from the system
    const getFormula = useCallback((): string[] => {
      if (computationStore.formulas.length > 0) {
        return computationStore.formulas.map((f) => f.latex);
      }
      return [];
    }, [computationStore.formulas]);

    // Initialize React Flow state first
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const selectedTemplate = debugStore.selectedTemplate;

    /**
     * Check if a label node should be visible based on the same logic as LabelNode component
     * @param varId - The variable ID to check
     * @returns true if the label should be visible, false otherwise
     */
    const shouldLabelBeVisible = useCallback(
      (varId: string): boolean => {
        // If not in step mode, always show labels
        if (!computationStore.isStepMode()) {
          return true;
        }

        // In step mode, only show labels for active variables
        // activeVariables is a Map<formulaId, Set<varId>>
        // For canvas.tsx (multi-formula canvas), check all formula sets
        const activeVariables = computationStore.getActiveVariables();
        for (const varSet of activeVariables.values()) {
          if (varSet.has(varId)) {
            return true;
          }
        }
        return false;
      },
      [computationStore]
    );

    /**
     * Create edges between label nodes and their corresponding variable nodes
     * @param currentNodes - The current array of nodes
     * @returns Array of edges connecting labels to variables
     */
    const createLabelVariableEdges = useCallback(
      (currentNodes: Node[]): Edge[] =>
        computeLabelVariableEdges(currentNodes, shouldLabelBeVisible),
      [shouldLabelBeVisible]
    );

    // Enhanced onNodesChange that triggers edge updates when nodes move
    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        onNodesChange(changes);
      },
      [onNodesChange, getNodes]
    );

    // Create nodes from formulas and controls
    const createNodes = useCallback((): Node[] => {
      const nodes: Node[] = [];
      const formulas = getFormula();

      let currentY = 50; // Starting Y position

      // Add interpreter control node if in step mode
      if (computationStore.isStepMode() && environment) {
        nodes.push({
          id: "interpreter-control",
          type: "interpreterControl",
          position: { x: 600, y: currentY },
          data: { environment },
          draggable: true,
        });
        currentY += 80; // Add space after interpreter controls
      }

      // Add individual control nodes if controls exist
      if (controls && controls.length > 0) {
        controls.forEach((control, index) => {
          nodes.push({
            id: `control-${index}`,
            type: "control",
            position: { x: 250, y: currentY },
            data: { control },
            draggable: true,
          });
          currentY += 100; // Add space after each control
        });
      }

      // Add formula nodes vertically
      formulas.forEach((latex, index) => {
        // Get id from computation store formulas
        const formula = computationStore.formulas[index];
        if (!formula?.id) {
          console.error(`Formula at index ${index} missing required id`);
          return;
        }
        const id = formula.id;
        nodes.push({
          id: `formula-${id}`,
          type: "formula",
          position: { x: 250, y: currentY },
          data: {
            latex,
            environment,
            id,
            computationStore,
          },
          dragHandle: ".formula-drag-handle",
          draggable: true,
          style: {
            cursor: "default",
          },
        });
        currentY += 200; // Vertical spacing between formula nodes
      });

      const graph2D = environment?.graph2d ?? [];
      const graph3D = environment?.graph3d ?? [];
      const hasGraphNodes = graph2D.length > 0 || graph3D.length > 0;
      let vizY = 0; // Start visualizations at the same Y as formulas

      if (hasGraphNodes) {
        graph2D.forEach((plot) => {
          nodes.push({
            id: `graph-node-2d-${plot.id}`,
            type: "graph",
            position: { x: 800, y: vizY },
            data: { graphId: plot.id },
            draggable: true,
            dragHandle: ".visualization-drag-handle",
          });
          vizY += 300;
        });
        graph3D.forEach((plot) => {
          nodes.push({
            id: `graph-node-3d-${plot.id}`,
            type: "graph",
            position: { x: 800, y: vizY },
            data: { graphId: plot.id },
            draggable: true,
            dragHandle: ".visualization-drag-handle",
          });
          vizY += 300;
        });
      }

      const isBayesExampleSelected = selectedTemplate === BAYES_EXAMPLE_ID;
      const hasBayesFormula = computationStore.formulas.some(
        (formula) => formula.id === BAYES_FORMULA_ID
      );

      if (isBayesExampleSelected || hasBayesFormula) {
        nodes.push({
          id: "bayes-chart",
          type: "emptyNode",
          position: { x: 800, y: vizY },
          data: { component: BayesProbabilityChart },
          draggable: true,
          dragHandle: ".empty-node-drag-handle",
        });
      }

      return nodes;
    }, [getFormula, controls, environment, computationStore, selectedTemplate]);

    // Function to add step nodes for variables with step descriptions
    const addstepNodes = useCallback(() => {
      addstepNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        setEdges,
        computationStore,
      });
    }, [getNodes, getViewport, setNodes, setEdges, computationStore]);

    // Separate function to add label nodes after variable nodes are positioned
    const addLabelNodes = useCallback(() => {
      addLabelNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        computationStore,
      });
    }, [getNodes, getViewport, setNodes, computationStore]);

    // Function to update label nodes in place (used during step transitions)
    const updateLabelNodes = useCallback(() => {
      return updateAllLabelNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        computationStore,
      });
    }, [getNodes, getViewport, setNodes, computationStore]);

    // Function to adjust label positions after they're rendered and measured
    const adjustLabelPositions = useCallback(() => {
      adjustLabelPositionsUtil({
        getNodes,
        setNodes,
        lockCurrentPlacements: computationStore.isDragging,
      });
    }, [computationStore, getNodes, setNodes]);

    // Function to add variable nodes as subnodes using React Flow's measurement system
    const addVariableNodes = useAddVariableNodes({
      nodesInitialized,
      setNodes,
      addLabelNodes,
      addstepNodes,
      bootstrapCompleteRef,
      computationStore,
    });

    const updateVariableNodes = useUpdateVariableNodes({
      nodesInitialized,
      setNodes,
      bootstrapCompleteRef,
      computationStore,
    });

    // Update nodes when formulas or controls change
    useEffect(() => {
      const disposer = reaction(
        () => ({
          formulas: computationStore.formulas.map((f) => f.latex),
          controls: controls,
        }),
        () => {
          // Reset bootstrap completion when formulas change
          bootstrapCompleteRef.current = false;
          // Clear manually positioned labels when formulas change
          setNodes(createNodes());
          setEdges([]); // Clear edges when nodes are reset
          // Variable nodes will be added when nodes are initialized
        }
      );

      // Initial setup
      bootstrapCompleteRef.current = false;
      setNodes(createNodes());
      setEdges([]); // Clear edges on initial setup

      return () => {
        disposer();
      };
    }, [createNodes, setNodes, setEdges, computationStore, controls]);

    // Add variable nodes when React Flow nodes are initialized and measured
    useEffect(() => {
      if (nodesInitialized && !bootstrapCompleteRef.current) {
        if (computationStore.variables.size === 0) {
          bootstrapCompleteRef.current = true;
          return;
        }
        addVariableNodes();
      }
    }, [nodesInitialized, nodes, addVariableNodes, computationStore]);

    // Fit view after all nodes are properly loaded and positioned (only on initial load)
    useEffect(() => {
      if (
        nodesInitialized &&
        nodes.length > 0 &&
        !initialFitViewCalledRef.current
      ) {
        // Wait until variable-node bootstrap has completed (including zero-variable configs).
        if (bootstrapCompleteRef.current) {
          // Before the first fit, move graphs a fixed gap right of the widest
          // formula, so narrow formulas don't leave a wide empty space and wide
          // ones don't overlap their graphs.
          if (!visualizationsPlacedRef.current) {
            visualizationsPlacedRef.current = true;
            const formulaRight = Math.max(
              ...getFormulaNodes(nodes).map(
                (node) => node.position.x + (node.measured?.width ?? 0)
              )
            );
            if (
              Number.isFinite(formulaRight) &&
              nodes.some(isVisualizationNode)
            ) {
              setNodes((currentNodes) =>
                currentNodes.map((node) =>
                  isVisualizationNode(node)
                    ? {
                        ...node,
                        position: {
                          ...node.position,
                          x: formulaRight + VISUALIZATION_GAP,
                        },
                      }
                    : node
                )
              );
              // The fit runs on the next render, after the move.
              return;
            }
          }
          fitView({ duration: 300, padding: 0.2 });
          initialFitViewCalledRef.current = true;
        }
      }
    }, [nodesInitialized, nodes, fitView, setNodes]);

    // Re-add variable nodes when computation store variables change
    useEffect(() => {
      const disposer = reaction(
        () => ({
          // Watch for changes in the set of variables (additions/removals)
          variableKeys: Array.from(computationStore.variables.keys()).sort(),
        }),
        () => {
          if (nodesInitialized) {
            // Variables set has changed, need to recreate all variable nodes
            bootstrapCompleteRef.current = false;
            if (computationStore.variables.size === 0) {
              setNodes((currentNodes) =>
                currentNodes.filter(
                  (node) =>
                    node.type !== NODE_TYPES.VARIABLE &&
                    node.type !== NODE_TYPES.LABEL &&
                    node.type !== NODE_TYPES.STEP &&
                    node.type !== NODE_TYPES.EXPRESSION
                )
              );
              bootstrapCompleteRef.current = true;
              return;
            }
            addVariableNodes();
          }
        },
        {
          fireImmediately: false,
        }
      );
      return () => disposer();
    }, [
      nodesInitialized,
      addVariableNodes,
      computationStore.variables,
      setNodes,
    ]);

    // Update variable node positions/dimensions when values change or editing ends
    useEffect(() => {
      let wasEditing = false;
      const disposer = reaction(
        () => ({
          variables: Array.from(computationStore.variables.entries()).map(
            ([id, variable]) => ({
              id,
              value: variable.value,
              precision: variable.precision,
              sigFigs: variable.sigFigs,
            })
          ),
          // Track editing states to delay update until after MathJax re-renders
          editingStatesSize: computationStore.editingStates.size,
        }),
        ({ editingStatesSize }) => {
          if (!nodesInitialized || !bootstrapCompleteRef.current) return;

          // Track if we're currently editing
          if (editingStatesSize > 0) {
            wasEditing = true;
            // Still update during editing - the input width reflects typed content
            updateVariableNodes();
            return;
          }

          // If editing just ended, delay to let MathJax re-render first
          if (wasEditing) {
            wasEditing = false;
            // Use requestAnimationFrame to wait for MathJax to re-render
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                updateVariableNodes();
              });
            });
            return;
          }

          updateVariableNodes();
        }
      );
      return () => disposer();
    }, [nodesInitialized, updateVariableNodes, computationStore]);

    // Update edges whenever nodes change to keep label-variable connections in sync
    // Only create edges after labels are positioned and visible
    useEffect(() => {
      if (nodes.length > 0) {
        // Check if all label nodes are visible (positioned correctly)
        const labelNodes = getLabelNodes(nodes);
        const visibleLabelNodes = labelNodes.filter(
          (node) => !node.style || node.style.opacity !== 0
        );

        // Only create edges if all labels are visible or there are no labels
        if (
          labelNodes.length === 0 ||
          visibleLabelNodes.length === labelNodes.length
        ) {
          const computedEdges = createLabelVariableEdges(nodes);

          // Preserve existing step edges (they are managed separately by addstepNodes)
          const existingStepEdges = edges.filter((edge) =>
            edge.id.startsWith("edge-step-")
          );

          // Preserve object identity for unchanged edges to avoid re-renders
          const nextLabelEdges = computedEdges
            .map((edge) => {
              const prev = edges.find((e) => e.id === edge.id);
              if (
                prev &&
                prev.source === edge.source &&
                prev.target === edge.target &&
                prev.sourceHandle === edge.sourceHandle &&
                prev.targetHandle === edge.targetHandle &&
                prev.type === edge.type
              ) {
                return prev; // reuse previous edge object
              }
              return edge;
            })
            .sort((a, b) => a.id.localeCompare(b.id));

          // Combine label edges with preserved step edges
          const nextEdges = [...nextLabelEdges, ...existingStepEdges];

          // Shallow reference equality check to skip unnecessary setEdges
          const sameByRef =
            nextEdges.length === edges.length &&
            nextEdges.every((e, i) => e === edges[i]);
          if (!sameByRef) {
            setEdges(nextEdges);
          }
        } else {
          // Keep only step edges while labels are being positioned
          const stepEdges = edges.filter((edge) =>
            edge.id.startsWith("edge-step-")
          );
          if (stepEdges.length !== edges.length) {
            setEdges(stepEdges);
          }
        }
      } else {
        setEdges([]);
      }
    }, [nodes, edges, createLabelVariableEdges, setEdges]);

    // Update labels when step mode or active variables change
    useEffect(() => {
      const disposer = reaction(
        () => ({
          isStepMode: computationStore.isStepMode(),
          // Track activeVariables by serializing the Map to detect changes
          // This is what determines which labels to show
          activeVariables: Array.from(
            computationStore.getActiveVariables().entries()
          ).map(([formulaId, varSet]) => [formulaId, Array.from(varSet)]),
          currentStep: computationStore.currentStep,
          stepIndex: computationStore.currentStepIndex,
        }),
        () => {
          if (nodesInitialized && bootstrapCompleteRef.current) {
            // Cancel any pending animation frames
            if (labelUpdateFrameRef.current) {
              cancelAnimationFrame(labelUpdateFrameRef.current);
            }
            if (labelRebuildFrameRef.current) {
              cancelAnimationFrame(labelRebuildFrameRef.current);
            }

            labelUpdateFrameRef.current = window.requestAnimationFrame(() => {
              // Variable dimensions must update first so label/expression bounds use
              // the latest geometry when the current step changes.
              updateVariableNodes();
              stepNodeRepositionedRef.current = false;
              labelRebuildFrameRef.current = window.requestAnimationFrame(() => {
                // Only clear label edges if the label set itself changed.
                const labelSetChanged = updateLabelNodes();
                if (labelSetChanged) {
                  setEdges((currentEdges) =>
                    currentEdges.filter((edge) =>
                      edge.id.startsWith("edge-step-")
                    )
                  );
                }
                // Update labels in place (no flicker) and add/update step nodes
                addstepNodes();
              });
            });
          }
        },
        { fireImmediately: true } // Fire immediately to handle initial state
      );

      return () => {
        disposer();
        if (labelUpdateFrameRef.current) {
          cancelAnimationFrame(labelUpdateFrameRef.current);
        }
        if (labelRebuildFrameRef.current) {
          cancelAnimationFrame(labelRebuildFrameRef.current);
        }
      };
    }, [
      nodesInitialized,
      updateLabelNodes,
      addstepNodes,
      updateVariableNodes,
      setEdges,
      computationStore,
    ]);

    // Adjust label and view node positions after they're rendered and measured
    useEffect(() => {
      if (!nodesInitialized || !bootstrapCompleteRef.current) return;
      // Check if all nodes are ready for positioning
      const { labelNodes, stepNodes, allReady } = checkAllNodesMeasured(nodes);

      // Check if there are step nodes that need to be positioned (have opacity 0)
      const stepNodesNeedPositioning = stepNodes.some(
        (node) => node.style?.opacity === 0
      );
      // Check if there are label nodes that need to be positioned (have opacity 0)
      const labelNodesNeedPositioning = labelNodes.some(
        (node) => node.style?.opacity === 0
      );

      // If no labels and no step nodes exist, nothing to do
      if (labelNodes.length === 0 && stepNodes.length === 0) {
        return;
      }

      // Skip if no nodes need positioning
      if (!stepNodesNeedPositioning && !labelNodesNeedPositioning) {
        return;
      }

      if (allReady) {
        const layoutFrameId = requestAnimationFrame(() => {
          // Adjust label positions first
          if (labelNodes.length > 0) {
            adjustLabelPositions();
          }

          // Position step nodes to avoid label collisions, then make them visible
          if (
            stepNodes.length > 0 &&
            computationStore.currentStep &&
            !stepNodeRepositionedRef.current
          ) {
            stepNodeRepositionedRef.current = true;

            // Find the first formula node
            const formulaNodes = getFormulaNodes(nodes);
            const formulaNode = formulaNodes[0];

            if (formulaNode) {
              setNodes((currentNodes) =>
                positionAndShowstepNodes(currentNodes, formulaNode)
              );
            }
          }
        });

        return () => {
          cancelAnimationFrame(layoutFrameId);
        };
      }
    }, [nodes, nodesInitialized, adjustLabelPositions, setNodes]);

    const fitViewOptions = useMemo(
      () => ({
        padding: 0.2,
        minZoom: 0.5,
        maxZoom: 1.0,
      }),
      []
    );

    const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);

    const proOptions = useMemo(() => ({ hideAttribution: true }), []);

    return (
      <div ref={canvasContainerRef} className={`w-full h-full min-h-[500px] ${showGrips ? "show-grips" : ""}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={defaultNodeTypes}
          fitView
          fitViewOptions={fitViewOptions}
          className="bg-white"
          defaultViewport={defaultViewport}
          minZoom={0.3}
          maxZoom={2}
          zoomOnScroll={false}
          panOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          selectNodesOnDrag={false}
          preventScrolling={false}
          autoPanOnNodeDrag={false}
          proOptions={proOptions}
        >
          <CanvasControls showGrips={showGrips} onToggleGrips={toggleGrips} />
        </ReactFlow>
      </div>
    );
  }
);

// Main Canvas component with ReactFlowProvider
// Note: FormulizeContext.Provider should be provided by the parent component
const Canvas = observer((props: CanvasProps) => {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
});

export type { CanvasProps };
export default Canvas;
