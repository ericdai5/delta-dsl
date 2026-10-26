import {
  examples as configExamples,
  exampleDisplayNames,
  featuredExampleNames,
  featuredExamples,
} from "../examples";

export type IExampleKey = keyof typeof configExamples;

// Featured examples show their public names; the rest keep internal names.
export const displayName = (key: IExampleKey) =>
  key in featuredExampleNames
    ? featuredExampleNames[key as keyof typeof featuredExampleNames]
    : exampleDisplayNames[key];

// The public examples, in order. The new canvas is left out for now.
export const publicExampleKeys: IExampleKey[] = [...featuredExamples];

// Every example that isn't featured, the new canvas included; listed in local
// development only.
export const otherExampleKeys = (
  Object.keys(configExamples) as IExampleKey[]
).filter((key) => !(featuredExamples as readonly string[]).includes(key));

// The frame of an example card; the current example is outlined in blue.
export const exampleCardClass = (isActive: boolean) =>
  `flex flex-col overflow-hidden rounded border text-left text-sm transition-colors ${
    isActive
      ? "border-blue-500 ring-1 ring-blue-500"
      : "border-slate-200 hover:border-slate-400"
  }`;
