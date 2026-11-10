"use strict";

const assert = require("node:assert/strict");
const { MINIMUM_VERSION, compareVersions, evaluate } = require("../background/sidecar-compat.js");

assert.equal(MINIMUM_VERSION, "1.2.3");
assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
assert.equal(compareVersions("1.2.4", "1.2.3"), 1);
assert.equal(compareVersions("1.2.2", "1.2.3"), -1);
assert.equal(compareVersions("dev", "1.2.3"), null);
assert.equal(evaluate("1.2.3").compatible, true);
assert.equal(evaluate("1.2.4").needsUpdate, false);
assert.equal(evaluate("1.2.2").needsUpdate, true);

console.log("sidecar-compat.test.js: ok");
