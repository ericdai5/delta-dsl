import React, { useCallback, useEffect, useRef } from "react";

import { reaction, toJS } from "mobx";
import { observer } from "mobx-react-lite";

import {
  Background,
  BackgroundVariant,
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

import { CanvasContextMenu } from "../internal/canvas-context-menu";
import ExpressionNode from "../internal/nodes/expression-node";
import FormulaNode from "../internal/nodes/formula-node";
import LabelNode from "../internal/nodes/label-node";
import StepNode from "../internal/nodes/step-node";
import VariableNode from "../internal/nodes/variable-node";
import { ComputationStore } from "../store/computation";
import { computeEdgesForFormula } from "../util/canvas/edges";
import {
  adjustLabelPositions as adjustLabelPositionsUtil,
  updateLabelNodes as updateLabelNodesUtil,
} from "../util/canvas/label-node";
import {
  NODE_TYPES,
  checkAllNodesMeasured,
  findFormulaNodeById,
  getFormulaElementFromContainer,
  getLabelNodes,
  getVariableNodes,
  positionAndShowstepNodes,
} from "../util/canvas/node-helpers";
import { addstepNodes as addstepNodesUtil } from "../util/canvas/step-node";
import {
  addVariableNodesForFormula,
  updateVarNodes,
} from "../util/canvas/variable-nodes";
import { useStore } from "./hooks";
import { useAutoContentSize } from "./hooks/use-auto-content-size";
import { useFitViewAfterReveal } from "./hooks/use-fit-view-after-reveal";
import { useReportContentBounds } from "./hooks/use-report-content-bounds";

const nodeTypes = {
  formula: FormulaNode,
  variable: VariableNode,
  label: LabelNode,
  step: StepNode,
  expression: ExpressionNode,
};

interface FormulaComponentProps {
  id: string;
  className?: string;
  style?: React.CSSProperties;
}

interface FormulaCanvasInnerProps {
  id: string;
  formulas: Array<{ id: string; latex: string }>;
  computationStore: ComputationStore;
  onContentBoundsChange?: (bounds: { width: number; height: number }) => void;
}

const FormulaCanvasInner = observer(
  ({
    id,
    formulas,
    computationStore,
    onContentBoundsChange,
  }: FormulaCanvasInnerProps) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [canvasVisible, setCanvasVisible] = React.useState(false);
    const [contextMenu, setContextMenu] = React.useState<{
      x: number;
      y: number;
    } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const bootstrapCompleteRef = useRef(false);
    const initialFitViewCalledRef = useRef(false);
    const pendingStepFitRef = useRef(false);
    const stepUpdateFrameRef = useRef<number | null>(null);
    const stepRebuildFrameRef = useRef<number | null>(null);
    const stepNodeRepositionedRef = useRef(false);
    const { getNodes, getNodesBounds, getViewport, fitView } = useReactFlow();
    const nodesInitialized = useNodesInitialized();

    // Handle context menu
    const handleContextMenu = useCallback((event: React.MouseEvent) => {
      event.preventDefault();
      // Calculate position relative to the container which is now explicitly relative
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setContextMenu({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    }, []);

    const closeContextMenu = useCallback(() => {
      setContextMenu(null);
    }, []);

    // Helper function to get the formula latex by id
    // Uses the formulas prop passed from context (scoped to this provider)
    const getFormula = useCallback((): string | null => {
      // Use formulas from context (scoped per Provider)
      if (formulas && formulas.length > 0) {
        const formula = formulas.find((f) => f.id === id);
        if (formula) {
          return formula.latex;
        }
      }
      return null;
    }, [id, formulas]);

    // Check if a label node should be visible based on step mode
    const shouldLabelBeVisible = useCallback(
      (varId: string): boolean => {
        // If not in step mode, always show labels
        if (!computationStore.isStepMode()) {
          return true;
        }
        // In step mode, only show labels for active variables
        // Get fresh activeVariables from store
        const activeVariables = computationStore.getActiveVariables();
        const allFormulasVars = activeVariables.get("") ?? new Set();
        const thisFormulaVars = activeVariables.get(id) ?? new Set();
        return allFormulasVars.has(varId) || thisFormulaVars.has(varId);
      },
      [computationStore, id]
    );

    // Function to adjust label positions after they're rendered and measured
    const adjustLabelPositions = useCallback(() => {
      adjustLabelPositionsUtil({
        getNodes,
        setNodes,
        lockCurrentPlacements: computationStore.isDragging,
      });
    }, [computationStore, getNodes, setNodes]);

    // Enhanced onNodesChange handler
    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        onNodesChange(changes);
      },
      [onNodesChange]
    );

    // Function to update only label nodes when activeVariables change
    const updateLabelNodes = useCallback(() => {
      return updateLabelNodesUtil({
        getNodes,
        getViewport,
        setNodes,
        formulaId: id,
        containerElement: containerRef.current,
        computationStore,
      });
    }, [getNodes, getViewport, id, setNodes, computationStore]);

    // Function to add step nodes for step-through visualization
    const addstepNodes = useCallback(() => {
      addstepNodesUtil({
        getNodes,
        setNodes,
        setEdges,
        formulaId: id,
        computationStore,
      });
    }, [getNodes, id, setNodes, setEdges, computationStore]);

    // Function to update variable node dimensions (e.g., after CSS class changes)
    const updateVariableNodes = useCallback(() => {
      const currentNodes = getNodes();
      const viewport = getViewport();
      const formulaElement = getFormulaElementFromContainer(
        containerRef.current,
        currentNodes,
        id
      );
      if (!formulaElement) return;
      const formulaNode = findFormulaNodeById(currentNodes, id);
      if (!formulaNode || !formulaNode.measured) return;

      // Build map of existing variable nodes
      const existingVarNodes = new Map<string, Node>();
      getVariableNodes(currentNodes).forEach((node) =>
        existingVarNodes.set(node.id, node)
      );

      // Use the shared helper to get updated nodes
      const foundNodeIds = new Set<string>();
      const { updatedNodes } = updateVarNodes(
        formulaElement,
        formulaNode,
        id,
        viewport,
        existingVarNodes,
        foundNodeIds,
        computationStore
      );

      if (updatedNodes.length > 0) {
        setNodes((nds) =>
          nds.map((node) => {
            const update = updatedNodes.find((u) => u.id === node.id);
            return update || node;
          })
        );
      }
    }, [getNodes, getViewport, id, setNodes, computationStore]);

    // Function to add variable nodes by finding them in the rendered MathJax formula
    const addVariableNodes = useCallback(() => {
      const latex = getFormula();
      if (!latex) return;
      addVariableNodesForFormula({
        getNodes,
        getViewport,
        setNodes,
        nodesInitialized,
        bootstrapCompleteRef,
        formulaId: id,
        containerElement: containerRef.current,
        computationStore,
      });
    }, [
      id,
      getFormula,
      getNodes,
      getViewport,
      nodesInitialized,
      setNodes,
      computationStore,
    ]);

    // Initialize the canvas with the formula node
    useEffect(() => {
      const initializeCanvas = async () => {
        const latex = getFormula();
        if (!latex) {
          return;
        }

        // Wait for MathJax to be ready
        if (window.MathJax) {
          await window.MathJax.startup.promise;
        }

        // Reset refs and visibility when reinitializing
        bootstrapCompleteRef.current = false;
        initialFitViewCalledRef.current = false;
        setCanvasVisible(false);

        // Create the main formula node
        // Pass the environment as a plain object to ensure fontSize and other settings are applied
        const environment = computationStore.environment
          ? toJS(computationStore.environment)
          : { fontSize: 1 };

        const formulaNode: Node = {
          id: `formula-${id}`,
          type: "formula",
          position: { x: 100, y: 100 },
          draggable: false,
          style: {
            cursor: "default",
          },
          data: {
            latex: latex,
            id: id,
            environment: environment,
            showDragHandle: false,
          },
        };
        setNodes([formulaNode]);
        setEdges([]);
      };

      initializeCanvas();
    }, [getFormula, id, setNodes, setEdges, formulas, computationStore]);

    // Add variable nodes when React Flow nodes are initialized and measured
    useEffect(() => {
      if (!nodesInitialized || bootstrapCompleteRef.current) {
        return;
      }

      // Formula-only config: skip variable-node bootstrap entirely.
      if (computationStore.variables.size === 0) {
        bootstrapCompleteRef.current = true;
        return;
      }

      addVariableNodes();
    }, [nodesInitialized, addVariableNodes, computationStore]);

    // Update variable node positions/dimensions when values change or editing ends
    useEffect(() => {
      let wasEditing = false;
      const disposer = reaction(
        () => ({
          variables: Array.from(computationStore.variables.entries()).map(
            ([varId, variable]) => ({
              varId,
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

    // Adjust label and step node positions after they're rendered and measured, then fitView
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
      const shouldRunPendingStepFit =
        pendingStepFitRef.current && canvasVisible;

      // Skip if initial fitView already done, no nodes need positioning,
      // and there is no pending post-step refit to apply.
      if (
        initialFitViewCalledRef.current &&
        !stepNodesNeedPositioning &&
        !labelNodesNeedPositioning &&
        !shouldRunPendingStepFit
      ) {
        return;
      }

      // If no labels and no step nodes exist, just fitView once after variable nodes are added
      if (labelNodes.length === 0 && stepNodes.length === 0) {
        if (!initialFitViewCalledRef.current) {
          const frameId = window.requestAnimationFrame(() => {
            initialFitViewCalledRef.current = true;
            window.requestAnimationFrame(() => {
              setCanvasVisible(true);
            });
          });
          return () => window.cancelAnimationFrame(frameId);
        }

        if (shouldRunPendingStepFit) {
          pendingStepFitRef.current = false;
          const frameId = window.requestAnimationFrame(() => {
            fitView();
          });
          return () => window.cancelAnimationFrame(frameId);
        }
        return;
      }

      if (allReady) {
        const layoutFrameId = window.requestAnimationFrame(() => {
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

            // Find the formula node to calculate positions relative to it
            const formulaNode = nodes.find(
              (n) => n.type === NODE_TYPES.FORMULA && n.data.id === id
            );

            if (formulaNode) {
              setNodes((currentNodes) =>
                positionAndShowstepNodes(currentNodes, formulaNode)
              );
            }
          }

          // Fit step after all nodes are positioned and visible to avoid flashing
          if (!initialFitViewCalledRef.current) {
            window.requestAnimationFrame(() => {
              initialFitViewCalledRef.current = true;
              window.requestAnimationFrame(() => {
                setCanvasVisible(true);
              });
            });
          } else if (shouldRunPendingStepFit) {
            pendingStepFitRef.current = false;
            window.requestAnimationFrame(() => {
              fitView();
            });
          }
        });

        return () => {
          window.cancelAnimationFrame(layoutFrameId);
        };
      }
    }, [
      nodes,
      nodesInitialized,
      adjustLabelPositions,
      setNodes,
      id,
      canvasVisible,
      fitView,
      computationStore.currentStep,
    ]);

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
          // The bootstrap adds the first labels, so after it, handle every
          // step even while some nodes are unmeasured. A label added for one
          // step renders nothing, so it is never measured, if the reader
          // moves on to a step where its variable is inactive. Only this
          // pass removes it, so waiting for every node to be measured would
          // freeze the walkthrough.
          if (bootstrapCompleteRef.current) {
            if (initialFitViewCalledRef.current) {
              pendingStepFitRef.current = true;
            }

            if (stepUpdateFrameRef.current !== null) {
              window.cancelAnimationFrame(stepUpdateFrameRef.current);
            }
            if (stepRebuildFrameRef.current !== null) {
              window.cancelAnimationFrame(stepRebuildFrameRef.current);
            }

            stepUpdateFrameRef.current = window.requestAnimationFrame(() => {
              // Variable dimensions must update first so label/expression bounds use
              // the latest geometry when the current step changes.
              updateVariableNodes();
              stepNodeRepositionedRef.current = false;
              stepRebuildFrameRef.current = window.requestAnimationFrame(() => {
                const labelSetChanged = updateLabelNodes();
                if (labelSetChanged) {
                  setEdges((currentEdges) =>
                    currentEdges.filter((edge) =>
                      edge.id.startsWith("edge-step-")
                    )
                  );
                }
                addstepNodes();
              });
            });
          }
        },
        { fireImmediately: true } // Fire immediately to handle initial state
      );

      return () => {
        disposer();
        if (stepUpdateFrameRef.current !== null) {
          window.cancelAnimationFrame(stepUpdateFrameRef.current);
        }
        if (stepRebuildFrameRef.current !== null) {
          window.cancelAnimationFrame(stepRebuildFrameRef.current);
        }
      };
      // Note: We intentionally exclude computationStore.currentStep from deps because
      // the MobX reaction tracks it internally. Including it would cause the
      // useEffect to re-run and dispose the reaction before timeouts can fire.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      nodesInitialized,
      updateVariableNodes,
      updateLabelNodes,
      addstepNodes,
      setEdges,
      adjustLabelPositions,
      fitView,
      computationStore,
      computationStore,
      id,
    ]);

    // Create edges after labels are visible and positioned
    useEffect(() => {
      if (nodes.length > 0) {
        // Check if all label nodes are visible (positioned correctly)
        const labelNodes = getLabelNodes(nodes);
        const visibleLabelNodes = labelNodes.filter(
          (node) => !node.style || node.style.opacity !== 0
        );

        // Preserve step edges (managed separately by addstepNodes)
        const existingStepEdges = edges.filter((edge) =>
          edge.id.startsWith("edge-step-")
        );

        // Only create edges if all labels are visible or there are no labels
        if (
          labelNodes.length === 0 ||
          visibleLabelNodes.length === labelNodes.length
        ) {
          const computedEdges = computeEdgesForFormula(
            id,
            nodes,
            shouldLabelBeVisible,
            new Set()
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
          if (existingStepEdges.length !== edges.length) {
            setEdges(existingStepEdges);
          }
        }
      } else {
        // Preserve step edges even when no nodes
        const existingStepEdges = edges.filter((edge) =>
          edge.id.startsWith("edge-step-")
        );
        if (existingStepEdges.length !== edges.length) {
          setEdges(existingStepEdges);
        }
      }
    }, [nodes, edges, id, shouldLabelBeVisible, setEdges]);

    useReportContentBounds({
      nodes,
      nodesInitialized,
      canvasVisible,
      getNodes,
      getNodesBounds,
      onContentBoundsChange,
    });

    useFitViewAfterReveal(canvasVisible, fitView);

    return (
      <div
        ref={containerRef}
        className="w-full h-full relative"
        onContextMenu={handleContextMenu}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          autoPanOnNodeDrag={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          minZoom={1}
          maxZoom={1}
          proOptions={{ hideAttribution: true }}
          style={{
            opacity: canvasVisible ? 1 : 0,
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="#ffffff"
          />
        </ReactFlow>
        {contextMenu && (
          <CanvasContextMenu
            position={contextMenu}
            onClose={closeContextMenu}
          />
        )}
      </div>
    );
  }
);

export const Formula: React.FC<FormulaComponentProps> = observer(
  ({ id, className = "", style = {} }) => {
    const context = useStore();
    const instance = context?.instance;
    const isLoading = context?.isLoading ?? true;
    const error = context?.error;
    const config = context?.config;
    const computationStore = context?.computationStore;
    // Get formulas from context config (scoped per Provider)
    const formulas = config?.formulas || [];
    const { autoWidth, autoHeight, width, height, onContentBoundsChange } =
      useAutoContentSize(style);

    const containerStyle: React.CSSProperties = {
      overflow: "hidden",
      ...style,
      width: width,
      height: height,
    };

    if (error) {
      return (
        <div
          className={`formula-component ${className}`}
          style={containerStyle}
        >
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500">Failed to load formula: {error}</div>
          </div>
        </div>
      );
    }

    // Show loading state while Formulize is initializing or no context
    if (isLoading || !instance || !computationStore) {
      return (
        <div
          className={`formula-component ${className}`}
          style={containerStyle}
        />
      );
    }

    return (
      <div
        className={`formula-component ${className}`}
        style={containerStyle}
        data-formula-id={id}
      >
        <ReactFlowProvider>
          <FormulaCanvasInner
            id={id}
            formulas={formulas}
            computationStore={computationStore}
            onContentBoundsChange={
              autoWidth || autoHeight ? onContentBoundsChange : undefined
            }
          />
        </ReactFlowProvider>
      </div>
    );
  }
);

export default Formula;
