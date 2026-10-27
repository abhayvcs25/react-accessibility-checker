---
description: "Use when creating or editing React frontend pages, components, or styles. Apply the project's Neo-brutalism + Swiss minimalism design system, shared CSS tokens, responsive layout, and accessibility requirements."
applyTo: "frontend/src/**/*.{ts,tsx,css}"
---

# Frontend design rules

- Use Neo-brutalism + Swiss minimalism: warm off-white surfaces, ink-black text,
  acid-lime accents, bold typography, strong borders, subtle hard shadows,
  clean grids, and generous whitespace.
- Reuse the custom properties in `frontend/src/tokens.css`; do not scatter
  repeated palette, spacing, border, or shadow values through new styles.
- Keep designs structured and restrained. Avoid generic dashboards, gradients,
  glassmorphism, decorative clutter, and unnecessary dependencies.
- Prefer reusable React components, semantic HTML, and clear content hierarchy.
- Make every layout responsive at narrow and wide viewport sizes. Do not rely on
  color alone to communicate meaning.
- Preserve keyboard operation, visible focus indicators, accessible names,
  sufficient contrast, and appropriate status/error announcements.
- Preserve existing behavior and working configuration. Make focused changes;
  do not replace working components just to restyle them.
- Validate frontend changes with `npm run lint` and `npm run build` from
  `frontend/` when those commands are available.
