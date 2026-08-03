// Shared display copy for Digital Legacy record screens and the create/edit
// form — kept in one place so the two never drift out of sync.

export const LEGACY_ACTION_LABELS = {
  transfer: "Transfer this to the right person.",
  memorialise: "Memorialise this account rather than deleting it.",
  close: "Close this account.",
  delete: "Delete this account and its data.",
  archive: "Archive this — keep it, but stop using it.",
  contact_provider: "Contact the provider directly.",
  release_information: "Share the information needed, nothing more.",
  custom: "See the note below."
};

export const AUDIENCE_LABELS = {
  owner_only: "Private — visible only to you",
  existence_only: "Nominees would see this exists, not its details",
  instructions_only: "Nominees would see your instructions, not stored values",
  full_record: "Full record would be included in a release"
};

export const RECIPIENT_LABELS = {
  primary: "Primary nominee",
  backup_fallback: "Backup nominee (fallback only)",
  all_authorized: "All authorized nominees",
  selected: "Selected nominees"
};

export const REVIEW_FREQUENCY_LABELS = {
  "3_months": "Every 3 months",
  "6_months": "Every 6 months",
  yearly: "Yearly",
  custom: "Custom",
  none: "No reminder"
};

export const STATUS_LABELS = {
  started: "Started",
  protected: "Protected",
  incomplete: "Incomplete",
  needs_review: "Review due",
  action_required: "Needs attention",
  scheduled_for_release: "Scheduled for release",
  released: "Released",
  archived: "Archived"
};
