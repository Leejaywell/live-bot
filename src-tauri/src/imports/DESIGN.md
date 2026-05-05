---
name: Liquid Glass Native
colors:
  surface: '#10131b'
  surface-dim: '#10131b'
  surface-bright: '#363942'
  surface-container-lowest: '#0b0e16'
  surface-container-low: '#181c23'
  surface-container: '#1c2028'
  surface-container-high: '#272a32'
  surface-container-highest: '#31353d'
  on-surface: '#e0e2ed'
  on-surface-variant: '#c1c6d7'
  inverse-surface: '#e0e2ed'
  inverse-on-surface: '#2d3039'
  outline: '#8b90a0'
  outline-variant: '#414755'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e69'
  primary-container: '#4b8eff'
  on-primary-container: '#00285c'
  inverse-primary: '#005bc1'
  secondary: '#ffb3b5'
  on-secondary: '#680019'
  secondary-container: '#de0541'
  on-secondary-container: '#fff1f1'
  tertiary: '#53e16f'
  on-tertiary: '#003911'
  tertiary-container: '#00a741'
  on-tertiary-container: '#00320e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#ffdada'
  secondary-fixed-dim: '#ffb3b5'
  on-secondary-fixed: '#40000c'
  on-secondary-fixed-variant: '#920027'
  tertiary-fixed: '#72fe88'
  tertiary-fixed-dim: '#53e16f'
  on-tertiary-fixed: '#002107'
  on-tertiary-fixed-variant: '#00531c'
  background: '#10131b'
  on-background: '#e0e2ed'
  surface-variant: '#31353d'
typography:
  title:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '700'
    lineHeight: '1.2'
  base:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  section-header:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1.1'
  sub-text:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: '1.4'
  mono:
    fontFamily: SF Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 12px
  margin-window: 20px
---

## Brand & Style

This design system is built upon the **Liquid Glass** aesthetic, a high-fidelity visual language inspired by modern desktop operating systems. It prioritizes depth, translucency, and organic color bleeding to create an interface that feels like a physical object suspended in light.

The target audience consists of power users who value a premium, native desktop experience that feels integrated with the system's hardware acceleration. The UI evokes a sense of fluid responsiveness and clarity, utilizing heavy Gaussian blurs and specular highlights to differentiate interaction layers. The mood is sophisticated, vibrant, and energetic, moving away from flat design toward a more tactile, "wet" digital surface.

## Colors

The palette is rooted in high-chroma iOS-inspired tones that pierce through semi-transparent surfaces. The system defaults to **Dark Mode** to emphasize the luminosity of the glass effects.

- **Backgrounds:** A 160° linear gradient forms the base. In light mode, it transitions from soft silver-blue to a cool grey. In dark mode, it moves from deep charcoal to an ink-black.
- **Ambient Blobs:** Three large Gaussian blobs float behind the UI: Primary Blue (top-left), Rose Pink (top-right), and Emerald Green (bottom-right). These should have a blur radius of at least 80px and 0.4 opacity.
- **Glass Surfaces:** Cards use a variable transparency (approx. 60-80% opacity) with a white tint for light mode and a dark grey/black tint for dark mode.

## Typography

The typography system relies on **Inter** (representing SF Pro/PingFang SC equivalents) for all interface text, ensuring maximum legibility at small native sizes. 

- **Hierarchy:** Titles are bold and compact (17px). Section headers use small-caps/uppercase styling (11px) to create structural breaks. 
- **Language Support:** For Chinese characters, fallback to **PingFang SC** is required to maintain the native macOS weight distribution.
- **Monospace:** Technical data, bot logs, and addresses must use **SF Mono** to ensure character alignment and a technical "command center" feel.

## Layout & Spacing

The layout philosophy follows a **Fluid Native** model. Elements are arranged using a flexible flex-box approach that accommodates window resizing typical of desktop applications.

- **Margins:** A consistent 20px "safe area" margin is maintained around the main window perimeter.
- **Gaps:** Standard spacing follows a 4px-base grid. Most interactive components are separated by 12px (gutter) to allow the background glass effect to remain visible between layers.
- **Alignment:** All content is center-aligned vertically within glass cards to emphasize the "floating" nature of the UI.

## Elevation & Depth

Depth is the core of this design system. Rather than traditional drop shadows, depth is communicated through:

1.  **Backdrop Blur:** Every glass card must apply a `backdrop-filter: blur(20px)`.
2.  **The Rim:** A 1px internal border (stroke) acts as a specular highlight. On the top and left, use a high-opacity light color; on the bottom and right, use a lower-opacity dark color to simulate 3D thickness.
3.  **Layering:** Active elements (like buttons or hovered cards) should increase their backdrop blur and slightly lighten their background tint to "rise" toward the user.

## Shapes

The shape language is organic and highly rounded.
- **Cards:** Use a range between 14px and 22px for corner radii depending on the container size. Larger parent containers use the 22px radius, while nested cards use 14px.
- **Interactions:** All buttons and input fields utilize a pill-shaped (capsule) geometry to contrast against the rectangular cards.
- **Icons:** Icons are contained within circular backgrounds or AutoCards with radial gradient fills.

## Components

- **Capsule Buttons:** Solid primary color fills with white text. Hover states should feature a subtle inner glow (specular highlight).
- **Circular Icon Buttons:** Semi-transparent glass circles with 1px rims. Icons should be centered and use the primary color or white.
- **Toggle Switches:** Strictly 36x20px. The "off" state is a translucent grey glass; the "on" state is the Primary Blue. The "knob" is a bright white circle with a soft shadow.
- **AutoCards:** Feature a soft radial gradient icon in the top-left corner. The card itself has a 1px rim and 18px border radius.
- **Lists:** Items are separated by a 0.5px hairline divider with 10% opacity, or grouped into individual "sub-glass" cards for higher hierarchy.
- **Input Fields:** Capsule-shaped with a darker glass tint than the parent card. Text is indented 12px from the left.