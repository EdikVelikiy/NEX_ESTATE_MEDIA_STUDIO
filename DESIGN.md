# NexEstate Unified PWA Design

## Direction

The Hub is a quiet, premium routing surface rather than a dashboard. Its job is to make the choice between two established workspaces immediate while keeping their interfaces visually and technically independent.

## Visual system

- Background: deep navy graphite with restrained radial depth.
- Surfaces: dark blue cards, thin cool-blue borders, neutral elevation shadows.
- Accent: soft sky blue for focus, route icons and active edges.
- Typography: Georgia for the editorial Hub heading and card titles; Segoe UI for navigation and explanatory copy.
- Motion: 280 ms transform-only hover/focus response; cards rise 8 px and scale to 1.06 without changing layout. Reduced-motion mode removes transforms and complex transitions.

## Hub composition

- Header: local `NE` mark, `NexEstate`, and `Рабочие инструменты`.
- Intro: one short title and one sentence explaining the two-module workspace.
- Routes: exactly two equal cards on desktop, stacked cards on narrow screens.
- Each card is one semantic link with an inline SVG, title, exact description and directional affordance.

## Interaction rules

- The entire card is clickable and keyboard accessible with Enter and Space.
- Focus uses the same border and elevation hierarchy as hover.
- Touch interaction has a brief pressed state and never depends on hover.
- Module return links remain outside exportable canvases and preserve each editor's storage.

## Technical boundaries

- Hub classes use the `app-hub-*` prefix.
- Editor CSS and JavaScript are never loaded by the Hub or by the other module.
- Shared PWA behavior is limited to `pwa-shell.js`, the root manifest, icons and root service worker.
