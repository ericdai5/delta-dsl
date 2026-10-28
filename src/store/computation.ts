import { action, computed, observable, toJS } from "mobx";

import { computeWithManualEngine } from "../engine/manual";
import { ISemantics } from "../types/computation";
import { IEnvironment } from "../types/environment";
import { IFormula } from "../types/formula";
import { IDataPoint } from "../types/graph";
import { ICollectedStep, IStepLabelValue, IView } from "../types/step";
import {
  INPUT_VARIABLE_DEFAULT,
  IValue,
  IVariable,
  getStepFromRange,
} from "../types/variable";
import { FormulaLatexRanges } from "../util/parse/formula-text";
import { canonicalizeFormula } from "../util/parse/formula-transform";
import {
  Aligned,
  AugmentedFormula,
  Group,
  RenderSpec,
  convertLatexToMathML,
  deriveTreeWithVars,
  parseVariableStrings,
  updateFormula as updateFormulaTree,
} from "../util/parse/formula-tree";

export type EvaluationFunctionInput = Record<string, number | number[]>;

export type EvaluationFunction = (
  variables: EvaluationFunctionInput
) => Record<string, IValue>;

class ComputationStore {
  @observable
  accessor variables = new Map<string, IVariable>();

  // Currently hovered variable IDs (multiple variables can be hovered, e.g., vector x and y)
  @observable
  accessor hoverStates = new Map<string, boolean>();

  // Currently dragged variable IDs (multiple variables can be dragged, e.g., vector x and y)
  @observable
  accessor dragStates = new Map<string, boolean>();

  // Currently inline-editing variable IDs (prevents formula re-render during editing)
  @observable
  accessor editingStates = new Map<string, boolean>();

  // Node hover states for visualization nodes (node ID -> hover state)
  @observable
  accessor nodeHoverStates = new Map<string, boolean>();

  // Formula hover states (formula ID -> hover state)
  @observable
  accessor formulaHoverStates = new Map<string, boolean>();

  // Callbacks for formula hover changes (for visualizations to react)
  private formulaHoverCallbacks: Set<
    (formulaId: string, isHovered: boolean) => void
  > = new Set();

  // Mapping from formula IDs to node IDs (for bidirectional hover)
  @observable
  accessor formulaNodeMapping = new Map<string, string>();

  // Reverse mapping from node IDs to formula IDs
  @observable
  accessor nodeFormulaMapping = new Map<string, string>();

  // Processed formula trees with cssId values assigned to nodes
  // Maps formula ID to the AugmentedFormula tree after variable processing
  // Used for DOM element lookup during expression bounding box calculations
  @observable
  accessor formulaTrees = new Map<string, AugmentedFormula>();

  // Per-formula render specifications
  @observable
  accessor formulaRenderSpecs = new Map<string, RenderSpec | null>();

  // Per-formula suppress editor update flag
  @observable
  accessor formulaSuppressEditorUpdate = new Map<string, boolean>();

  // Per-formula styled ranges override
  @observable
  accessor formulaStyledRangesOverride = new Map<
    string,
    FormulaLatexRanges | null
  >();

  @observable
  accessor semantics: ISemantics | null = null;

  @observable
  accessor formulas: IFormula[] = [];

  @observable
  accessor environment: IEnvironment | null = null;

  @observable
  accessor variableRolesChanged = 0;

  // Counts finished formula renders. MathJax renders asynchronously, so the
  // canvas watches this to measure variables once their new layout is final.
  @observable
  accessor formulaRenderCount = 0;

  // Centralized tracker for drag state - blocks hover activation while dragging
  @observable
  accessor isDragging = false;

  // Fresh variable dimensions from DOM measurements (varId -> { x, y, width, height })
  // Updated by updateVarNodes, used by calculateBoundingBoxFromVariableNodes
  @observable
  accessor variableDimensions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();

  // Track injected custom CSS to avoid re-injecting on re-renders
  @observable
  accessor injectedDefaultCSS = new Map<string, string>();

  @observable
  accessor injectedHoverCSS = new Map<string, string>();

  // Step mode - when enabled, labels show step values instead of live computed values
  @observable
  accessor stepping: boolean = false;

  // ============= Step Store Properties =============

  /** All collected steps from the latest semantics execution */
  @observable
  accessor steps: ICollectedStep[] = [];

  /** Current step index being viewed (0-based) */
  @observable
  accessor currentStepIndex: number = 0;

  /** Error message if step collection failed */
  @observable
  accessor stepError: string | null = null;

  /**
   * Separate storage for step mode values - completely isolated from main variables.
   * Only components observing stepValues will re-render when step values change.
   * This is similar to how plot data (lines, surfaces) is stored separately.
   */
  @observable
  accessor stepValues = new Map<string, IValue>();

  /**
   * Version counter for step values - incremented when stepValues changes.
   * Components can observe this to know when to re-read stepValues.
   */
  @observable
  accessor stepValuesVersion: number = 0;

  /**
   * Data points collected during step sampling.
   * Maps graph ID to array of {x, y} points in execution order.
   * Used by visualizations to show accumulated points based on step progress.
   */
  @observable
  accessor stepDataPointMap = new Map<string, IDataPoint[]>();

  private evaluationFunction: EvaluationFunction | null = null;

  isStepMode(): boolean {
    return this.stepping;
  }

  @action
  setStepping(enabled: boolean) {
    this.stepping = enabled;
  }

  // ============= Step Store Computed Getters =============

  /** Get the current step being viewed */
  get currentStep(): ICollectedStep | undefined {
    return this.steps[this.currentStepIndex];
  }

  /** Get the total number of collected steps */
  get totalSteps(): number {
    return this.steps.length;
  }

  /** Check if we're at the first step */
  get isAtStart(): boolean {
    return this.currentStepIndex === 0;
  }

