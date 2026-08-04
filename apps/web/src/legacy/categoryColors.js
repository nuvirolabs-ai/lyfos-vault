// Per-category accent color, used only for the small icon chip in
// CategoryCard/ServiceIcon — never the card background, which stays
// reserved for status (protected/attention/neutral) so the two color
// systems don't compete. Chosen to avoid the app's status hues
// (green/amber/red) so a category color is never misread as a status.
export const CATEGORY_COLORS = {
  banking: { bg: "#E6F1FB", ink: "#185FA5" },
  investments: { bg: "#E1F5EE", ink: "#0F6E56" },
  social: { bg: "#FBEAF0", ink: "#993556" },
  communication: { bg: "#EEF0FE", ink: "#4046A8" },
  devices: { bg: "#EAF0F2", ink: "#3F5C68" },
  cloud: { bg: "#E3F6FB", ink: "#106B84" },
  government: { bg: "#E7EAF6", ink: "#2A3B7A" },
  insurance: { bg: "#EEEDFE", ink: "#534AB7" },
  property: { bg: "#F7ECE3", ink: "#8A5A34" },
  business: { bg: "#EFEFF1", ink: "#45454B" },
  subscriptions: { bg: "#FDECDF", ink: "#B5570E" },
  health: { bg: "#FCEBEA", ink: "#B23A34" },
  memories: { bg: "#F7ECEF", ink: "#8C5262" },
  recovery: { bg: "#E8EAED", ink: "#33414B" },
  custom: { bg: "#F1EFE8", ink: "#5F5E5A" }
};

export function getCategoryColor(iconKey) {
  return CATEGORY_COLORS[iconKey] ?? CATEGORY_COLORS.custom;
}
