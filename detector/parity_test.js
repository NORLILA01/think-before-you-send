// Usage: node parity_test.js MODEL_JSON PARITY_JSON
// PARITY_JSON = {texts: [...], probs: [...]} from `train.py ... PARITY_FILE` (scikit-learn output).
const fs = require("fs");
const D = require("./detector.js");

const [modelPath, parityPath] = process.argv.slice(2);
const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
const set = JSON.parse(fs.readFileSync(parityPath, "utf8"));
const texts = set.texts || set.probes;
const det = D.create(model);

let maxErr = 0, worst = null, flips = 0;
texts.forEach((t, i) => {
  const err = Math.abs(det.score(t) - set.probs[i]);
  if (err > maxErr) { maxErr = err; worst = t; }
  if ((det.score(t) >= model.threshold) !== (set.probs[i] >= model.threshold)) flips++;
});
console.log(`${texts.length} texts | max |js - sklearn| = ${maxErr.toExponential(2)} | decision flips at ${model.threshold}: ${flips}`);
if (maxErr > 1e-3) { console.log("worst:", JSON.stringify(String(worst).slice(0, 120))); process.exit(1); }
