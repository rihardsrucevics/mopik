// insert.cjs was written against a lib whose waitChip waited for "proposed" or
// "refused" only (not "warn"); everything else is the shared kit.
const L = require("../lib.cjs");
module.exports = { ...L, waitChip: (page, tones = ["proposed", "refused"], timeout) => L.waitChip(page, tones, timeout) };
