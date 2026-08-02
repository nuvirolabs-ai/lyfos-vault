import test from "node:test";
import assert from "node:assert/strict";

import { getDigitalLegacyFeatureFlags } from "./featureFlags.js";

test("all Digital Legacy capabilities default off in the production application", () => {
  assert.deepEqual(getDigitalLegacyFeatureFlags({}), {
    dashboard: false,
    serviceCatalogue: false,
    credentialFields: false,
    officialBrandIcons: false,
    score: false,
    reviewReminders: false,
    nomineeFieldPermissions: false,
    customServiceIcons: false
  });
});

test("catalogue and score can be enabled without credential or nominee permission flags", () => {
  const flags = getDigitalLegacyFeatureFlags({
    VITE_FEATURE_DIGITAL_LEGACY_CATALOGUE: "true",
    VITE_FEATURE_DIGITAL_LEGACY_SCORE: "1"
  });
  assert.equal(flags.serviceCatalogue, true);
  assert.equal(flags.score, true);
  assert.equal(flags.credentialFields, false);
  assert.equal(flags.nomineeFieldPermissions, false);
});

test("critical capabilities require their own exact flag and do not inherit dashboard state", () => {
  const flags = getDigitalLegacyFeatureFlags({
    VITE_FEATURE_DIGITAL_LEGACY_DASHBOARD: "true",
    VITE_FEATURE_DIGITAL_LEGACY_CREDENTIALS: "true",
    VITE_FEATURE_DIGITAL_LEGACY_NOMINEE_FIELDS: "false"
  });
  assert.equal(flags.dashboard, true);
  assert.equal(flags.credentialFields, true);
  assert.equal(flags.nomineeFieldPermissions, false);
});

test("unknown and loosely truthy values never enable a feature", () => {
  const flags = getDigitalLegacyFeatureFlags({
    VITE_FEATURE_DIGITAL_LEGACY_CATALOGUE: "yes",
    VITE_FEATURE_DIGITAL_LEGACY_SCORE: "TRUE",
    VITE_FEATURE_DIGITAL_LEGACY_CREDENTIALS: true
  });
  assert.equal(flags.serviceCatalogue, false);
  assert.equal(flags.score, false);
  assert.equal(flags.credentialFields, false);
});
