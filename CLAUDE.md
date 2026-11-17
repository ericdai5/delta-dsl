# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development

- `npm run dev` - Start development server on port 3005
- `npm run build` - Build for production (runs TypeScript compilation then Vite build)
- `npm run preview` - Preview production build locally
- `npm run deploy` - Deploy build to docs/forge/ directory

### Code Quality

- `npm run lint` - Run ESLint with TypeScript rules (max warnings: 0)
- `tsc` - Run TypeScript compiler for type checking

### Testing

No specific test commands are configured in package.json. Check for test files or ask the user about testing setup.

## Architecture Overview

### Core Application Structure

This is a **Formula Editor** built with React + TypeScript + Vite that provides interactive mathematical formula visualization and computation capabilities.

**Key Architecture Components:**

1. **Formulize API** (`src/formulize.ts`) - Main declarative API for creating interactive formula visualizations
2. **Formula Store System** - Multi-formula management using MobX stores:

   - `formulaStore` - Global formula state management
   - `selectionStore` - Canvas selection and interaction
   - `computationStore` - Variable computation and evaluation

3. **Computation Engines** (`src/engine/`):

   - `manual` - Manual step-through with JS interpreter
   - `symbolic-algebra` - Mathematical computation engine

4. **Formula Processing**:
   - LaTeX parsing and rendering with MathJax/KaTeX
   - AST manipulation via `FormulaTree.ts` and `AugmentedFormula`
   - Real-time formula editing

### Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: MobX with decorators (using legacy mode)
- **Styling**: Emotion CSS-in-JS + Tailwind CSS + Material-UI
- **Math Rendering**: KaTeX, MathJax
- **Code Editor**: CodeMirror 6 with JavaScript language support
- **Visualization**: D3.js, Plotly.js for 2D/3D plotting

### Key Application Modes

1. **Editor Mode** - Interactive formula editing with visual canvas
2. **Formulize API Mode** - Programmatic formula configuration and examples

### Important Technical Details

- Uses MobX decorators with `experimentalDecorators` enabled
- Emotion JSX runtime configured for CSS-in-JS
- Strict TypeScript configuration with full linting
- Multi-formula support with individual store management
- Variable dependency tracking and automatic recomputation

### File Structure Highlights

- `src/formula/` - Core formula editing components and handlers
- `src/pages/editor/` - Main editor interface components
- `src/pages/api/` - Formulize API examples and documentation
- `src/visualizations/` - 2D/3D plotting and custom visualization components
- `src/types/` - TypeScript type definitions for all major interfaces
- `src/examples/` - Example formula configurations

### Development Notes

- Development server runs on port 3005 (configured in vite.config.ts)
- Husky pre-commit hooks with lint-staged for code formatting
- Build output goes to `dist/` and can be deployed to `docs/forge/`
- Uses `.env` files for environment configuration (dotenv package)
