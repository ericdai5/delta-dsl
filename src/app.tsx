import { Navigate, Route, Routes } from "react-router-dom";

import { examples } from "./examples";
import APIPage from "./api";
import ExamplesPage from "./examples-page";
// import EditorPage from "./pages/editor/EditorPage";

// Get all example keys for routing
const exampleKeys = Object.keys(examples) as (keyof typeof examples)[];

function App() {
  return (
    <Routes>
      {/* The root opens the examples page */}
      <Route path="/" element={<Navigate to="/examples" replace />} />
      {/* Every public example as a card */}
      <Route path="/examples" element={<ExamplesPage />} />
      {/* Route for each example */}
      <Route path="/examples/:exampleId" element={<APIPage />} />
      {/* Fallback - redirect unknown routes to first example */}
      <Route
        path="*"
        element={<Navigate to={`/examples/${exampleKeys[0]}`} replace />}
      />
    </Routes>
  );
}

export default App;
