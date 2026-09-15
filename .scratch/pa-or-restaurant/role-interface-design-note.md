# Role interface design note

## Customer — warm editorial ordering

Customer pages keep the restaurant's cocoa/red/gold identity, with generous spacing, a clear menu hierarchy, and the real Pa Or logo as the visual anchor. Depth is restrained to discovery and confirmation moments (logo/hero/menu interaction) so the food remains the focus. Touch targets remain at least 44px and visible focus rings are retained.

## Kitchen — control-room speed

Kitchen screens use a teal operational surface, compressed spacing, sticky station context, and high-contrast status labels. Existing status colors are paired with text and controls remain large enough for gloved/touch use. Decorative tilt and expensive 3D effects are intentionally suppressed.

## Owner — executive signal

Owner screens use a calm navy header and wide content surface to establish hierarchy for KPI, revenue, profit, wait-time, and trend information. Motion is limited to meaningful chart/page transitions and does not compete with the numbers.

## Admin — management console

Admin screens use slate surfaces, compact navigation, and explicit action states suited to search/filter/table workflows. Customer marketing effects are not used in this surface; contrast, focus, and destructive-action clarity remain mandatory.

## Accessibility constraints

All role surfaces preserve keyboard-visible focus, semantic labels, 44px minimum interactive targets, responsive layouts, and `prefers-reduced-motion`. Role-specific styling changes visual rhythm only; routes, API behavior, and demo fallback data are unchanged.
