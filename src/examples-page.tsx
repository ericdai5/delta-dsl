import { Link } from "react-router-dom";

import { exampleDisplayNames } from "./examples";
import { ExampleCardContent } from "./internal/example-card";
import {
  exampleCardClass,
  otherExampleKeys,
  publicExampleKeys,
} from "./internal/example-list";
import PlaygroundBreadcrumb from "./internal/playground-breadcrumb";

// The Playground's examples page: every public example as a card that opens it.
const ExamplesPage = () => (
  <div className="h-full flex flex-col">
    <header className="flex h-12 flex-shrink-0 items-center border-b border-slate-200 bg-white px-4">
      <PlaygroundBreadcrumb />
    </header>
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* 320px cards 16px apart, at most four to a row: 4 × 320px cards,
          3 × 16px gaps, and 24px of padding on each side make 1376px. Auto
          margins center the grid in the page, and still let it scroll from
          the top when it is taller than the window. */}
      <div className="m-auto grid w-full max-w-[1376px] grid-cols-[repeat(auto-fill,320px)] justify-center gap-4 p-6">
        {publicExampleKeys.map((key) => (
          <Link
            key={key}
            className={exampleCardClass(false)}
            to={`/examples/${key}`}
          >
            <ExampleCardContent exampleKey={key} />
          </Link>
        ))}
      </div>

      {/* The full example list stays available in local development. */}
      {import.meta.env.DEV && (
        <div className="mx-auto w-full max-w-[1376px] px-6 pb-6">
          <p className="pb-1 text-xs text-slate-500">
            More examples (development only)
          </p>
          <div className="flex flex-wrap gap-1">
            {otherExampleKeys.map((key) => (
              <Link
                key={key}
                className="rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"
                to={`/examples/${key}`}
              >
                {exampleDisplayNames[key]}
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  </div>
);

export default ExamplesPage;