  /** Check if we're at the last step */
  get isAtEnd(): boolean {
    return this.currentStepIndex >= this.steps.length - 1;
  }

  /** Get progress as a percentage (0-100) */
  get stepProgress(): number {
    if (this.steps.length === 0) return 0;
    return ((this.currentStepIndex + 1) / this.steps.length) * 100;
  }

  // ============= Step Store Actions =============

  /**
   * Set the collected steps from semantics execution.
   * Resets the current step index to 0 and updates stepValues immediately.
   */
  @action
  setSteps(steps: ICollectedStep[]): void {
    this.steps = steps;
    this.currentStepIndex = 0;
    this.stepError = null;
    // Update stepValues immediately to keep state consistent
    this.updateStepValues();
  }

  /**
   * Navigate to the next step.
   * Does nothing if already at the last step.
   */
  @action
  nextStep(): void {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
    }
  }

  /**
   * Navigate to the previous step.
   * Does nothing if already at the first step.
   */
  @action
  prevStep(): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    }
  }

  /**
   * Navigate to a specific step by index.
   * Clamps the index to valid range.
   */
  @action
  goToStep(index: number): void {
    if (this.steps.length === 0) return;
    this.currentStepIndex = Math.max(0, Math.min(index, this.steps.length - 1));
  }

  /**
   * Go to the first step.
   */
  @action
  goToStart(): void {
    this.currentStepIndex = 0;
  }

  /**
   * Go to the last step.
   */
  @action
  goToEnd(): void {
    if (this.steps.length > 0) {
      this.currentStepIndex = this.steps.length - 1;
    }
  }

  /**
   * Set an error message for step collection.
   */
  @action
  setStepError(error: string | null): void {
    this.stepError = error;
  }

  /**
   * Reset step-related state only.
   */
  @action
  resetSteps(): void {
    this.steps = [];
    this.currentStepIndex = 0;
    this.stepping = false;
    this.stepError = null;
    this.stepValues.clear();
    this.stepValuesVersion++;
  }

  /**
   * Get the view for a specific formula from the current step.
   * Returns the view for the given formulaId, or the default view (empty string key).
   *
   * @param formulaId - The formula ID to get the view for
   * @returns The view for the formula, or undefined if not found
   */
  getViewForFormula(formulaId: string): IView | undefined {
    const step = this.currentStep;
    if (!step) return undefined;

    // If step has per-formula views, use the specific one or fallback to default
    if (step.formulas) {
      return step.formulas[formulaId] ?? step.formulas[""];
    }

    // Otherwise, return a view constructed from the step's top-level properties
    return {
      description: step.description,
      labels: step.labels,
    };
  }

  /**
   * Check whether a step label key maps to a known variable id.
   */
  private isVariableLabelKey(labelLatex: string): boolean {
    return this.variables.has(labelLatex);
  }

  /**
   * Collect variable IDs from step label entries by matching labels keys to known varIds.
   * Keys that do not match a variable are treated as expression labels.
   */
  private getVariableIdsFromLabels(view: IView): Set<string> {
    const varIds = new Set<string>();
    if (!view.labels) {
      return varIds;
    }
    for (const labelLatex of Object.keys(view.labels)) {
      if (this.isVariableLabelKey(labelLatex)) {
        varIds.add(labelLatex);
      }
    }
    return varIds;
  }

  /**
   * Extract step value entries from labels where:
   * 1) the labels key is a known variable id, and
   * 2) the labels value is a runtime value (number or set), not a string-only display label.
   */
  private getVariableValueEntriesFromLabels(
    view: IView
  ): Array<[string, IValue]> {
    const entries: Array<[string, IValue]> = [];
    if (!view.labels) {
      return entries;
    }
    for (const [labelLatex, labelValue] of Object.entries(view.labels)) {
      if (!this.isVariableLabelKey(labelLatex)) {
        continue;
      }
      if (this.isRuntimeStepValue(labelValue)) {
        entries.push([labelLatex, labelValue]);
      }
    }
    return entries;
  }

  private isRuntimeStepValue(value: IStepLabelValue): value is IValue {
    return typeof value === "number" || Array.isArray(value);
  }

  /**
   * Get all variable values from the current step.
   * Merges values from all formula views if multi-formula step.
   *
   * @returns Map of variable ID to value
   */
  getCurrentStepValues(): Map<string, IValue> {
    const values = new Map<string, IValue>();
    const step = this.currentStep;
    if (!step) return values;

    // Collect values from per-formula views if present
    if (step.formulas) {
      for (const view of Object.values(step.formulas)) {
        for (const [varId, value] of this.getVariableValueEntriesFromLabels(
          view
        )) {
          values.set(varId, value);
        }
      }
      return values;
    }

    // Backstop for malformed step shape (should not happen from collector).
    if (step.labels) {
      for (const [labelLatex, labelValue] of Object.entries(step.labels)) {
        if (!this.isVariableLabelKey(labelLatex)) {
          continue;
        }
        if (this.isRuntimeStepValue(labelValue)) {
          values.set(labelLatex, labelValue);
        }
      }
    }

    return values;
  }

  /**
   * Get active variable IDs grouped by formula from the current step.
   * Used for applying visual cues to updated variables.
   *
   * @returns Map of formula ID to Set of variable IDs
   */
  getActiveVariables(): Map<string, Set<string>> {
    const activeVarsMap = new Map<string, Set<string>>();
    const step = this.currentStep;
    if (!step) return activeVarsMap;

    if (step.formulas) {
      // Multi-formula step: group by formula ID
      for (const [formulaId, view] of Object.entries(step.formulas)) {
        const varIds = this.getVariableIdsFromLabels(view);
        if (varIds.size > 0) {
          activeVarsMap.set(formulaId, varIds);
        }
      }
    } else {
      // Single formula step: use empty string key for "all formulas"
      const varIds = new Set<string>();
      if (step.labels) {
        for (const labelLatex of Object.keys(step.labels)) {
          if (this.isVariableLabelKey(labelLatex)) {
            varIds.add(labelLatex);
          }
        }
      }
      if (varIds.size > 0) {
        activeVarsMap.set("", varIds);
      }
    }

    return activeVarsMap;
  }

  get evaluateFormula(): EvaluationFunction | null {
    return this.evaluationFunction;
  }

  // ============= Step Values (Isolated Rendering) =============

  /**
   * Get the display value for a variable.
   * In step mode, returns the value from stepValues (isolated step data).
   * In normal mode, returns the value from the main variables map.
   *
   * @param varId - The variable ID
   * @returns The value to display, or undefined if not found
   */
  getDisplayValue(varId: string): IValue | undefined {
    if (this.stepping) {
      if (this.stepValues.has(varId)) {
        return this.stepValues.get(varId);
      }
    }
    return this.variables.get(varId)?.value;
  }

  /**
   * Update stepValues from the current step's data.
   * This is called when navigating steps or when input changes in step mode.
   * Only updates the stepValues map - does NOT touch the main variables map.
   */
  @action
  updateStepValues(): void {
    const step = this.currentStep;
    if (!step) {
      this.stepValues.clear();
      this.stepValuesVersion++;
      return;
    }

    // Clear and rebuild stepValues from current step
    this.stepValues.clear();

    // Collect values from per-formula labels entries
    if (step.formulas) {
      for (const view of Object.values(step.formulas)) {
        for (const [varId, value] of this.getVariableValueEntriesFromLabels(
          view
        )) {
          this.stepValues.set(varId, value);
        }
      }
    } else if (step.labels) {
      for (const [labelLatex, labelValue] of Object.entries(step.labels)) {
        if (!this.isVariableLabelKey(labelLatex)) {
          continue;
        }
        if (this.isRuntimeStepValue(labelValue)) {
          this.stepValues.set(labelLatex, labelValue);
        }
      }
    }

    this.stepValuesVersion++;
  }

  /**
   * Sample the current step and update stepValues.
   * Used when input variables change in step mode.
   * This re-runs the semantics to get fresh values for the current step.
   */
  @action
  refreshCurrentStepValues(): void {
    if (!this.semantics || typeof this.semantics !== "function") {
      return;
    }

    try {
      // Sample all steps with current input values
      const steps = this.sampleSteps();

      // Update steps array (this keeps total count accurate)
      this.steps = steps;

      // Clamp current index if needed
      if (steps.length === 0) {
        this.currentStepIndex = 0;
      } else if (this.currentStepIndex >= steps.length) {
        this.currentStepIndex = steps.length - 1;
      }

      // Update stepValues from the current step
      this.updateStepValues();
    } catch (error) {
      console.error("[refreshCurrentStepValues] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.stepError = errorMessage;
    }
  }

  /**
   * Create a snapshot copy of all variables for sampling/computation.
   * Uses toJS to create deep copies that won't affect the original observables.
   */
  getVariablesSnapshot(): Record<string, IVariable> {
    const snapshot: Record<string, IVariable> = {};
    for (const [varName, variable] of this.variables.entries()) {
      snapshot[varName] = { ...toJS(variable) };
    }
    return snapshot;
  }

  @action
  setSemantics(config: ISemantics | null) {
    this.semantics = config;
  }

  @action
  reset() {
    this.variables.clear();
    this.hoverStates.clear();
    this.dragStates.clear();
    this.nodeHoverStates.clear();
    this.formulaHoverStates.clear();
    this.formulaNodeMapping.clear();
    this.nodeFormulaMapping.clear();
    this.formulaHoverCallbacks.clear();
    this.injectedDefaultCSS.clear();
    this.injectedHoverCSS.clear();
    this.formulaTrees.clear();
    this.formulaRenderSpecs.clear();
    this.formulaSuppressEditorUpdate.clear();
    this.formulaStyledRangesOverride.clear();
    this.environment = null;
    this.formulas = [];
    this.semantics = null;
    this.evaluationFunction = null;
    // Reset step-related state
    this.steps = [];
    this.currentStepIndex = 0;
    this.stepping = false;
    this.stepError = null;
    this.stepValues.clear();
    this.stepValuesVersion++;
    this.stepDataPointMap.clear();
    // Remove custom CSS style element
    const styleElement = document.getElementById("custom-var-styles");
    if (styleElement) {
      styleElement.remove();
    }
  }

  /**
   * Store a processed formula tree for later DOM element lookup
   * @param formulaId - The formula ID
   * @param tree - The AugmentedFormula tree with cssId values assigned
   */
  @action
  setFormulaTree(formulaId: string, tree: AugmentedFormula) {
    this.formulaTrees.set(formulaId, tree);
  }

  /**
   * Get the stored formula tree for a formula
   * @param formulaId - The formula ID
   * @returns The AugmentedFormula tree or undefined if not found
   */
  getFormulaTree(formulaId: string): AugmentedFormula | undefined {
    return this.formulaTrees.get(formulaId);
  }

  /**
   * Clear all stored formula trees
   */
  @action
  clearFormulaTrees() {
    this.formulaTrees.clear();
  }

  // ============= Formula Store Methods (consolidated from FormulaStore) =============

  /**
   * Get the render spec for a formula
   * @param formulaId - The formula ID
   * @returns The RenderSpec or null if not found
   */
  getFormulaRenderSpec(formulaId: string): RenderSpec | null {
    return this.formulaRenderSpecs.get(formulaId) ?? null;
  }

  /**
   * Get the augmented formula for a formula ID
   * @param formulaId - The formula ID
   * @returns The AugmentedFormula or a default empty one
   */
  getAugmentedFormula(formulaId: string): AugmentedFormula {
    return this.formulaTrees.get(formulaId) ?? new AugmentedFormula([]);
  }

  /**
   * Get the suppress editor update flag for a formula
   * @param formulaId - The formula ID
   * @returns Whether editor updates should be suppressed
   */
  getSuppressEditorUpdate(formulaId: string): boolean {
    return this.formulaSuppressEditorUpdate.get(formulaId) ?? false;
  }

  /**
   * Get the styled ranges override for a formula
   * @param formulaId - The formula ID
   * @returns The styled ranges override or null
   */
  getStyledRangesOverride(formulaId: string): FormulaLatexRanges | null {
    return this.formulaStyledRangesOverride.get(formulaId) ?? null;
  }

  /**
   * Get the LaTeX representation with styling for a formula
   * @param formulaId - The formula ID
   * @returns The LaTeX string with styling
   */
  getLatexWithStyling(formulaId: string): string {
    const formula = this.getAugmentedFormula(formulaId);
    return formula.toLatex("no-id");
  }

  /**
   * Get the LaTeX representation without styling for a formula
   * @param formulaId - The formula ID
   * @returns The LaTeX string without styling
   */
  getLatexWithoutStyling(formulaId: string): string {
    const formula = this.getAugmentedFormula(formulaId);
    return formula.toLatex("content-only");
  }

  /**
   * Get the styled ranges for a formula
   * @param formulaId - The formula ID
   * @returns The styled ranges (override or computed from formula)
   */
  getStyledRanges(formulaId: string): FormulaLatexRanges {
    const override = this.formulaStyledRangesOverride.get(formulaId);
    if (override) {
      return override;
    }
    const formula = this.getAugmentedFormula(formulaId);
    return formula.toStyledRanges();
  }

  /**
   * Get the align IDs for a formula (for aligned environments)
   * @param formulaId - The formula ID
   * @returns 2D array of IDs or null if not an aligned formula
   */
  getAlignIds(formulaId: string): string[][] | null {
    const formula = this.getAugmentedFormula(formulaId);
    if (formula.children.length !== 1) {
      return null;
    }
    const rootNode = formula.children[0];
    if (rootNode instanceof Aligned) {
      return rootNode.body.map((row) => row.map((node) => node.id));
    }
    return null;
  }

  /**
   * Get the align column IDs for a formula
   * @param formulaId - The formula ID
   * @returns 2D array of column IDs or null if not an aligned formula
   */
  getAlignColumnIds(formulaId: string): string[][] | null {
    const formula = this.getAugmentedFormula(formulaId);
    if (formula.children.length !== 1) {
      return null;
    }
    const rootNode = formula.children[0];
    if (rootNode instanceof Aligned) {
      return [
        ...Array(Math.max(...rootNode.body.map((row) => row.length))).keys(),
      ].map((col) =>
        rootNode.body.flatMap((row) => (col < row.length ? [row[col].id] : []))
      );
    }
    return null;
  }

  /**
   * Get the align row internal targets for a formula
   * @param formulaId - The formula ID
   * @returns Array of row targets or null if not an aligned formula
   */
  getAlignRowInternalTargets(
    formulaId: string
  ): { id: string; col: number }[][] | null {
    const formula = this.getAugmentedFormula(formulaId);
    if (formula.children.length !== 1) {
      return null;
    }
    const rootNode = formula.children[0];
    if (rootNode instanceof Aligned) {
      return rootNode.body.map((row) =>
        row.flatMap((node, col) =>
          node instanceof Group
            ? node.body.map((child) => ({ id: child.id, col }))
            : [{ id: node.id, col }]
        )
      );
    }
    return null;
  }

  /**
   * Get the MathML representation for a formula
   * @param formulaId - The formula ID
   * @returns Promise resolving to the MathML string
   */
  async getMathML(formulaId: string): Promise<string> {
    const formula = this.getAugmentedFormula(formulaId);
    const latex = formula.toLatex("content-only");
    return convertLatexToMathML(latex);
  }

  /**
   * Update a formula with a new AugmentedFormula
   * @param formulaId - The formula ID
   * @param newFormula - The new AugmentedFormula
   */
  @action
  updateFormula(formulaId: string, newFormula: AugmentedFormula): void {
    const currentFormula = this.formulaTrees.get(formulaId);
    if (currentFormula && currentFormula.equals(newFormula)) {
      return;
    }
    const canonicalized = canonicalizeFormula(newFormula);
    const { renderSpec } = updateFormulaTree(canonicalized);
    this.formulaRenderSpecs.set(formulaId, renderSpec);
    this.formulaTrees.set(formulaId, canonicalized);
  }

  /**
   * Restore formula state from LaTeX string
   * @param formulaId - The formula ID
   * @param latex - The LaTeX string to parse
   */
  @action
  restoreFormulaState(formulaId: string, latex: string): void {
    const allVariableSymbols = Array.from(this.variables.keys()).filter(
      (symbol) => symbol && symbol.length > 0
    );
    const variableTrees = parseVariableStrings(allVariableSymbols);
    const newFormula = deriveTreeWithVars(
      latex,
      variableTrees,
      allVariableSymbols
    );
    const { renderSpec } = updateFormulaTree(newFormula);
    this.formulaRenderSpecs.set(formulaId, renderSpec);
    this.formulaTrees.set(formulaId, newFormula);
  }

  /**
   * Override the styled ranges for a formula
   * @param formulaId - The formula ID
   * @param styledRanges - The styled ranges to set (or null to clear)
   */
  @action
  overrideStyledRanges(
    formulaId: string,
    styledRanges: FormulaLatexRanges | null
  ): void {
    this.formulaStyledRangesOverride.set(formulaId, styledRanges);
  }

  /**
   * Set the suppress editor update flag for a formula
   * @param formulaId - The formula ID
   * @param suppress - Whether to suppress editor updates
   */
  @action
  setSuppressEditorUpdate(formulaId: string, suppress: boolean): void {
    this.formulaSuppressEditorUpdate.set(formulaId, suppress);
  }

  /**
   * Initialize a formula store for a given ID with optional initial LaTeX
   * @param formulaId - The formula ID
   * @param formulaLatex - Optional initial LaTeX string
   */
  @action
  initializeFormula(formulaId: string, formulaLatex?: string): void {
    if (formulaLatex) {
      const allVariableSymbols = Array.from(this.variables.keys()).filter(
        (symbol) => symbol && symbol.length > 0
      );
      const variableTrees = parseVariableStrings(allVariableSymbols);
      const formula = deriveTreeWithVars(
        formulaLatex,
        variableTrees,
        allVariableSymbols
      );
      const canonicalFormula = canonicalizeFormula(formula);
      this.updateFormula(formulaId, canonicalFormula);
    } else {
      // Initialize with empty formula
      this.formulaTrees.set(formulaId, new AugmentedFormula([]));
      this.formulaRenderSpecs.set(formulaId, null);
    }
    this.formulaSuppressEditorUpdate.set(formulaId, false);
    this.formulaStyledRangesOverride.set(formulaId, null);
  }

  /**
   * Remove a formula and all its associated state
   * @param formulaId - The formula ID to remove
   */
  @action
  removeFormula(formulaId: string): void {
    this.formulaTrees.delete(formulaId);
    this.formulaRenderSpecs.delete(formulaId);
    this.formulaSuppressEditorUpdate.delete(formulaId);
    this.formulaStyledRangesOverride.delete(formulaId);
  }

  /**
   * Check if a formula exists
   * @param formulaId - The formula ID
   * @returns Whether the formula exists
   */
  hasFormula(formulaId: string): boolean {
    return this.formulaTrees.has(formulaId);
  }

  // ============= End Formula Store Methods =============

  /**
   * Update fresh dimensions for a variable (called during variable node creation/update)
   * @param varId - The variable ID
   * @param dimensions - The position and dimensions of the variable element
   */
  @action
  setVariableDimensions(
    varId: string,
    dimensions: { x: number; y: number; width: number; height: number }
  ) {
    this.variableDimensions.set(varId, dimensions);
  }

  /**
   * Get fresh dimensions for a variable
   * @param varId - The variable ID
   * @returns The dimensions or undefined if not found
   */
  getVariableDimensions(varId: string) {
    return this.variableDimensions.get(varId);
  }

  @action
  setVariableRolesChanged(value: number) {
    this.variableRolesChanged = value;
  }

  @action
  markFormulaRendered() {
    this.formulaRenderCount++;
  }

  @action
  setFormulas(formulas: IFormula[]) {
    this.formulas = formulas;
  }

  @action
  setEnvironment(environment: IEnvironment) {
    // Validate and normalize fontSize, setting default if not provided
    // Valid range is 0.5 to 3.0 (em units for MathJax rendering)
    const validatedFontSize =
      environment.fontSize !== undefined
        ? typeof environment.fontSize === "number" &&
          environment.fontSize >= 0.5 &&
          environment.fontSize <= 3.0
          ? environment.fontSize
          : 1 // Invalid value, use default of 1em
        : 1; // Default fontSize when not defined (1em for good visibility)

    const validatedLabelFontSize =
      environment.labelFontSize !== undefined
        ? typeof environment.labelFontSize === "number" &&
          environment.labelFontSize >= 0.5 &&
          environment.labelFontSize <= 3.0
          ? environment.labelFontSize
          : 0.8
        : 0.8;

    // Always set environment with validated fontSize and labelFontSize
    this.environment = {
      ...environment,
      fontSize: validatedFontSize,
      labelFontSize: validatedLabelFontSize,
    };
  }

  @action
  setValue(id: string, value: number) {
    const variable = this.variables.get(id);
    if (!variable) {
      return false;
    }

    // Skip if value hasn't changed (avoid redundant updates)
    if (variable.value === value) {
      return true;
    }

    variable.value = value;

    if (this.stepping) {
      // In step mode: refresh step values (isolated from main variables)
      // This re-samples the semantics and updates stepValues only
      this.refreshCurrentStepValues();
    } else {
      // Normal mode: re-run computation to update dependent variables
      this.runComputation();
    }
  }

  @action
  setSetValue(id: string, set: (string | number)[]) {
    const variable = this.variables.get(id);
    if (!variable) {
      return false;
    }
    variable.value = set;

    if (this.stepping) {
      // In step mode: refresh step values (isolated from main variables)
      this.refreshCurrentStepValues();
    } else {
      // Normal mode: re-run computation to update dependent variables
      this.runComputation();
    }
    return true;
  }

  /**
   * Set a step value directly in the stepValues map.
   * Used by the Controller when applying step state.
   * Does NOT touch the main variables map.
   */
  @action
  setStepValue(id: string, value: IValue): void {
    this.stepValues.set(id, value);
  }

  @action
  setDragging(dragging: boolean) {
    this.isDragging = dragging;
  }

  @action
  setVariableDrag(varId: string, isDragging: boolean) {
    if (isDragging) {
      // Clear hover state when drag starts to avoid stale hover after drag ends
      this.hoverStates.clear();
      this.dragStates.set(varId, true);
      this.isDragging = true;
    } else {
      this.dragStates.delete(varId);
      // Update isDragging based on whether any variables are still being dragged
      this.isDragging = this.dragStates.size > 0;
    }
  }

  @action
  setVariableHover(varId: string, isHovered: boolean) {
    // Block hover changes while dragging to prevent other variables from highlighting
    if (this.isDragging) {
      return;
    }
    if (isHovered) {
      this.hoverStates.set(varId, true);
    } else {
      this.hoverStates.delete(varId);
    }
  }

  // Check if a variable is being dragged
  isVariableDragging(varId: string): boolean {
    return this.dragStates.get(varId) ?? false;
  }

  @action
  setVariableEditing(varId: string, isEditing: boolean) {
    if (isEditing) {
      this.editingStates.set(varId, true);
    } else {
      this.editingStates.delete(varId);
    }
  }

  // Check if a variable is being inline edited
  isVariableEditing(varId: string): boolean {
    return this.editingStates.get(varId) ?? false;
  }

  // Check if a variable is being hovered
  isVariableHovered(varId: string): boolean {
    return this.hoverStates.get(varId) ?? false;
  }

  // Check if a variable should be visually highlighted (drag takes precedence over hover)
  isVariableHighlighted(varId: string): boolean {
    return this.dragStates.get(varId) ?? this.hoverStates.get(varId) ?? false;
  }

  // Get all highlighted variable IDs (drag takes precedence over hover)
  @computed
  get highlightedVarIds(): string[] {
    if (this.dragStates.size > 0) {
      return Array.from(this.dragStates.keys());
    }
    return Array.from(this.hoverStates.keys());
  }

  // ============= Bidirectional Hover System =============

  /**
   * Set the mapping between formula IDs and visualization node IDs
   */
  @action
  setFormulaNodeMapping(mapping: Record<string, string>) {
    this.formulaNodeMapping.clear();
    this.nodeFormulaMapping.clear();
    for (const [formulaId, nodeId] of Object.entries(mapping)) {
      this.formulaNodeMapping.set(formulaId, nodeId);
      this.nodeFormulaMapping.set(nodeId, formulaId);
    }
  }

  /**
   * Set hover state for a visualization node
   * This will trigger the corresponding formula to highlight
   */
  @action
  setNodeHover(nodeId: string, isHovered: boolean) {
    this.nodeHoverStates.set(nodeId, isHovered);
    // Find the corresponding formula and trigger its hover state
    const formulaId = this.nodeFormulaMapping.get(nodeId);
    if (formulaId) {
      this.setFormulaHover(formulaId, isHovered);
    }
  }

  /**
   * Get hover state for a visualization node
   */
  getNodeHover(nodeId: string): boolean {
    return this.nodeHoverStates.get(nodeId) ?? false;
  }

  /**
   * Set hover state for a formula
   * This notifies visualizations that a formula is being hovered
   */
  @action
  setFormulaHover(formulaId: string, isHovered: boolean) {
    const prevState = this.formulaHoverStates.get(formulaId) ?? false;
    if (prevState !== isHovered) {
      this.formulaHoverStates.set(formulaId, isHovered);
      // Notify all registered callbacks
      this.formulaHoverCallbacks.forEach((callback) => {
        callback(formulaId, isHovered);
      });
      // Also set the corresponding node hover state
      const nodeId = this.formulaNodeMapping.get(formulaId);
      if (nodeId && this.nodeHoverStates.get(nodeId) !== isHovered) {
        this.nodeHoverStates.set(nodeId, isHovered);
      }
    }
  }

  /**
   * Get hover state for a formula
   */
  getFormulaHover(formulaId: string): boolean {
    return this.formulaHoverStates.get(formulaId) ?? false;
  }

  /**
   * Subscribe to formula hover changes
   * Returns an unsubscribe function
   */
  onFormulaHoverChange(
    callback: (formulaId: string, isHovered: boolean) => void
  ): () => void {
    this.formulaHoverCallbacks.add(callback);
    return () => {
      this.formulaHoverCallbacks.delete(callback);
    };
  }

  // ============= End Bidirectional Hover System =============

  @observable
  accessor refreshCallback: (() => void) | null = null;

  @action
  setRefreshCallback(callback: (() => void) | null) {
    this.refreshCallback = callback;
  }

  // Set up the semantics function for computation
  @action
  async setComputation() {
    // Set up the evaluation function if semantics is defined
    if (this.semantics) {
      this.evaluationFunction = this.createEvaluator();
    }
  }

  // Create an evaluation function using the semantics function
  // The function directly mutates the store's observable variables via proxy
  private createEvaluator(): EvaluationFunction {
    return () => {
      if (!this.environment) return {};
      // Pass the store's observable variables directly (same references)
      // The proxy in manual.ts will mutate them, triggering MobX reactivity
      const storeVariables: Record<string, IVariable> = {};
      for (const [varName, variable] of this.variables.entries()) {
        storeVariables[varName] = variable; // Same reference, not a copy
      }
      // Run the semantics function - it mutates variables directly via proxy
      computeWithManualEngine(storeVariables, this.semantics ?? undefined);
      // No need to sync back or return values - mutations happen directly
      return {};
    };
  }

  @action
  addVariable(id: string, variableDefinition?: Partial<IVariable>) {
    if (!this.variables.has(id)) {
      this.variables.set(id, {
        value: variableDefinition?.value ?? undefined,
        dataType: variableDefinition?.dataType,
        dimensions: variableDefinition?.dimensions,
        units: variableDefinition?.units,
        name: variableDefinition?.name,
        precision:
          variableDefinition?.precision ?? INPUT_VARIABLE_DEFAULT.PRECISION,
        sigFigs: variableDefinition?.sigFigs,
        description: variableDefinition?.description,
        range: variableDefinition?.range,
        step:
          variableDefinition?.step ??
          getStepFromRange(variableDefinition?.range),
        options: variableDefinition?.options,
        key: variableDefinition?.key,
        latexDisplay: variableDefinition?.latexDisplay ?? "name",
        labelDisplay: variableDefinition?.labelDisplay ?? "value",
        svgPath: variableDefinition?.svgPath,
        svgContent: variableDefinition?.svgContent,
        svgSize: variableDefinition?.svgSize,
        svgMode: variableDefinition?.svgMode,
        defaultCSS: variableDefinition?.defaultCSS,
        hoverCSS: variableDefinition?.hoverCSS,
        input: variableDefinition?.input,
        filter: variableDefinition?.filter,
        exclude: variableDefinition?.exclude,
      });
    }
  }

  @action
  setVariableInput(id: string, input: "drag" | "inline" | undefined) {
    const variable = this.variables.get(id);
    if (!variable) {
      return;
    }

    if (variable.input === input) {
      return;
    }

    variable.input = input;

    // Get the environment variable if it exists and set default range for drag input
    if (input === "drag" && !variable.range) {
      if (this.environment?.variables) {
        const envVar = this.environment.variables[id];
        if (envVar && typeof envVar !== "number" && envVar.range) {
          variable.range = envVar.range;
        } else {
          variable.range = [-10, 10];
        }
      } else {
        variable.range = [-10, 10];
      }
    }

    if (variable.step === undefined && variable.range) {
      variable.step = getStepFromRange(variable.range);
    }

    this.variableRolesChanged++;
  }

  /**
   * Trigger computation by running the manual function.
   * The manual function directly mutates observable variables via proxy.
   */
  @action
  runComputation() {
    if (!this.evaluationFunction) return;
    try {
      this.evaluationFunction({});
    } catch (error) {
      console.error("Error running computation:", error);
    }
  }

  getDebugState() {
    return {
      variables: Array.from(this.variables.entries()).map(([id, v]) => ({
        id,
        value: v.value,
        input: v.input,
      })),
      hasFunction: !!this.evaluationFunction,
    };
  }

  // ============= Step Data Collection =============

  /**
   * Run the semantics function once with current values and collect all step() calls.
   * This follows the reactive data collection pattern similar to sample2DPoint/sample3DPoint.
   * Also stores the dataPointMap for step-dependent point visualization.
   *
   * @returns Array of collected steps from the semantics execution
   */
  @action
  sampleSteps(): ICollectedStep[] {
    if (!this.semantics || typeof this.semantics !== "function") {
      return [];
    }
    const variables = this.getVariablesSnapshot();
    const result = computeWithManualEngine(variables, this.semantics, true);
    // Store dataPointMap for step-dependent visualizations
    this.stepDataPointMap = result.dataPointMap;
    return result.stepList;
  }

  // ============= Graph Data Collection =============

  /**
   * Extract a 2D point from dataPoints map.
   * @param dataPointMap - Map of graph ID to data points
   * @param graphId - The graph ID to look up
   * @param position - Which point to extract: "first" for lines (parameter variation), "last" for points (final state)
   * @returns The valid {x, y} point or null
   */
  private extractPoint2D(
    dataPointMap: Map<string, IDataPoint[]>,
    graphId: string,
    position: "first" | "last" = "first"
  ): { x: number; y: number } | null {
    const dataPoints = dataPointMap.get(graphId);
    if (!dataPoints || dataPoints.length === 0) return null;
    const index = position === "last" ? dataPoints.length - 1 : 0;
    const { x, y } = dataPoints[index];
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      isFinite(x) &&
      isFinite(y)
    ) {
      return { x, y };
    }
    return null;
  }

  /**
   * Extract a 3D point from dataPoints map.
   * @param dataPoints - Map of graph ID to data points
   * @param graphId - The graph ID to look up
   * @param position - Which point to extract: "first" for lines (parameter variation), "last" for points (final state)
   * @returns The valid {x, y, z} point or null
   */
  private extractPoint3D(
    dataPointMap: Map<string, IDataPoint[]>,
    graphId: string,
    position: "first" | "last" = "first"
  ): { x: number; y: number; z: number } | null {
    const dataPoints = dataPointMap.get(graphId);
    if (!dataPoints || dataPoints.length === 0) return null;
    const index = position === "last" ? dataPoints.length - 1 : 0;
    const { x, y, z } = dataPoints[index];
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      typeof z === "number" &&
      isFinite(x) &&
      isFinite(y) &&
      isFinite(z)
    ) {
      return { x, y, z };
    }
    return null;
  }

  /**
   * Run semantics function with given variables and extract a 2D point.
   * @param variables - Variable values to use
   * @param graphId - Graph ID to match sample() calls
   * @returns The {x, y} point or null
   */
  private computeAndExtract2D(
    variables: Record<string, IVariable>,
    graphId: string
  ): { x: number; y: number } | null {
    if (!this.semantics || typeof this.semantics !== "function") return null;
    const result = computeWithManualEngine(variables, this.semantics);
    return this.extractPoint2D(result.dataPointMap, graphId);
  }

  /**
   * Run semantics function with given variables and extract a 3D point.
   * @param variables - Variable values to use
   * @param graphId - Graph ID to match sample() calls
   * @returns The {x, y, z} point or null
   */
  private computeAndExtract3D(
    variables: Record<string, IVariable>,
    graphId: string
  ): { x: number; y: number; z: number } | null {
    if (!this.semantics || typeof this.semantics !== "function") return null;
    const result = computeWithManualEngine(variables, this.semantics);
    return this.extractPoint3D(result.dataPointMap, graphId);
  }

  /**
   * Generic helper to sample the semantic function across a parameter range.
   * Varies a single parameter across its range and collects points using the provided extractor.
   *
   * @param parameter - The variable to vary during sampling
   * @param range - The range to sample [min, max]
   * @param samples - Number of samples
   * @param graphId - Graph ID to match data calls
   * @param extractor - Function to extract point from variables (computeAndExtract2D or computeAndExtract3D)
   * @returns Array of extracted points
   */
  private sampleWithParameter<T>(
    parameter: string,
    range: [number, number],
    samples: number,
    graphId: string,
    extractor: (
      variables: Record<string, IVariable>,
      graphId: string
    ) => T | null
  ): T[] {
    const [min, max] = range;
    const step = (max - min) / samples;
    const points: T[] = [];
    const baseVariables = this.getVariablesSnapshot();
    for (let i = 0; i <= samples; i++) {
      const paramValue = min + i * step;
      baseVariables[parameter] = {
        ...baseVariables[parameter],
        value: paramValue,
      };
      const point = extractor(baseVariables, graphId);
      if (point) points.push(point);
    }
    return points;
  }

  /**
   * Run the semantic function once with current values to get the current 2D point.
   * Reads x, y values from the dataPoints (from explicit sample() calls).
   * Uses the LAST sampled point to show final state after loop iterations.
   *
   * @param graphId - Graph ID to match sample() calls
   * @returns The current {x, y} point or null
   */
  sample2DPoint(graphId: string): { x: number; y: number } | null {
    if (!this.semantics || typeof this.semantics !== "function") return null;
    const result = computeWithManualEngine(
      this.getVariablesSnapshot(),
      this.semantics
    );
    // Use "last" to get final state after all iterations
    return this.extractPoint2D(result.dataPointMap, graphId, "last");
  }

  /**
   * Run the semantic function once with current values to get the current 3D point.
   * Reads x, y, z values from the dataPoints (from explicit sample() calls).
   * Uses the LAST sampled point to show final state after loop iterations.
   *
   * @param graphId - Graph ID to match sample() calls
   * @returns The current {x, y, z} point or null
   */
  sample3DPoint(graphId: string): { x: number; y: number; z: number } | null {
    if (!this.semantics || typeof this.semantics !== "function") return null;
    const result = computeWithManualEngine(
      this.getVariablesSnapshot(),
      this.semantics
    );
    // Use "last" to get final state after all iterations
    return this.extractPoint3D(result.dataPointMap, graphId, "last");
  }

  /**
   * Sample the semantic function across a parameter range to collect 2D line data.
   * Reads x, y values from the dataPoints (from explicit sample() calls).
   *
   * @param parameter - The variable to vary during sampling
   * @param range - The range to sample [min, max]
   * @param samples - Number of samples (default 100)
   * @param graphId - Graph ID to match sample() calls
   * @returns Array of {x, y} points
   */
  sample2DLine(
    parameter: string,
    range: [number, number],
    samples: number = 100,
    graphId: string
  ): { x: number; y: number }[] {
    return this.sampleWithParameter(
      parameter,
      range,
      samples,
      graphId,
      this.computeAndExtract2D.bind(this)
    );
  }

  /**
   * Sample the semantic function across a parameter range to collect 3D line data.
   * Reads x, y, z values from the dataPoints (from explicit sample() calls).
   *
   * @param parameter - The variable to vary during sampling
   * @param range - The range to sample [min, max]
   * @param samples - Number of samples (default 100)
   * @param graphId - Graph ID to match sample() calls
   * @returns Array of {x, y, z} points
   */
  sample3DLine(
    parameter: string,
    range: [number, number],
    samples: number = 100,
    graphId: string
  ): { x: number; y: number; z: number }[] {
    return this.sampleWithParameter(
      parameter,
      range,
      samples,
      graphId,
      this.computeAndExtract3D.bind(this)
    );
  }

  /**
   * Sample the semantic function across a 2D parameter grid to collect surface data.
   * Reads x, y, z values from the dataPoints (from explicit sample() calls).
   *
   * @param parameters - The two variables to vary during sampling [param1, param2]
   * @param ranges - The ranges for each parameter [[min1, max1], [min2, max2]]
   * @param samples - Number of samples per dimension (default 50)
   * @param graphId - Graph ID to match sample() calls
   * @returns Array of {x, y, z} points
   */
  sampleSurface(
    parameters: [string, string],
    ranges: [[number, number], [number, number]],
    samples: number = 50,
    graphId: string
  ): { x: number; y: number; z: number }[] {
    const [param1, param2] = parameters;
    const [[min1, max1], [min2, max2]] = ranges;
    const step1 = (max1 - min1) / samples;
    const step2 = (max2 - min2) / samples;
    const points: { x: number; y: number; z: number }[] = [];
    const baseVariables = this.getVariablesSnapshot();
    for (let i = 0; i <= samples; i++) {
      const value1 = min1 + i * step1;
      for (let j = 0; j <= samples; j++) {
        const value2 = min2 + j * step2;
        baseVariables[param1] = { ...baseVariables[param1], value: value1 };
        baseVariables[param2] = { ...baseVariables[param2], value: value2 };
        const point = this.computeAndExtract3D(baseVariables, graphId);
        if (point) points.push(point);
      }
    }
    return points;
  }

  // Get resolved variables as a plain object for external use
  // This is the total collection of variables after the system
  // has processed the user-written variables settings.
  // Converts MobX observables to plain JavaScript objects for serialization.
  getVariables(): Record<string, IVariable> {
    const variables: Record<string, IVariable> = {};
    for (const [varName, variable] of this.variables.entries()) {
      variables[varName] = toJS(variable);
    }
    return variables;
  }
}

/**
 * Factory function to create a new ComputationStore instance.
 * Used for creating scoped stores per Provider.
 */
export function createComputationStore(): ComputationStore {
  return new ComputationStore();
}

// Export the class for type usage
export { ComputationStore };
