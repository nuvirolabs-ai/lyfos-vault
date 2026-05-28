// Lyfos mobile — design tokens matched to the web app.
// The web app uses Tailwind inline arbitrary values; here we expose
// the same constants so a future redesign moves both surfaces together.

export const colors = {
  bg:         "#fbfbfd",
  surface:    "#ffffff",
  text:       "#1d1d1f",
  text2:      "#6e6e73",
  text3:      "#86868b",
  text4:      "#a1a1a6",
  divider:    "rgba(0,0,0,0.08)",
  divider2:   "rgba(0,0,0,0.05)",
  amber:      "#c88719",
  amberSoft:  "#fff8eb",
  amberInk:   "#7a4b00",
  green:      "#34c759",
  greenInk:   "#0b6b3a",
  greenSoft:  "rgba(52,199,89,0.08)",
  red:        "#d70015",
  redInk:     "#b42318",
  redSoft:    "rgba(255,69,58,0.08)",
  inkBtn:     "#1d1d1f",
  inkBtnHover:"#000000"
};

// Apple HIG typography scale (mirrors web hero ladder)
export const typography = {
  hero:    { fontSize: 64, lineHeight: 68, letterSpacing: -1.2, fontWeight: "600" as const },
  title1:  { fontSize: 36, lineHeight: 40, letterSpacing: -0.5, fontWeight: "600" as const },
  title2:  { fontSize: 26, lineHeight: 30, letterSpacing: -0.3, fontWeight: "600" as const },
  title3:  { fontSize: 20, lineHeight: 26, letterSpacing: -0.2, fontWeight: "600" as const },
  body:    { fontSize: 15, lineHeight: 22 },
  footnote:{ fontSize: 13, lineHeight: 18, color: colors.text2 },
  caption: { fontSize: 11, lineHeight: 14, color: colors.text3, letterSpacing: 1.4, textTransform: "uppercase" as const, fontWeight: "600" as const }
};

export const radii = { sm: 8, md: 14, lg: 18, xl: 22, pill: 9999 };

export const spacing = (n: number) => 4 * n;
