import { observer } from "mobx-react-lite";

import { GripHorizontal, GripVertical } from "lucide-react";

import VisualizationRenderer from "../../visualizations/visualization";

const GraphNode = observer(({ data }: { data: any }) => {
  const { graphId } = data;

  if (!graphId) {
    return (
      <div className="visualization-node p-4">
        <div className="text-slate-500 text-sm">No plot available</div>
      </div>
    );
  }

  return (
    <div className="visualization-node p-2 min-w-[400px] relative group bg-white">
      <div className="visualization-drag-handle absolute -top-3 left-1/2 transform -translate-x-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-1 py-0.5 cursor-move z-20 opacity-0 transition-opacity duration-200">
        <GripHorizontal size={14} className="text-slate-400" />
      </div>
      <div className="visualization-drag-handle absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-1 py-0.5 cursor-move z-20 opacity-0 transition-opacity duration-200">
        <GripHorizontal size={14} className="text-slate-400" />
      </div>
      <div className="visualization-drag-handle absolute top-1/2 -left-3 transform -translate-y-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-0.5 py-1 cursor-move z-20 opacity-0 transition-opacity duration-200">
        <GripVertical size={14} className="text-slate-400" />
      </div>
      <div className="visualization-drag-handle absolute top-1/2 -right-3 transform -translate-y-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-0.5 py-1 cursor-move z-20 opacity-0 transition-opacity duration-200">
        <GripVertical size={14} className="text-slate-400" />
      </div>
      <div className="nodrag">
        <VisualizationRenderer id={graphId} />
      </div>
    </div>
  );
});

export default GraphNode;
