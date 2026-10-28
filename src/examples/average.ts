export const average = `const config = {
  formulas: [
    {
      id: "average",
      latex: "\\\\mu = \\\\frac{1}{n} \\\\sum_{i=1}^{n} X_i"
    },
  ],
  variables: {
    "\\\\mu": {
      default: 0,
      name: "Mean",
    },
    n: {
      default: 0,
      name: "Count",
    },
    i: {
      name: "Index",
      precision: 0,
    },
    X_i: {
      name: "Value at index i",
      precision: 0,
    },
    X: {
      default: [10, 20, 30, 40, 50],
      name: "Data values",
    },
  },
  stepping: true,
  semantics: function({ vars, step }) {
    var xValues = vars.X;
    var n = xValues.length;
    var sum = 0;
    var average = 0;
    step({ description: "Get the count $n$ of values", labels: { "n": n } });
    for (var i = 0; i < n; i++) {
      var xi = xValues[i];
      step({ description: "Get value $X_i$ from $X$", labels: { "i": i + 1, "X_i": xi, "X": xValues } });
      step({ description: "Add $X_i$ to running sum of " + sum, labels: { "X_i": xi } });
      sum = sum + xi;
      step({ labels: { "\\\\sum_{i=1}^{n} X_i": "Sum is now " + sum } });
    }
    average = sum / n;
    average = Math.round(average * 100) / 100;
    step({ description: "Divide $sum = " + sum + "$ by $n = " + n + "$ to get average.", labels: { "\\\\mu": average } });
    vars["\\\\mu"] = average;
  },
  fontSize: 1.5
};`;
