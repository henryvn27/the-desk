# Desk design system

The Desk uses a warm, restrained semantic theme shared by the shell, Chat, Lens, and domain surfaces. Product behavior remains owned by the existing domain and interaction layers; this system owns visual language, control mechanics, and state treatment.

## Layers

1. **Tokens** — `apps/desktop/src/styles/design-system.css` defines semantic colors, spacing, radii, control geometry, motion, focus, reduced motion, and contrast overrides. Legacy variables are aliased to the same tokens while older surfaces migrate.
2. **Base primitives** — `apps/desktop/src/components/base.tsx` wraps `react-aria-components` for `Button`, `IconButton`, `Input`, and `Textarea`, with constrained Desk variants. Icons come from the official `@untitledui/icons` package.
3. **Desk compositions** — `apps/desktop/src/components/desk.tsx` contains shared workspace-level patterns such as `WorkspaceHeader` and entity metadata.
4. **Product surfaces** — Chat, Lens, shell, Notes, Sources, Study, Planner, Capture, Settings, and advanced academic views keep their domain behavior and opt into the shared tokens and primitives.

## Migration rule

New generic controls use the base layer. Existing controls can remain native while a surface is migrated, but must inherit the semantic tokens and shared state language. Product-specific controls should compose a base primitive rather than invent a parallel button, field, menu, or focus treatment.

## Untitled UI integration

The current Untitled UI React approach is copy-in infrastructure built on React Aria and Tailwind rather than a single runtime component package. The Desk uses the official icons and React Aria primitives directly so the Electron renderer does not inherit a generic dashboard template or a second styling runtime. The Desk theme remains the product identity.

## Density and states

The primary target is a precise macOS desktop: compact 30/36/40px controls, quiet separators, modest radii, restrained shadows, and visible keyboard focus. Hover, pressed, selected, disabled, loading, offline, warning, error, and reduced-motion behavior are defined in the semantic layer.

## Refinement pass · 2026-09-07

The shared semantic palette now uses explicit OKLCH values for predictable tonal steps while preserving the warm Desk identity. Selection is carried by surface tone and weight instead of colored side stripes; the same rule applies to Home, class, Chat, and source callouts. Decorative page gradients and default header blur were removed so the work surface reads as a stable native desktop plane. Reduced-transparency overrides keep Lens surfaces legible when the platform asks for less translucency.

The renderer also keeps the existing domain projections intact while reducing avoidable work: workspace refresh and sync-status polling are bounded, the visible study clock remains one-second accurate, Home and Chat projections are memoized, and long rows/messages opt into browser content-visibility. These are presentation/performance changes only; persistence, routing, AI boundaries, and canonical academic state are unchanged.

## Verification boundary

Build, typecheck, lint, unit, Electron-only, release-boundary, and packaging checks are required for changes to this layer. Foreground screenshots or interactive smoke runs are only performed when they will not interrupt the active user's work.
