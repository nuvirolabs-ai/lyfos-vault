import { getCategory, getService } from "./catalogue.js";

function approvedMetadata(record, customServiceById) {
  const category = getCategory(record.categoryId);
  const service = getService(record.serviceTemplateId);
  const customService = customServiceById.get(record.customServiceId);
  return [
    service?.name,
    ...(service?.aliases ?? []),
    customService?.name,
    ...(customService?.aliases ?? []),
    record.accountLabel,
    category?.name,
    ...(record.tags ?? []),
    record.status
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

export function searchLegacyRecords(records = [], query = "", { customServices = [] } = {}) {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return [...records];
  const customServiceById = new Map(customServices.map((service) => [service.id, service]));
  return records.filter((record) => approvedMetadata(record, customServiceById).some((value) => value.includes(needle)));
}
