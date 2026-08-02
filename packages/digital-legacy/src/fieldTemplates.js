import { deepFreeze } from "./constants.js";

function field(id, label, fieldType, classification, options = {}) {
  const storagePolicy = options.storagePolicy ?? "allowed";
  const critical = ["authentication_secret", "financial_secret", "recovery_secret", "private_cryptographic_key"].includes(classification);
  return {
    id,
    key: id,
    label,
    fieldType,
    classification,
    placeholder: options.placeholder ?? "",
    helpText: options.helpText ?? "",
    requiredForReadiness: options.requiredForReadiness ?? false,
    encrypted: true,
    revealRequiresReauthentication: options.revealRequiresReauthentication ?? critical,
    copyAllowed: options.copyAllowed ?? !["prohibited", "disabled_pending_review"].includes(storagePolicy),
    searchable: false,
    sortOrder: options.sortOrder ?? 100,
    storagePolicy
  };
}

const entries = [
  field("account-label", "Account label", "text", "account_information", { requiredForReadiness: true, sortOrder: 1 }),
  field("account-holder", "Account holder", "text", "identity_information", { sortOrder: 2 }),
  field("account-type", "Account type", "text", "account_information", { sortOrder: 3 }),
  field("masked-account-number", "Masked account number", "masked-number", "account_information", { sortOrder: 4 }),
  field("customer-id", "Customer ID", "text", "account_information", { sortOrder: 5 }),
  field("username", "Username", "username", "account_information", { sortOrder: 6 }),
  field("registered-email", "Registered email", "email", "identity_information", { sortOrder: 7 }),
  field("registered-phone", "Registered mobile number", "phone", "identity_information", { sortOrder: 8 }),
  field("website", "Website", "url", "account_information", { sortOrder: 9 }),
  field("branch", "Branch", "text", "account_information", { sortOrder: 10 }),
  field("relationship-manager", "Relationship manager", "text", "account_information", { sortOrder: 11 }),
  field("nominee-information", "Existing provider nominee", "textarea", "identity_information", { sortOrder: 12 }),
  field("provider-contact", "Provider contact", "text", "account_information", { sortOrder: 13 }),
  field("policy-number", "Policy number", "masked-number", "account_information", { sortOrder: 14 }),
  field("document-number", "Masked document number", "masked-number", "identity_information", { sortOrder: 15 }),
  field("asset-location", "Asset location", "text", "account_information", { sortOrder: 16 }),
  field("renewal-date", "Renewal date", "date", "account_information", { sortOrder: 17 }),
  field("recovery-path", "Recovery path", "textarea", "personal_instruction", { requiredForReadiness: true, sortOrder: 20 }),
  field("personal-instructions", "Personal instructions", "secure-note", "personal_instruction", { sortOrder: 21 }),
  field("supporting-document", "Supporting document", "file", "supporting_document", { sortOrder: 22 }),
  field("password", "Password", "password", "authentication_secret", { storagePolicy: "feature_gated", sortOrder: 50 }),
  field("pin", "PIN", "pin", "financial_secret", { storagePolicy: "feature_gated", sortOrder: 51 }),
  field("recovery-code", "Recovery code", "recovery-code", "recovery_secret", { storagePolicy: "feature_gated", sortOrder: 52 }),
  field("otp", "One-time password", "pin", "authentication_secret", { storagePolicy: "prohibited", copyAllowed: false, sortOrder: 53 }),
  field("temporary-code", "Temporary authentication code", "pin", "authentication_secret", { storagePolicy: "prohibited", copyAllowed: false, sortOrder: 54 }),
  field("cvv", "Payment-card CVV", "pin", "financial_secret", { storagePolicy: "prohibited", copyAllowed: false, sortOrder: 55 }),
  field("seed-phrase", "Wallet seed phrase", "recovery-code", "private_cryptographic_key", { storagePolicy: "disabled_pending_review", copyAllowed: false, sortOrder: 56 }),
  field("private-key", "Private key", "secure-note", "private_cryptographic_key", { storagePolicy: "disabled_pending_review", copyAllowed: false, sortOrder: 57 }),
  field("password-manager-master-password", "Password manager master password", "password", "authentication_secret", { storagePolicy: "disabled_pending_review", copyAllowed: false, sortOrder: 58 })
];

export const FIELD_TEMPLATES = deepFreeze(Object.fromEntries(entries.map((entry) => [entry.id, entry])));
