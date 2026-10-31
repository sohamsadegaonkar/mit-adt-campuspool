---
name: MIT ADT CampusPool
description: A familiar light workspace for sharing a campus commute.
colors:
  canvas: "#ffffff"
  ink: "#171717"
  taxi-yellow: "#f4ce37"
  taxi-yellow-hover: "#e7bd25"
  surface: "#f6f6f6"
  field: "#f3f3f3"
  secondary: "#f2f2f2"
  hover: "#e9e9e9"
  border: "#dedede"
  control-border: "#d6d6d6"
  muted: "#636363"
  supporting: "#5f5f5f"
  strong-hover: "#333333"
  success: "#087443"
  success-surface: "#edf7f0"
  error: "#b42332"
  error-surface: "#fff0f1"
  warning: "#795600"
  warning-surface: "#fff5d0"
typography:
  headline:
    fontFamily: 'Arial, "Helvetica Neue", system-ui, sans-serif'
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1.24
    letterSpacing: "-0.03em"
  title:
    fontFamily: 'Arial, "Helvetica Neue", system-ui, sans-serif'
    fontSize: "21px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Arial, "Helvetica Neue", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'Arial, "Helvetica Neue", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.5
  supporting:
    fontFamily: 'Arial, "Helvetica Neue", system-ui, sans-serif'
    fontSize: "12px"
rounded:
  compact: "6px"
  control: "8px"
  field: "9px"
  button: "10px"
  workspace: "12px"
  panel: "16px"
spacing:
  tight: "8px"
  compact: "12px"
  regular: "16px"
  mobile-panel: "20px"
  panel: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.taxi-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.taxi-yellow-hover}"
    textColor: "{colors.ink}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10px 18px"
  button-strong:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.workspace}"
  field:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  navigation-tab:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    padding: "10px 14px"
  route-choice:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.strong-hover}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  route-choice-selected:
    backgroundColor: "{colors.taxi-yellow}"
    textColor: "{colors.ink}"
  status-count:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    height: "22px"
  ride-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  feed-state:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.workspace}"
    padding: "36px 24px"
---

# Design System: MIT ADT CampusPool

## Overview

**Creative North Star: "The Campus Commute Desk"**

CampusPool uses the familiar visual language of a light transport app: a white canvas, clear black text, neutral controls, and a restrained taxi-yellow signal for route selection and the principal ride action. The user requested an Uber/Rapido-like direction in place of the old neon dark theme. CampusPool retains its own name and MIT ADT context.

This is a working interface for finding and offering seats. Information stays compact, controls look actionable, and actual availability determines the content. The built cascade in `campuspool.css` is the visual authority; generated legacy utility names in `index.html` do not describe the live palette. The SVG app mark uses yellow with dark ADT lettering. The standalone app's background and browser theme are white.

**Key Characteristics:**

- White canvas and flat neutral surfaces.
- Yellow selection and ride actions, with black strong actions.
- Plain UI text and consistent stroke SVG icons.
- Visible state, recovery, and keyboard focus.

## Colors

The palette pairs quiet grays with a warm yellow transport cue. Frontmatter contains the normative values; semantic names below describe their use.

### Primary

- **Taxi Yellow:** principal ride CTA, selected destination, selected tab count, text selection, and the app mark. Its darker hover variant belongs to yellow buttons.
- **Ink:** headings, main text, strong actions, selected tab underline, and keyboard focus. Strong actions use white text and a darker neutral hover treatment.

### Neutral

- **Canvas:** page, navigation, ride cards, dialogs, and map popups.
- **Surface:** destination workspace and quiet supporting containers.
- **Field / Secondary:** form controls and secondary actions. **Hover** supplies a modest neutral state change.
- **Border / Control Border:** dividers and control boundaries.
- **Muted / Supporting:** labels, metadata, status descriptions, and explanatory text. The live utility bridge uses Muted for secondary text, while custom sections also use Supporting.

Success green, error red, and warm warning brown remain semantic feedback colors with pale corresponding surfaces. Their appearance must follow real product state; they are not additional decorative accents.

**The Route Signal Rule.** Yellow marks selection and the main ride action; navigation itself uses an ink underline.

## Typography

Body and UI text use the Arial stack recorded in frontmatter. The implementation uses one utilitarian family across headings and controls. This records the current UI, without establishing a separate display-font system for future promotional pages.

### Hierarchy

- **Headline:** bold, compact commute heading. The desktop role becomes (28px) at widths up to (767px), then (32px) at widths up to (639px); preserve the actual cascade when matching this screen.
- **Title:** available-rides section heading. Offer-form headings use a larger local title (24px), while feed-state headings use (19px).
- **Body:** readable interface copy; longer explanatory paragraphs use a line height of (1.7) and a maximum measure around (72ch).
- **Label:** confident compact buttons. Tabs and route choices use (14px); route choices become (13px) on mobile.
- **Supporting:** metadata and form labels. Form inputs use (16px), including authentication dialogs.

