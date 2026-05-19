/**
 * Smoke-test nested payload normalization (no DB).
 * Run: node scripts/verify-order-nested-resources.js
 */
const {
  hasNestedPayload,
} = require("../services/order_nested_resources_service");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

assert(hasNestedPayload({ additional_charges: [] }), "charges array");
assert(hasNestedPayload({ order_payments: { create: [] } }), "payments object");
assert(!hasNestedPayload({ user_id: "x" }), "no nested");

console.log("verify-order-nested-resources: OK");
