---
name: Vibrant Gamified Engagement
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#464554'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#767586'
  outline-variant: '#c7c4d7'
  surface-tint: '#494bd6'
  primary: '#4648d4'
  on-primary: '#ffffff'
  primary-container: '#6063ee'
  on-primary-container: '#fffbff'
  inverse-primary: '#c0c1ff'
  secondary: '#006e2f'
  on-secondary: '#ffffff'
  secondary-container: '#6bff8f'
  on-secondary-container: '#007432'
  tertiary: '#825100'
  on-tertiary: '#ffffff'
  tertiary-container: '#a36700'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#6bff8f'
  secondary-fixed-dim: '#4ae176'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005321'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Montserrat
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
  score-md:
    fontFamily: Montserrat
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: 0.05em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  container-margin: 20px
  gutter: 16px
---

## Brand & Style

The design system is engineered for high-energy, mobile-first engagement. It centers on a **Modern Playful** aesthetic that balances professional reliability with the dopamine-driven excitement of gaming. The goal is to make every interaction feel like a micro-reward.

The style leverages **2D Flat-plus**—a clean, flat foundation enhanced by soft, intentional depth and vibrant gradients. This approach ensures the interface remains functional and "clean" for professional contexts while using saturated accents and generous roundedness to evoke friendliness and optimism. The UI avoids skeuomorphism in favor of high-contrast "squishy" interactive elements that feel responsive and tactile.

## Colors

The palette is designed to drive action and celebrate achievement. 

- **Primary (Electric Indigo):** Used for "Play" actions, primary buttons, and active states. It provides a modern, high-energy focal point.
- **Success (Emerald Pulse):** Dedicated to points, leveling up, and positive feedback loops.
- **Reward (Golden Sun):** Reserved for high-value interactions like claiming prizes, badges, and streaks.
- **Background & Surface:** A crisp `#F5F5F5` background ensures that white cards (`#FFFFFF`) pop with clarity, maintaining a structured, professional hierarchy.

Gradients should be used sparingly on primary actions and progress bars, typically a 10% shift in hue/brightness to add "shimmer" and energy without reducing legibility.

## Typography

This design system uses a dual-type approach to balance personality with utility.

- **Montserrat** is the voice of the brand. It is used for headlines, scores, and rankings. Its geometric nature and high x-height make numeric data (like point totals) feel bold and authoritative.
- **Inter** handles the functional heavy lifting. It is used for all body copy, descriptions, and input labels to ensure maximum legibility at small sizes on mobile screens.

Use `score-md` for leaderboard ranks and currency values to differentiate them from standard UI labels.

## Layout & Spacing

The layout follows a **Fluid Mobile-First** philosophy. Since the platform is primarily viewed on handheld devices, the layout relies on a flexible 4-column grid for mobile and an 8-column grid for tablets.

- **Margins:** A standard 20px safe area is maintained on the left and right of the screen.
- **Rhythm:** An 8px linear scale (with 4px increments for tight components) governs all padding and margins. 
- **Stacking:** Use `spacing.lg` (24px) between distinct content sections (e.g., between a Sponsor Banner and a Game List) to maintain a clean, airy feel despite the vibrant colors.

## Elevation & Depth

To maintain the "2D Flat-plus" look, elevation is communicated through **Soft Ambient Shadows** rather than harsh outlines.

- **Level 1 (Cards/Chips):** A very subtle blur (Y: 2, Blur: 8, Color: 0,0,0, 0.05) to lift elements off the light gray background.
- **Level 2 (Active Buttons/Banners):** A more pronounced, colorful shadow (Y: 4, Blur: 12, Color: Primary_Hex, 0.15) to suggest interactivity and importance.
- **Level 3 (Modals/Overlays):** Deep, diffused shadows to focus user attention, paired with a subtle background dimming.

Avoid inner shadows or heavy bevels. The depth should feel like paper layers stacked on top of one another.

## Shapes

The shape language is defined by **High Circularity**. 

- **Standard Elements:** Buttons, cards, and input fields use a consistent radius (14px to 20px) to feel friendly and safe.
- **Icon Enclosures:** Game icons and avatars should always be housed in "Squircle" or fully rounded containers to maintain the soft aesthetic.
- **Interactive Feedback:** When pressed, buttons should scale down slightly (e.g., 97%) rather than just changing color, reinforcing the "tactile" quality of the system.

## Components

### Buttons & Controls
- **Primary Button:** 48px height, 14px corner radius. Uses a subtle vertical gradient of the Primary color. Text is always white, centered, and bold.
- **OTP Inputs:** 56x56px squares with 12px radius. Active state features a 2px Primary border and a soft glow shadow.

### Cards & Banners
- **Game Cards:** 80x80px square cards with rounded corners. They should feature a centered icon or illustration. The label sits outside the card below it.
- **Sponsor Banners:** 430:160 aspect ratio (responsive). Banners use the `rounded-lg` (16px) radius. They should feature a "glassy" tag in the corner for the "Sponsored" label.

### Lists & Navigation
- **Leaderboard List:** Items are 64px high with 1px light gray separators. The rank (1st, 2nd, 3rd) uses Reward/Gold colors for the top three.
- **Bottom Navigation:** A fixed 64px height bar with a white background. Icons use the Primary color for active states and a mid-gray for inactive. A 1px subtle top border or very soft shadow separates it from the content.

### Feedback
- **Chips:** Used for categories or points. 32px height, fully pill-shaped (rounded-xl). High-contrast background (light version of the accent color) with dark text.