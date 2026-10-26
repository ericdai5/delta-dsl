import { Link } from "react-router-dom";

import { examples } from "../examples";
import ExampleSwitcher from "./example-switcher";

// The main Delta site. Set VITE_DELTA_SITE_URL when it is hosted elsewhere.
const deltaSiteUrl =
  import.meta.env.VITE_DELTA_SITE_URL || "https://penn-hci.github.io/delta/";

interface IPlaygroundBreadcrumbProps {
  onConfigSelect?: (key: keyof typeof examples) => void;
  activeConfigKey?: keyof typeof examples;
}

const Separator = () => (
  <span aria-hidden="true" className="flex-shrink-0 text-slate-300">
    /
  </span>
);

// Delta / Playground / the current example, whose name opens the picker.
// Playground links to the examples page; on that page it is the last crumb.
const PlaygroundBreadcrumb = ({
  onConfigSelect,
  activeConfigKey,
}: IPlaygroundBreadcrumbProps) => (
  <nav
    aria-label="Breadcrumb"
    className="flex min-w-0 items-center gap-2 text-sm"
  >
    <a
      className="flex-shrink-0 text-slate-500 hover:text-slate-950"
      href={deltaSiteUrl}
    >
      Delta
    </a>
    <Separator />
    {activeConfigKey ? (
      <>
        <Link
          className="flex-shrink-0 text-slate-500 hover:text-slate-950"
          to="/examples"
        >
          Playground
        </Link>
        <Separator />
        <ExampleSwitcher
          onConfigSelect={onConfigSelect}
          activeConfigKey={activeConfigKey}
        />
      </>
    ) : (
      <span aria-current="page" className="flex-shrink-0 text-slate-950">
        Playground
      </span>
    )}
  </nav>
);

export default PlaygroundBreadcrumb;
