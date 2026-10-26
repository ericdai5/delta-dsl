export const newCanvas = `const config = {
  formulas: [
    {
      id: "my-formula",
      latex: "y = mx + b"
    }
  ],
  variables: {
    y: {},
    m: { default: 2 },
    x: { default: 3, input: "drag" },
    b: { default: 1 }
  },
  semantics: function({ vars }) {
    vars.y = vars.m * vars.x + vars.b;
  },
  fontSize: 1
};`;
