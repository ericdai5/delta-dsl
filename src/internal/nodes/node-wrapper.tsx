import React from "react";

import { GripHorizontal } from "lucide-react";

import { StepControl } from "../../core/step-control";

interface NodeWrapperProps {
  children: React.ReactNode;
}

/**
 * Wrapper component for rendering components inside the React Flow canvas.
 * Adds a drag handle at the top, shown in move mode, and the nodrag class to prevent dragging on interactive elements.
 */
export const NodeWrapper = ({ children }: NodeWrapperProps) => {
  return (
    <div className="group">
      <div className="control-drag-handle flex justify-center cursor-move py-1 text-slate-400 hover:text-slate-600 opacity-0 transition-opacity duration-200">
        <GripHorizontal size={16} />
      </div>
      <div className="nodrag">{children}</div>
    </div>
  );
};

// Wrapped StepControl for use as a React Flow node
export const StepControlNode = () => (
  <NodeWrapper>
    <StepControl />
  </NodeWrapper>
);
