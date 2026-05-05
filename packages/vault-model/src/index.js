export const VAULT_ITEM_TYPES = [
  {
    id: "password",
    label: "Password",
    description: "Website, app, email, or account credentials.",
    emergencyEligible: true
  },
  {
    id: "bank_account",
    label: "Bank account",
    description: "Account number, IFSC, branch, and access notes.",
    emergencyEligible: true
  },
  {
    id: "pin",
    label: "PIN or code",
    description: "Mobile PIN, card PIN, locker code, or device code.",
    emergencyEligible: true
  },
  {
    id: "email_account",
    label: "Email account",
    description: "Email ID, password, recovery email, and recovery phone.",
    emergencyEligible: true
  },
  {
    id: "card",
    label: "Card",
    description: "Debit, credit, prepaid, or emergency card details.",
    emergencyEligible: false
  },
  {
    id: "identity_document",
    label: "ID document",
    description: "Passport, Aadhaar, PAN, license, or other ID.",
    emergencyEligible: true
  },
  {
    id: "insurance_policy",
    label: "Insurance policy",
    description: "Policy number, nominee, agent, and claim notes.",
    emergencyEligible: true
  },
  {
    id: "important_document",
    label: "Important document",
    description: "Property, tax, legal, medical, or family records.",
    emergencyEligible: true
  },
  {
    id: "emergency_instruction",
    label: "Emergency instruction",
    description: "What family should do first during a crisis.",
    emergencyEligible: true
  }
];

export const RELEASE_POLICY = {
  mainNominee: "Main Nominee",
  totalKeys: 5,
  requiredKeys: 3,
  waitDays: 14,
  ownerAlertsPerDay: 2
};
