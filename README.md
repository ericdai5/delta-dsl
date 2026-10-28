# Delta

Delta is a domain-specific language for enlivening typeset formulas with
interactive explanations. It lets authors make formulas computable, explain
them with step-by-step walkthroughs, and link manipulation across formulas,
text, and visuals. Delta integrates with LaTeX math in web-based writing
contexts, while its runtime handles state management.

The [Delta website](https://www.pennhci.com/delta/) has the paper, a demo
video, documentation, and the Playground.

The npm package is
[`delta-dsl`](https://www.npmjs.com/package/delta-dsl).

## Getting started

Start with a React 18 application and build an interactive kinetic-energy
formula one piece at a time.

### 1. Install Delta

```bash
npm install delta-dsl react@18 react-dom@18
```

### 2. Render a formula

Create `src/App.tsx`. Import the stylesheet once, define the formula in LaTeX,
and render it by ID inside a `Provider`.

```tsx
import { type Config, Formula, Provider } from "delta-dsl";
import "delta-dsl/style.css";

const kineticConfig: Config = {
  formulas: [
    {
      id: "kinetic-energy",
      latex: "K = \\frac{1}{2}mv^2",
    },
  ],
};

export default function App() {
  return (
    <Provider config={kineticConfig}>
      <Formula id="kinetic-energy" />
    </Provider>
  );
}
```

At this point, the page displays the typeset formula.

### 3. Add labels and starting values

Add `variables` beside `formulas` in `kineticConfig`. The keys match the
literal variable names in the LaTeX.

```tsx
variables: {
  K: { name: "Kinetic Energy" },
  m: { name: "Mass", default: 5 },
  v: { name: "Velocity", default: 2 },
},
```

Delta now connects each label and starting value to its occurrence in the
formula.

### 4. Make the inputs interactive

Update the `m` and `v` entries. `inline` enables direct text entry, while
`drag` enables vertical scrubbing.

```tsx
m: {
  name: "Mass",
  default: 5,
  input: "inline",
  range: [0, 20],
},
v: {
  name: "Velocity",
  default: 2,
  input: "drag",
  range: [0, 10],
},
```

Edit mass directly or scrub velocity by dragging.

### 5. Compute kinetic energy

Add `semantics` beside `variables`. Read the input values from `vars` and
assign the computed result back to `vars.K`.

```tsx
semantics: function ({ vars }) {
  vars.K = 0.5 * vars.m * Math.pow(vars.v, 2);
},
```

Changing mass or velocity now reruns `semantics` and updates kinetic energy.

### Installation notes

npm 7 and newer install Delta's declared peer dependencies automatically when
normal peer resolution is enabled. If
`npm config get legacy-peer-deps` prints `true`, use:

```bash
npm install delta-dsl react@18 react-dom@18 --legacy-peer-deps=false
```

Import package APIs from `delta-dsl` and the stylesheet from
`delta-dsl/style.css`. Other deep-import paths are not public package exports.

## Language constructs

A Delta `Config` has three main constructs:

1. `formulas` declares the LaTeX expressions.
2. `variables` selects expressions from that LaTeX and describes how readers
   can view or manipulate them.
3. `semantics` computes values, records graph samples, and inserts walkthrough
   steps.

The optional top-level constructs are `graph2d`, `graph3d`, and `stepping`.

### Formulas

Each formula has two fields:

| Field   | Description                                             |
| ------- | ------------------------------------------------------- |
| `id`    | Handle used by the React `Formula` component            |
| `latex` | Formula written as a JavaScript string containing LaTeX |

LaTeX command backslashes must be escaped in ordinary JavaScript strings:

```tsx
{
  id: "quadratic",
  latex: "y = ax^2 + bx + c",
}
```

Wrap related artifacts in one provider and render a formula by its ID:

```tsx
<Provider config={config}>
  <Formula id="quadratic" />
</Provider>
```

### Variables

Variable keys are literal selectors copied from the formula's LaTeX. A
selector can be one symbol or a longer expression.

```tsx
variables: {
  x: {
    name: "Input",
    default: 2,
    input: "drag",
    range: [-10, 10],
    step: 0.25,
    precision: 2,
  },
}
```

A variable may also use a number as shorthand:

```tsx
variables: {
  c: 299_792_458,
}
```

Variable properties:

| Property       | Purpose                                                      |
| -------------- | ------------------------------------------------------------ |
| `name`         | Descriptive label                                            |
| `default`      | Initial value                                                |
| `input`        | `"drag"` for scrubbing or `"inline"` for direct entry        |
| `range`        | Minimum and maximum interactive values                       |
| `step`         | Change applied by one interaction increment                  |
| `precision`    | Fixed numeric precision                                      |
| `sigFigs`      | Number of significant figures                                |
| `latexDisplay` | Show the selector's `"name"`, `"value"`, or `"svg"` in situ  |
| `labelDisplay` | Show `"name"`, `"value"`, `"svg"`, or `"none"` in its label  |
| `svgContent`   | Function that maps the value and variable environment to SVG |
| `svgSize`      | Dimensions for the generated SVG                             |

Values can be numbers or lists. Lists can be displayed and used by
`semantics`, but they are not interactive. A variable's `svgContent` can
replace notation with a graphical representation that changes with the
variable value.

### Semantics

`semantics` is a JavaScript function whose context contains:

| Context member | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| `vars`         | Read declared inputs and assign computed outputs        |
| `sample`       | Record a named `{ x, y, z? }` point for a linked graph  |
| `step`         | Insert a walkthrough step                               |
| `latex`        | Format calculated numeric values for walkthrough labels |

Updating an interactive variable reruns the function and propagates affected
values to formulas and other linked artifacts.

```tsx
semantics: function ({ vars, sample }) {
  vars.y = Math.pow(vars.x, 2);
  sample("square", { x: vars.x, y: vars.y });
},
```

Ordinary JavaScript control flow, local values, loops, and conditionals can be
used inside `semantics`.

### Walkthroughs

Set `stepping: true` and call `step` from `semantics` to define an ordered
walkthrough. A step may have a description for the full formula and labels
attached to variables or expressions selected by literal LaTeX.

```tsx
stepping: true,
semantics: function ({ vars, step, latex }) {
  vars.y = Math.pow(vars.x, 2);

  step(
    {
      description: "Square the current input.",
      labels: {
        x: latex(vars.x).precision(2),
        y: latex(vars.y).precision(2),
      },
    },
    "square-step",
  );
},
```

Any number of steps can be emitted. They appear in execution order and can be
navigated forward and backward. The optional second `step` argument identifies
the step so linked graph elements can refer to it.

### Linked graphs

Graph samples are recorded in `semantics` and referenced by `sampleId`. Render
a configured 2D or 3D graph with the `Graph` component and its graph ID.

```tsx
import { Formula, Graph, Provider } from "delta-dsl";

<Provider config={config}>
  <Formula id="kinetic-energy" />
  <Graph id="energy-graph" />
</Provider>;
```

A 2D graph can contain lines, points, and vectors:

```tsx
graph2d: [
  {
    id: "energy-graph",
    xAxisVar: "v",
    yAxisVar: "K",
    lines: [
      {
        sampleId: "energy",
        parameter: "v",
        interaction: ["vertical-drag", "m"],
      },
    ],
    points: [
      {
        sampleId: "energy",
        interaction: ["horizontal-drag", "v"],
      },
    ],
  },
],
```

2D graph properties:

- Graph: `id`, `xAxisVar`, `yAxisVar`, `xAxisLabel`, `yAxisLabel`, `xRange`,
  `yRange`, `lines`, `points`, and `vectors`.
- Line: `sampleId`, `parameter`, `range`, `samples`, and `interaction`.
- Point: `sampleId`, `interaction`, `stepId`, and `persistence`.
- Vector: `startSampleId`, `endSampleId`, `label`, `interaction`, `curved`,
  `stepId`, and `persistence`.
- Drag interaction: `["horizontal-drag", variableId]` or
  `["vertical-drag", variableId]`.

A 3D graph can contain surfaces, lines, and points. Its properties are:

- Graph: `id`, `xRange`, `yRange`, `zRange`, `surfaces`, `lines`, and `points`.
- Surface: `sampleId`, `parameters`, `ranges`, and `samples`.
- Line: `sampleId`, `parameter`, `range`, and `samples`.
- Point: `sampleId`.

Points and vectors can use `stepId` to synchronize with a walkthrough. Setting
`persistence: true` keeps them visible as later steps are reached.

### Synchronization

Items inside the same `Provider` share variable values. Linked formula and
prose occurrences also synchronize hover highlighting. This supports:

- variables embedded in prose that stay linked to formula occurrences;
- multiple formulas synchronized through shared variable selectors;
- custom content that reads and writes the shared `vars` object; and
- bidirectional links between formulas and graphs.

## Implementation

Delta parses a formula's LaTeX into an AST with KaTeX, identifies configured
variables, and renders the augmented LaTeX to HTML with MathJax. Formula
labels use a ReactFlow canvas. A MobX store keeps variable values, hover state,
steps, and samples synchronized through React context.

## Repository development

```bash
git clone https://github.com/ericdai5/delta-dsl.git
cd delta-dsl
npm install
npm run dev
```

The development server runs at `http://localhost:3005`.

Run the repository checks with:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run build` creates the publishable library in `dist/`.
`prepublishOnly` runs tests, type checking, and the production build before
publication.

## License and support

Delta is available under the [MIT License](./LICENSE).

- [Source](https://github.com/ericdai5/delta-dsl)
- [Issues](https://github.com/ericdai5/delta-dsl/issues)
- [npm package](https://www.npmjs.com/package/delta-dsl)
