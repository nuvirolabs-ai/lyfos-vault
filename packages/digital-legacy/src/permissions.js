import { RECIPIENT_MODES, RELEASE_AUDIENCES } from "./constants.js";

export function resolveReleaseIntent(input = {}) {
  const audience = RELEASE_AUDIENCES.includes(input.audience) ? input.audience : "owner_only";
  const recipientMode = RECIPIENT_MODES.includes(input.recipientMode) ? input.recipientMode : "primary";
  const nomineeHolderIds = [...new Set((input.nomineeHolderIds ?? [])
    .map((id) => String(id).trim())
    .filter(Boolean))];
  return {
    audience,
    recipientMode,
    nomineeHolderIds: recipientMode === "selected" ? nomineeHolderIds : [],
    trigger: input.trigger === "manual" ? "manual" : "existing_circle",
    enforcement: "intent_only"
  };
}

export function validateReleaseIntent(policy = {}) {
  const errors = [];
  if (!RELEASE_AUDIENCES.includes(policy.audience)) errors.push("release audience is invalid");
  if (!RECIPIENT_MODES.includes(policy.recipientMode)) errors.push("release recipient mode is invalid");
  if (policy.recipientMode === "selected" && (policy.nomineeHolderIds ?? []).length === 0) {
    errors.push("selected nominee release requires at least one holder");
  }
  if (policy.enforcement !== "intent_only") errors.push("Phase 2 release policy must be intent only");
  return errors;
}
