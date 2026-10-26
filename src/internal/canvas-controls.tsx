import { memo } from "react";

import { useReactFlow } from "@xyflow/react";
import { Maximize, Minus, Move, Plus } from "lucide-react";

interface CanvasControlsProps {
  showGrips?: boolean;
  onToggleGrips?: () => void;
}

// Custom Controls Component - Memoized to prevent unnecessary re-renders
export const CanvasControls = memo(({ showGrips, onToggleGrips }: CanvasControlsProps) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomIn = () => {
    zoomIn({ duration: 200 });
  };

  const handleZoomOut = () => {
    zoomOut({ duration: 200 });
  };

  const handleFitView = () => {
    fitView({ duration: 200, padding: 0.1 });
  };

  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
      <button
        onClick={handleZoomIn}
        className="w-10 h-10 bg-white border border-slate-200 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:scale-105 transition-all duration-200 shadow-sm"
        title="Zoom In"
      >
        <Plus size={16} />
      </button>

      <button
        onClick={handleZoomOut}
        className="w-10 h-10 bg-white border border-slate-200 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:scale-105 transition-all duration-200 shadow-sm"
        title="Zoom Out"
      >
        <Minus size={16} />
      </button>

      <button
        onClick={handleFitView}
        className="w-10 h-10 bg-white border border-slate-200 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:scale-105 transition-all duration-200 shadow-sm"
        title="Fit View"
      >
        <Maximize size={16} />
      </button>

      {onToggleGrips && (
        <button
          onClick={onToggleGrips}
          className={`w-10 h-10 border rounded flex items-center justify-center hover:scale-105 transition-all duration-200 shadow-sm ${
            showGrips
              ? "bg-slate-100 border-slate-300 text-slate-800"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
          title={showGrips ? "Hide Move Handles" : "Show Move Handles"}
        >
          <Move size={16} />
        </button>
      )}
    </div>
  );
});

// Simplified controls for FormulaComponent - only resize button
export const SimpleCanvasControls = memo(() => {
  const { fitView } = useReactFlow();
  const handleFitView = () => {
    fitView({ duration: 100, padding: 0.2 });
  };
  return (
    <div className="absolute bottom-2 left-2 z-10">
      <button
        onClick={handleFitView}
        className="w-8 h-8 bg-white border border-slate-200 rounded flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:scale-105 transition-all duration-200 shadow-sm"
        title="Fit View"
      >
        <Maximize size={16} />
      </button>
    </div>
  );
});
