import { Plus } from "lucide-react";

import { IExampleKey, displayName } from "./example-list";

// An example's thumbnail and name, inside whatever button or link holds it.
export const ExampleCardContent = ({
  exampleKey,
}: {
  exampleKey: IExampleKey;
}) => (
  <>
    {exampleKey === "newCanvas" ? (
      <span className="flex h-48 items-center justify-center bg-slate-50 text-slate-500">
        <Plus className="w-8 h-8" strokeWidth={1.5} />
      </span>
    ) : (
      <span className="flex h-48 items-center justify-center bg-white p-2">
        <img
          alt=""
          className="max-h-full max-w-full object-contain"
          src={`/example-thumbnails/${exampleKey}.webp`}
        />
      </span>
    )}
    <span className="border-t border-slate-100 px-3 py-2 text-slate-900">
      {displayName(exampleKey)}
    </span>
  </>
);
