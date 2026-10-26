import { average } from "./average";
import { averageStepping } from "./average-stepping";
import { bayesWithCustomVisualization } from "./bayes-visualization";
import { bayesSimpleVisualization } from "./bayes-visualization-simple";
import { fittsLaw } from "./fitts-law";
import { gradientDescent } from "./gradient-descent";
import { gravitationalForce } from "./gravitational-force";
import { gravitationalPotential } from "./gravitational-potential";
import { waveEquationSVG } from "./js-generated-svg";
import { kinetic2D } from "./kinetic-2d";
import { kinetic3D } from "./kinetic-3d";
import { kineticEnergy } from "./kinetic-energy";
import { lossFunction } from "./loss-function";
import { matrixMultiplication } from "./matrix-multiplication";
import { newCanvas } from "./new-canvas";
import { parameterizedPlane } from "./parameterized-plane";
import { parametric3D } from "./parametric-3d";
import { quadratic2D } from "./quadratic-2d";
import { quadratic3D } from "./quadratic-3d";
import { setOperations } from "./set-operations";
import { simpleLoss } from "./simple-loss";
import { sinTheta } from "./sin-theta";
import { summationBasic } from "./summation-basic";
import { svgIntegration } from "./svg-integration";
import { svgKineticEnergy2D } from "./svg-labels";
import { task2instruction } from "./task-2-instruction";
import { task2training } from "./task-2-training";
import { nthSelection } from "./nth-selection";
import { vectorAddition } from "./vector-addition";

export const examples = {
  kinetic2D,
  kineticEnergy,
  nthSelection,
  kinetic3D,
  quadratic2D,
  quadratic3D,
  sinTheta,
  gravitationalForce,
  gravitationalPotential,
  parametric3D,
  parameterizedPlane,
  bayesWithCustomVisualization,
  bayesSimpleVisualization,
  average,
  averageStepping,
  summationBasic,
  svgIntegration,
  svgKineticEnergy2D,
  waveEquationSVG,
  vectorAddition,
  matrixMultiplication,
  lossFunction,
  simpleLoss,
  setOperations,
  fittsLaw,
  gradientDescent,
  task2training,
  task2instruction,
  newCanvas,
};

// The eight examples from Figure 1 of the paper, in figure order. The public
// Playground's picker shows only these, plus a new canvas.
export const featuredExamples = [
  "kinetic2D",
  "bayesSimpleVisualization",
  "svgIntegration",
  "average",
  "vectorAddition",
  "matrixMultiplication",
  "waveEquationSVG",
  "gradientDescent",
] as const;

// Public names for the featured examples, from Section 4.3 of the paper.
export const featuredExampleNames: Record<
  (typeof featuredExamples)[number],
  string
> = {
  kinetic2D: "Kinetic energy",
  bayesSimpleVisualization: "Probability operations",
  svgIntegration: "Exponential decay",
  average: "Arithmetic mean",
  vectorAddition: "Linear combination of vectors",
  matrixMultiplication: "Matrix multiplication",
  waveEquationSVG: "Harmonic motion",
  gradientDescent: "Gradient descent",
};

export const exampleDisplayNames = {
  kinetic2D: "Kinetic Energy 2D",
  kineticEnergy: "Kinetic Energy",
  nthSelection: "Nth Selection",
  kinetic3D: "Kinetic Energy 3D",
  gravitationalForce: "Gravitational Force",
  gravitationalPotential: "Potential Energy 2D",
  quadratic2D: "Quadratic Equation 2D",
  quadratic3D: "Quadratic Equation 3D",
  sinTheta: "Sine Function 2D",
  parametric3D: "Parametric 3D",
  parameterizedPlane: "Parameterized Plane 3D",
  bayesWithCustomVisualization: "Bayes Theorem",
  bayesSimpleVisualization: "Bayes Simple",
  average: "Average Stepping",
  averageStepping: "Average with Stepping",
  summationBasic: "Summation Stepping",
  svgIntegration: "SVG Radioactive Decay",
  svgKineticEnergy2D: "SVG Kinetic Energy",
  waveEquationSVG: "SVG Wave Equation",
  vectorAddition: "Vector Addition 2D",
  matrixMultiplication: "Matrix Multiplication 3x3",
  lossFunction: "Loss Function Stepping",
  simpleLoss: "Simple Loss Function",
  setOperations: "Set Operations",
  fittsLaw: "Fitts' Law 2D",
  gradientDescent: "Gradient Descent Stepping",
  task2training: "Task 2 Training",
  task2instruction: "Task 2 Instruction",
  newCanvas: "New canvas",
} as const;

export default examples;
