# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

MIT ADT students and faculty sharing campus commutes along the Pune Solapur Highway corridor. Audience and workflows are evidenced by the existing implementation; this redesign changes presentation.

## Product Purpose

CampusPool connects campus peers offering bike or car seats with passengers looking for a shared commute from campus gates to Pune destinations.

## Capabilities and Constraints

- Preserve ride search, route and vehicle filters, ride offers, bookings, settlements, campus maps, notifications, authentication, and emergency contacts.
- Preserve the existing server, verification rules, fare calculations, persistence, and permission boundaries.
- Show actual server results and distinguish loading, empty, filtered, failed, and saved-feed states. Never populate production with demonstration rides.
- Existing HTML/JavaScript frontend, Tailwind utility styles, Node server, and SQLite database. Existing UI contains unverified marketing and operational claims; a theme change must not expand or certify them.

## Brand Commitments

Keep CampusPool and its MIT ADT context. The user explicitly requested a classic Uber- or Rapido-like visual language to replace the neon dark theme. Use familiar transport-app controls and a light interface. White/black/yellow leads this implementation; the user was offered a monochrome alternative and the choice remains adjustable.

## Evidence on Hand

The incumbent application and its live local server provide product content and workflow evidence. No external testimonials, new fare promises, service guarantees, or actual student data may be invented for design purposes.

## Product Principles

- Let users find or offer a ride quickly.
- Keep state and recovery actions explicit.
- Preserve product behavior during visual changes.
- Support narrow screens, keyboard operation, readable contrast, and reduced motion.
