import { resolveBrandAsset } from "@os-one/digital-legacy";
import { getCategoryColor } from "../categoryColors.js";

// Generic-only icons per docs/BRAND_ASSET_POLICY.md — never hotlinked
// or scraped service artwork, only Lyfos's own bundled line icons.
// Recolored per category via CSS mask (the source SVGs stay untouched,
// single fixed stroke color) so the same file can render in any of the
// category accent colors without needing per-color asset variants.
export default function ServiceIcon({ iconKey, size = "md" }) {
  const asset = resolveBrandAsset(iconKey);
  const color = getCategoryColor(iconKey);
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const img = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const maskStyle = {
    backgroundColor: color.ink,
    WebkitMaskImage: `url(${asset.filePath})`,
    maskImage: `url(${asset.filePath})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain"
  };
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${box}`} style={{ background: color.bg }} aria-hidden="true">
      <span className={img} style={maskStyle} />
    </span>
  );
}
