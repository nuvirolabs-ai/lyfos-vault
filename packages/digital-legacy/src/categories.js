import { deepFreeze } from "./constants.js";

const categoryRows = [
  ["banking-payments", "Banking and payments", "Banks, wallets and payment accounts.", "banking", "high"],
  ["investments-wealth", "Investments and wealth", "Investments, pensions and long-term assets.", "investments", "high"],
  ["social-media", "Social media", "Profiles, audiences and public identity.", "social", "standard"],
  ["email-communication", "Email and communication", "Email, messaging and community accounts.", "communication", "high"],
  ["devices-ecosystems", "Devices and ecosystems", "Devices and the accounts that control them.", "devices", "high"],
  ["cloud-digital-files", "Cloud storage and digital files", "Cloud files, photos and archives.", "cloud", "high"],
  ["government-identity", "Government and identity", "Identity documents and government services.", "government", "critical"],
  ["insurance", "Insurance", "Policies, contacts and claim paths.", "insurance", "high"],
  ["property-physical-assets", "Property and physical assets", "Property, vehicles and protected physical assets.", "property", "high"],
  ["business-professional", "Business and professional accounts", "Work systems, domains, commerce and infrastructure.", "business", "high"],
  ["shopping-travel-subscriptions", "Shopping, travel and subscriptions", "Purchases, travel, memberships and recurring services.", "subscriptions", "standard"],
  ["health-medical", "Health and medical", "Medical records, care portals and emergency health instructions.", "health", "critical"],
  ["memories-personal-archives", "Memories and personal archives", "Photos, stories, creative work and personal messages.", "memories", "high"],
  ["password-managers-recovery", "Password managers and recovery systems", "Password managers, security keys and recovery archives.", "recovery", "critical"],
  ["custom", "Custom category", "A private category created by the vault owner.", "custom", "high"]
];

export const LEGACY_CATEGORIES = deepFreeze(categoryRows.map((row, index) => ({
  id: row[0],
  slug: row[0],
  name: row[1],
  description: row[2],
  iconKey: row[3],
  sortOrder: index + 1,
  sensitivityLevel: row[4],
  isEnabled: true,
  allowsCustomServices: true,
  isUserDefined: row[0] === "custom"
})));