Use tabular numerals for fare figures and count badges. Keep form labels in normal case. Do not turn small text, status labels, or headings into decorative uppercase badges.

## Layout

The main workspace is centered with a maximum width of (1248px), with (16px) horizontal gutters that increase to (24px) from the small-screen utility breakpoint. A compact brand header precedes an unboxed commute heading, ride actions, and a horizontally scrollable tab bar.

The ride workspace uses a fixed destination column (300px) and a flexible results column with a gap of (24px). Results form a single readable column. At widths up to (767px), filters stack above results, destination rows wrap into choices, and the workspace gap becomes (20px). The destination panel padding changes from (24px) to (20px). Feed-state panels are at least (380px) high on desktop and (280px) on mobile.

The interface uses the spacing steps in frontmatter for control gaps, panel padding, and section separation. Longer introductory explanations sit after the active workspace in a native About disclosure. Dialogs retain their width constraints and scrollable overlays. Wrap labels, cards, and actions as space narrows; horizontal overflow is reserved for the intentional tab strip.

## Elevation & Depth

The page is flat at rest. Neutral fills, borders, and whitespace separate controls and results; decorative shadows, colored glow, gradients, and backdrop blur from the old theme are overridden. Dialog panels retain a soft structural shadow (`0 20px 70px -30px rgb(0 0 0 / .35)`) over a dark translucent overlay (`rgb(0 0 0 / .48)`). Live driver markers have a small locator shadow (`0 2px 6px rgb(0 0 0 / .2)`). These functional exceptions are not a general card treatment.

**The Flat Workspace Rule.** Keep cards and controls flat; use depth to distinguish an overlay or map locator from its surroundings.

## Shapes

Controls use modest corners: compact counters, destination choices, fields, and buttons follow the frontmatter radius roles. Workspace panels and feed states use the workspace radius; ride cards and modal panels use the panel radius. Thin neutral borders define edges without heavy framing. Navigation tabs are square at their base so the active underline reads clearly.

The icon vocabulary is authored stroke SVG with rounded caps and joins, normally (20px), stroke width (1.7). Larger state icons use (30–32px). Reuse this vocabulary for runtime cards, toasts, and route controls.

## Components

### Buttons

Yellow primary ride actions and neutral secondary actions share compact padding, a minimum height of (46px), and bold labels. Neutral secondary actions have a thin border. Black strong actions remain for authentication, offer submission, map controls, and settlement controls. Preserve their semantic text and behavior.

Hover changes the background rather than adding glow. Disabled buttons use opacity (.6) and a disabled cursor. Keyboard focus uses an ink outline (2px) with an offset (3px). Icon-only controls and modal close controls keep a minimum target of (44px).

### Chips

Destination choices are full-width white rows in the desktop route panel, with yellow fill for the pressed route. On mobile they wrap as bordered choices. Use `aria-pressed` for their selected state; styling and actual filtering must remain synchronized. Count badges are compact neutral rectangles, becoming yellow inside the selected main tab.

### Cards / Containers

Ride cards are white, flat, softly rounded, and outlined with neutral dividers. Driver details, vehicle metadata, fare, and actions wrap within the card. State panels use an icon, explicit heading, short explanation, and relevant recovery action. Loading, empty, filtered-empty, failure, and saved-feed states keep distinct truthful copy rather than fabricated rides.

### Inputs / Fields

Fields use gray fill, neutral borders, dark text, and clearly visible placeholders. Offer and dialog fields keep a minimum height of (46px). The vehicle filter is a compact select with a minimum height of (44px). Focus remains visible across keyboard-operated fields and controls. Validation, verification, payment, and emergency states retain their existing semantic colors and product behavior.

### Navigation

Main navigation sits on white with a thin bottom divider. Tabs have a minimum height of (48px). Unselected labels are muted and gain a pale background on hover. The selected tab uses dark text and a bottom rule (3px); the selected count badge is yellow. Preserve tab roles, selection state, keyboard access, and the mobile scroll strip.

### About Disclosure

The native disclosure has a readable, keyboard-focusable summary with a minimum height of (44px). Its explanatory copy and benefits follow the operative workspace and use the same neutral typography and dividers.

Short button color transitions use (.16s). Existing entry animations are restrained; the reduced-motion preference disables animation, transitions, and smooth scrolling. Motion is feedback, not decoration.

## Do's and Don'ts

### Do:

- **Do** use yellow to clarify the selected route and principal ride action.
- **Do** preserve real availability, verification, payment, error, and recovery states.
- **Do** maintain visible keyboard focus and readable wrapping on narrow screens.
- **Do** use the same stroke SVG vocabulary for static and generated controls.
- **Do** derive new styles from the live theme cascade and semantic roles.

### Don't:

- **Don't** restore neon surfaces, colored glow, decorative blur, or gradients.
- **Don't** add decorative badges above headings or mix emoji with the control icon vocabulary.
- **Don't** invent rides, students, testimonials, fare guarantees, or service claims for visual completeness.
- **Don't** treat legacy dark utility names or map-provider error imagery as design tokens.
