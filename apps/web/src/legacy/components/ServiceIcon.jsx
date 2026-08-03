import { resolveBrandAsset } from "@os-one/digital-legacy";

// Generic-only icons per docs/BRAND_ASSET_POLICY.md — never hotlinked
// or scraped service artwork, only Lyfos's own bundled line icons.
export default function ServiceIcon({ iconKey, size = "md" }) {
  const asset = resolveBrandAsset(iconKey);
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const img = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] ${box}`}>
      <img src={asset.filePath} alt="" width={24} height={24} className={img} loading="lazy" />
    </span>
  );
}
