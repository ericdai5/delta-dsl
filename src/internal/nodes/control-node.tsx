import { observer } from "mobx-react-lite";

import { GripVertical } from "lucide-react";

import ButtonControl from "../../core/controls/button";
import CheckboxControl from "../../core/controls/checkbox";
import RadioControl from "../../core/controls/radio";
import SetControl from "../../core/controls/set";
import Slider from "../../core/controls/slider";
import { ownTouches } from "../../util/own-touches";

// Generic Control Node Component that handles all control types
const ControlNode = observer(({ data }: { data: any }) => {
  const { control } = data;

  if (control) {
    // Buttons render without the card wrapper
    if (control.type === "button") {
      return (
        <div className="relative group">
          <div className="control-drag-handle absolute top-1/2 -left-4 transform -translate-y-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-0.5 py-1 cursor-move z-20 opacity-0 transition-opacity duration-200">
            <GripVertical size={14} className="text-slate-400" />
          </div>
          <ButtonControl control={control} />
        </div>
      );
    }

    return (
      <div className="control-node relative group border bg-white border-slate-200 rounded-3xl p-4">
        <div className="control-drag-handle absolute top-1/2 -left-4 transform -translate-y-1/2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-0.5 py-1 cursor-move z-20 opacity-0 transition-opacity duration-200">
          <GripVertical size={14} className="text-slate-400" />
        </div>
        {/* A finger on a control works the control, not the canvas under it */}
        <div className="nodrag" ref={ownTouches}>
          {control.type === "slider" && <Slider control={control} />}
          {control.type === "set" && <SetControl control={control} />}
          {control.type === "checkbox" && <CheckboxControl control={control} />}
          {control.type === "radio" && <RadioControl control={control} />}
        </div>
      </div>
    );
  }

  return null;
});

export default ControlNode;
