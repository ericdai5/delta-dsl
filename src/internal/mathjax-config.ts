/**
 * The MathJax release Delta loads, and the settings every loader shares.
 */
const MATHJAX_VERSION = "4.1.3";

// TeX input and CHTML output without a font. The font is named in the output
// settings below and MathJax fetches it on its own.
export const MATHJAX_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/mathjax@${MATHJAX_VERSION}/tex-chtml-nofont.js`;

// Subresource integrity hash of the script above. Recompute it when the
// version changes:
//   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
export const MATHJAX_SCRIPT_INTEGRITY =
  "sha384-PnV2v1hB0n9/0Qxm9Z4Rn2xDmXbHONnV47DvSnmK6WaOiuNvRhZg6F6+LflhiqDw";

export const MATHJAX_OUTPUT_OPTIONS = {
  // MathJax's original TeX font, in place of its default, New Computer
  // Modern
  font: "mathjax-tex",
  // A formula stays on one line. MathJax 4 would otherwise let the browser
  // wrap in-line math, which splits it across several containers.
  linebreaks: { inline: false },
};

export const MATHJAX_DOCUMENT_OPTIONS = {
  // Delta handles the pointer and the keyboard on a formula itself, so
  // MathJax 4's expression explorer stays off, along with the speech,
  // braille and semantic markup that it is built on.
  enableExplorer: false,
  enableSpeech: false,
  enableBraille: false,
  enableEnrichment: false,
  // MathJax's context menu loads accessibility features from its own
  // settings, so it gets the same choices. It also turns on the hidden
  // MathML that screen readers read.
  menuOptions: {
    settings: {
      enrich: false,
      speech: false,
      braille: false,
      assistiveMml: true,
    },
  },
};
