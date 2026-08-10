import { LEGACY_ACTIONS, SENSITIVITY_LEVELS } from "./constants.js";
import { LEGACY_CATEGORIES } from "./categories.js";
import { FIELD_TEMPLATES } from "./fieldTemplates.js";
import { LEGACY_SERVICE_TEMPLATES } from "./services.js";
import { regionRelevance } from "./regions.js";

const categoryById = new Map(LEGACY_CATEGORIES.map((category) => [category.id, category]));
const serviceById = new Map(LEGACY_SERVICE_TEMPLATES.map((service) => [service.id, service]));

export function getCategory(id) {
  return categoryById.get(String(id ?? "")) ?? null;
}

export function getService(id) {
  return serviceById.get(String(id ?? "")) ?? null;
}

/**
 * List service templates.
 *
 * `region` REORDERS, it does not exclude — a template authored for another
 * country stays in the list so an existing record still resolves and search
 * still finds it. Only `featuredOnly` narrows by region, because the quick-pick
 * strip is the one place where showing every country's banks is just noise.
 *
 * Omitting `region` preserves the original ordering exactly.
 */
export function listServices({ categoryId, featuredOnly = false, enabledOnly = true, region = null } = {}) {
  const matches = LEGACY_SERVICE_TEMPLATES.filter((service) =>
    (!categoryId || service.categoryId === categoryId)
    && (!enabledOnly || service.isEnabled)
    && (!featuredOnly || (service.isFeatured && (!region || regionRelevance(service, region) <= 1)))
  );
  if (!region) return matches;
  return matches.slice().sort((left, right) =>
    regionRelevance(left, region) - regionRelevance(right, region)
    || getCategory(left.categoryId).sortOrder - getCategory(right.categoryId).sortOrder
    || left.sortOrder - right.sortOrder);
}

function searchableText(service) {
  return [service.id, service.name, ...service.aliases].map((value) => value.toLowerCase());
}

export function searchServiceTemplates(query, options = {}) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return listServices(options);
  return listServices(options)
    .map((service) => {
      const values = searchableText(service);
      const rank = values.some((value) => value === needle)
        ? 0
        : values.some((value) => value.startsWith(needle))
          ? 1
          : values.some((value) => value.includes(needle))
            ? 2
            : null;
      return { service, rank };
    })
    .filter(({ rank }) => rank !== null)
    // Text match dominates; region only breaks ties. Typing "HDFC" from London
    // must still find HDFC.
    .sort((left, right) => left.rank - right.rank
      || (options.region ? regionRelevance(left.service, options.region) - regionRelevance(right.service, options.region) : 0)
      || getCategory(left.service.categoryId).sortOrder - getCategory(right.service.categoryId).sortOrder
      || left.service.sortOrder - right.service.sortOrder)
    .map(({ service }) => service);
}

export function validateCatalogue() {
  const errors = [];
  const categoryIds = new Set();
  const categorySlugs = new Set();
  for (const category of LEGACY_CATEGORIES) {
    if (categoryIds.has(category.id)) errors.push(`duplicate category id: ${category.id}`);
    if (categorySlugs.has(category.slug)) errors.push(`duplicate category slug: ${category.slug}`);
    if (!SENSITIVITY_LEVELS.includes(category.sensitivityLevel)) errors.push(`invalid category sensitivity: ${category.id}`);
    categoryIds.add(category.id);
    categorySlugs.add(category.slug);
  }

  const serviceIds = new Set();
  for (const service of LEGACY_SERVICE_TEMPLATES) {
    if (serviceIds.has(service.id)) errors.push(`duplicate service id: ${service.id}`);
    if (!categoryIds.has(service.categoryId)) errors.push(`unknown service category: ${service.id}`);
    if (!SENSITIVITY_LEVELS.includes(service.defaultSensitivityLevel)) errors.push(`invalid service sensitivity: ${service.id}`);
    for (const fieldKey of service.suggestedFieldKeys) {
      if (!FIELD_TEMPLATES[fieldKey]) errors.push(`unknown field ${fieldKey} on ${service.id}`);
    }
    for (const action of service.suggestedActions) {
      if (!LEGACY_ACTIONS.includes(action)) errors.push(`unknown action ${action} on ${service.id}`);
    }
    serviceIds.add(service.id);
  }
  return { valid: errors.length === 0, errors };
}
