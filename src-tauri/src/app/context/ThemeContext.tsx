import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type VisualThemeId =
  | 'particle-galaxy'
  | 'fluid-ripple'
  | 'aurora-bands'
  | 'sakura-fall'
  | 'constellation'
  | 'blobs'
  | 'mountain-parallax'
  | 'gold-flakes'
  | 'ink-wash-bloom'
  | 'ink-brush-trace'
  | 'misty-peaks'
  | 'river-lantern'
  | 'bamboo-breeze'
  | 'bamboo-rain'
  | 'lotus-pond'
  | 'palace-lantern'
  | 'deep-sea-drift'
  | 'coral-reef'
  | 'meteor-shower'
  | 'nebula-drift';

export type BackgroundEffectType = VisualThemeId;
type ColorSource = 'theme' | 'custom';

interface VisualThemeDefinition {
  id: VisualThemeId;
  primary: string;
  accent: string;
  backgroundLight: string;
  backgroundDark: string;
  surfaceLight: string;
  surfaceDark: string;
  surfaceBorderLight: string;
  surfaceBorderDark: string;
  topbarLight: string;
  topbarDark: string;
  topbarBorderLight: string;
  topbarBorderDark: string;
  sidebarLight: string;
  sidebarDark: string;
  sidebarBorderLight: string;
  sidebarBorderDark: string;
  modalBackdropLight: string;
  modalBackdropDark: string;
}

interface ThemeContextType {
  theme: 'light' | 'dark';
  primaryColor: string;
  accentColor: string;
  hue: number;
  saturation: number;
  lightness: number;
  blur: number;
  visualTheme: VisualThemeId;
  backgroundEffect: BackgroundEffectType;
  colorSource: ColorSource;
  toggleTheme: () => void;
  setPrimaryColor: (color: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setVisualTheme: (themeId: VisualThemeId) => void;
  setBackgroundEffect: (effect: BackgroundEffectType) => void;
  updateTheme: (updates: Partial<{ hue: number; saturation: number; lightness: number; blur: number }>) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_VISUAL_THEME: VisualThemeId = 'mountain-parallax';
const DEFAULT_BLUR = 20;

export const themePresets = [
  { id: 'blue', name: '蓝色', primary: '#4b8eff' },
  { id: 'pink', name: '玫红', primary: '#de0541' },
  { id: 'green', name: '翠绿', primary: '#00a741' },
  { id: 'orange', name: '橙色', primary: '#ff9500' },
  { id: 'purple', name: '紫色', primary: '#af52de' },
];

export const visualThemes: Record<VisualThemeId, VisualThemeDefinition> = {
  'particle-galaxy': {
    id: 'particle-galaxy',
    primary: '#6f63ff',
    accent: '#37d6ff',
    backgroundLight: '#eef2ff',
    backgroundDark: '#070914',
    surfaceLight: 'rgba(245, 247, 255, 0.82)',
    surfaceDark: 'rgba(18, 20, 36, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.60)',
    surfaceBorderDark: 'rgba(152, 168, 255, 0.12)',
    topbarLight: 'rgba(255, 255, 255, 0.42)',
    topbarDark: 'rgba(15, 18, 34, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.22)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(255, 255, 255, 0.46)',
    sidebarDark: 'rgba(15, 18, 34, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.22)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(32, 44, 96, 0.20)',
    modalBackdropDark: 'rgba(4, 6, 18, 0.46)',
  },
  'fluid-ripple': {
    id: 'fluid-ripple',
    primary: '#00a8d8',
    accent: '#5de1ff',
    backgroundLight: '#edf8fc',
    backgroundDark: '#061219',
    surfaceLight: 'rgba(242, 251, 255, 0.82)',
    surfaceDark: 'rgba(12, 28, 34, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(111, 232, 255, 0.12)',
    topbarLight: 'rgba(250, 255, 255, 0.42)',
    topbarDark: 'rgba(11, 26, 31, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(250, 255, 255, 0.48)',
    sidebarDark: 'rgba(11, 26, 31, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(0, 114, 155, 0.18)',
    modalBackdropDark: 'rgba(2, 14, 20, 0.46)',
  },
  'aurora-bands': {
    id: 'aurora-bands',
    primary: '#4ecf94',
    accent: '#a05bff',
    backgroundLight: '#eff8f5',
    backgroundDark: '#07120f',
    surfaceLight: 'rgba(244, 252, 248, 0.82)',
    surfaceDark: 'rgba(16, 28, 24, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(153, 255, 210, 0.12)',
    topbarLight: 'rgba(250, 255, 252, 0.42)',
    topbarDark: 'rgba(14, 25, 21, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(250, 255, 252, 0.48)',
    sidebarDark: 'rgba(14, 25, 21, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(59, 172, 130, 0.18)',
    modalBackdropDark: 'rgba(3, 14, 10, 0.46)',
  },
  'sakura-fall': {
    id: 'sakura-fall',
    primary: '#ef6d9f',
    accent: '#ffc0d7',
    backgroundLight: '#fff1f6',
    backgroundDark: '#170910',
    surfaceLight: 'rgba(255, 246, 250, 0.84)',
    surfaceDark: 'rgba(36, 18, 28, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(255, 181, 212, 0.12)',
    topbarLight: 'rgba(255, 249, 251, 0.44)',
    topbarDark: 'rgba(33, 17, 26, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(255, 249, 251, 0.48)',
    sidebarDark: 'rgba(33, 17, 26, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(200, 81, 130, 0.18)',
    modalBackdropDark: 'rgba(20, 8, 14, 0.46)',
  },
  constellation: {
    id: 'constellation',
    primary: '#7b97ff',
    accent: '#c5d7ff',
    backgroundLight: '#f1f5ff',
    backgroundDark: '#09101d',
    surfaceLight: 'rgba(246, 248, 255, 0.82)',
    surfaceDark: 'rgba(19, 26, 43, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(164, 190, 255, 0.12)',
    topbarLight: 'rgba(250, 252, 255, 0.42)',
    topbarDark: 'rgba(17, 23, 39, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(250, 252, 255, 0.48)',
    sidebarDark: 'rgba(17, 23, 39, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(77, 104, 199, 0.18)',
    modalBackdropDark: 'rgba(6, 10, 18, 0.46)',
  },
  blobs: {
    id: 'blobs',
    primary: '#26b8c9',
    accent: '#8fe7ef',
    backgroundLight: '#edfafd',
    backgroundDark: '#061519',
    surfaceLight: 'rgba(243, 253, 255, 0.84)',
    surfaceDark: 'rgba(16, 28, 31, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.60)',
    surfaceBorderDark: 'rgba(143, 231, 239, 0.12)',
    topbarLight: 'rgba(251, 255, 255, 0.42)',
    topbarDark: 'rgba(14, 25, 28, 0.44)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.22)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(251, 255, 255, 0.46)',
    sidebarDark: 'rgba(14, 25, 28, 0.46)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.22)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(38, 184, 201, 0.18)',
    modalBackdropDark: 'rgba(4, 12, 15, 0.46)',
  },
  'mountain-parallax': {
    id: 'mountain-parallax',
    primary: '#5f7f78',
    accent: '#c8a66b',
    backgroundLight: '#f2f5f1',
    backgroundDark: '#0a100f',
    surfaceLight: 'rgba(247, 249, 245, 0.84)',
    surfaceDark: 'rgba(20, 27, 24, 0.68)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(209, 225, 207, 0.10)',
    topbarLight: 'rgba(252, 253, 250, 0.44)',
    topbarDark: 'rgba(16, 22, 19, 0.46)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(252, 253, 250, 0.48)',
    sidebarDark: 'rgba(16, 22, 19, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(94, 116, 103, 0.18)',
    modalBackdropDark: 'rgba(7, 12, 11, 0.46)',
  },
  'gold-flakes': {
    id: 'gold-flakes',
    primary: '#c9983a',
    accent: '#f0d48e',
    backgroundLight: '#faf5ea',
    backgroundDark: '#14100b',
    surfaceLight: 'rgba(255, 249, 239, 0.86)',
    surfaceDark: 'rgba(31, 24, 18, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(244, 214, 148, 0.12)',
    topbarLight: 'rgba(255, 252, 246, 0.44)',
    topbarDark: 'rgba(28, 22, 16, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(255, 252, 246, 0.48)',
    sidebarDark: 'rgba(28, 22, 16, 0.48)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(165, 128, 62, 0.18)',
    modalBackdropDark: 'rgba(18, 12, 6, 0.48)',
  },
  'ink-wash-bloom': {
    id: 'ink-wash-bloom',
    primary: '#5d6e82',
    accent: '#c2ccd7',
    backgroundLight: '#f4f1ea',
    backgroundDark: '#0d1115',
    surfaceLight: 'rgba(251, 248, 241, 0.86)',
    surfaceDark: 'rgba(20, 24, 30, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.66)',
    surfaceBorderDark: 'rgba(208, 218, 228, 0.10)',
    topbarLight: 'rgba(255, 251, 246, 0.44)',
    topbarDark: 'rgba(18, 22, 28, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(255, 251, 246, 0.48)',
    sidebarDark: 'rgba(18, 22, 28, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(77, 89, 104, 0.18)',
    modalBackdropDark: 'rgba(8, 10, 13, 0.48)',
  },
  'ink-brush-trace': {
    id: 'ink-brush-trace',
    primary: '#4a5663',
    accent: '#b46658',
    backgroundLight: '#f3efe8',
    backgroundDark: '#110f12',
    surfaceLight: 'rgba(250, 246, 239, 0.86)',
    surfaceDark: 'rgba(27, 23, 27, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(210, 187, 180, 0.10)',
    topbarLight: 'rgba(255, 251, 245, 0.44)',
    topbarDark: 'rgba(24, 20, 24, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(255, 251, 245, 0.48)',
    sidebarDark: 'rgba(24, 20, 24, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(95, 82, 77, 0.18)',
    modalBackdropDark: 'rgba(10, 8, 10, 0.48)',
  },
  'misty-peaks': {
    id: 'misty-peaks',
    primary: '#667d74',
    accent: '#d1b57c',
    backgroundLight: '#f1f4ef',
    backgroundDark: '#0b1210',
    surfaceLight: 'rgba(247, 250, 245, 0.84)',
    surfaceDark: 'rgba(20, 27, 24, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(206, 225, 214, 0.10)',
    topbarLight: 'rgba(251, 253, 249, 0.44)',
    topbarDark: 'rgba(17, 23, 20, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(251, 253, 249, 0.48)',
    sidebarDark: 'rgba(17, 23, 20, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(97, 117, 105, 0.18)',
    modalBackdropDark: 'rgba(8, 12, 10, 0.48)',
  },
  'river-lantern': {
    id: 'river-lantern',
    primary: '#486b73',
    accent: '#f2c26b',
    backgroundLight: '#edf4f3',
    backgroundDark: '#091111',
    surfaceLight: 'rgba(244, 250, 248, 0.84)',
    surfaceDark: 'rgba(17, 27, 28, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(191, 223, 219, 0.10)',
    topbarLight: 'rgba(249, 253, 252, 0.44)',
    topbarDark: 'rgba(15, 23, 24, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(249, 253, 252, 0.48)',
    sidebarDark: 'rgba(15, 23, 24, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(78, 110, 114, 0.18)',
    modalBackdropDark: 'rgba(7, 12, 13, 0.48)',
  },
  'bamboo-breeze': {
    id: 'bamboo-breeze',
    primary: '#557a63',
    accent: '#c7dfb4',
    backgroundLight: '#eff6ef',
    backgroundDark: '#09110d',
    surfaceLight: 'rgba(245, 251, 245, 0.84)',
    surfaceDark: 'rgba(18, 27, 21, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(199, 230, 195, 0.10)',
    topbarLight: 'rgba(250, 254, 249, 0.44)',
    topbarDark: 'rgba(15, 23, 18, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(250, 254, 249, 0.48)',
    sidebarDark: 'rgba(15, 23, 18, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(92, 131, 104, 0.18)',
    modalBackdropDark: 'rgba(7, 11, 8, 0.48)',
  },
  'bamboo-rain': {
    id: 'bamboo-rain',
    primary: '#3f6756',
    accent: '#a9d1bf',
    backgroundLight: '#eef5f1',
    backgroundDark: '#08100c',
    surfaceLight: 'rgba(244, 250, 246, 0.84)',
    surfaceDark: 'rgba(16, 26, 20, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(186, 220, 205, 0.10)',
    topbarLight: 'rgba(249, 253, 250, 0.44)',
    topbarDark: 'rgba(14, 22, 17, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(249, 253, 250, 0.48)',
    sidebarDark: 'rgba(14, 22, 17, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(67, 104, 88, 0.18)',
    modalBackdropDark: 'rgba(6, 10, 8, 0.48)',
  },
  'lotus-pond': {
    id: 'lotus-pond',
    primary: '#7a9e8e',
    accent: '#e8c4c4',
    backgroundLight: '#f0f5f2',
    backgroundDark: '#091110',
    surfaceLight: 'rgba(245, 251, 248, 0.84)',
    surfaceDark: 'rgba(16, 27, 24, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(196, 226, 214, 0.10)',
    topbarLight: 'rgba(249, 253, 251, 0.44)',
    topbarDark: 'rgba(14, 24, 21, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(249, 253, 251, 0.48)',
    sidebarDark: 'rgba(14, 24, 21, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(88, 128, 110, 0.18)',
    modalBackdropDark: 'rgba(6, 12, 10, 0.48)',
  },
  'palace-lantern': {
    id: 'palace-lantern',
    primary: '#c0392b',
    accent: '#f0c060',
    backgroundLight: '#fdf0ec',
    backgroundDark: '#180c08',
    surfaceLight: 'rgba(254, 247, 244, 0.86)',
    surfaceDark: 'rgba(34, 18, 14, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.66)',
    surfaceBorderDark: 'rgba(240, 196, 160, 0.12)',
    topbarLight: 'rgba(255, 250, 247, 0.44)',
    topbarDark: 'rgba(30, 16, 12, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(255, 250, 247, 0.48)',
    sidebarDark: 'rgba(30, 16, 12, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(160, 56, 36, 0.18)',
    modalBackdropDark: 'rgba(16, 8, 6, 0.48)',
  },
  'deep-sea-drift': {
    id: 'deep-sea-drift',
    primary: '#0a6b8c',
    accent: '#6ae4d8',
    backgroundLight: '#e8f5f8',
    backgroundDark: '#030d12',
    surfaceLight: 'rgba(236, 249, 252, 0.84)',
    surfaceDark: 'rgba(8, 24, 30, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(106, 228, 216, 0.10)',
    topbarLight: 'rgba(242, 251, 254, 0.44)',
    topbarDark: 'rgba(7, 20, 26, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(242, 251, 254, 0.48)',
    sidebarDark: 'rgba(7, 20, 26, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(22, 110, 138, 0.18)',
    modalBackdropDark: 'rgba(2, 8, 12, 0.48)',
  },
  'coral-reef': {
    id: 'coral-reef',
    primary: '#2e9daa',
    accent: '#ff7f6e',
    backgroundLight: '#eaf7f8',
    backgroundDark: '#041214',
    surfaceLight: 'rgba(238, 250, 251, 0.84)',
    surfaceDark: 'rgba(12, 28, 30, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.64)',
    surfaceBorderDark: 'rgba(120, 220, 228, 0.10)',
    topbarLight: 'rgba(244, 252, 253, 0.44)',
    topbarDark: 'rgba(10, 24, 26, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.05)',
    sidebarLight: 'rgba(244, 252, 253, 0.48)',
    sidebarDark: 'rgba(10, 24, 26, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.05)',
    modalBackdropLight: 'rgba(48, 158, 168, 0.18)',
    modalBackdropDark: 'rgba(3, 10, 12, 0.48)',
  },
  'meteor-shower': {
    id: 'meteor-shower',
    primary: '#9b8eff',
    accent: '#ffe4a0',
    backgroundLight: '#f3f1ff',
    backgroundDark: '#08060f',
    surfaceLight: 'rgba(246, 244, 255, 0.84)',
    surfaceDark: 'rgba(16, 14, 28, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(180, 170, 255, 0.12)',
    topbarLight: 'rgba(250, 249, 255, 0.44)',
    topbarDark: 'rgba(14, 12, 24, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(250, 249, 255, 0.48)',
    sidebarDark: 'rgba(14, 12, 24, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(110, 96, 200, 0.18)',
    modalBackdropDark: 'rgba(6, 4, 12, 0.48)',
  },
  'nebula-drift': {
    id: 'nebula-drift',
    primary: '#c46dff',
    accent: '#6df5c8',
    backgroundLight: '#f6f0ff',
    backgroundDark: '#0a060f',
    surfaceLight: 'rgba(248, 244, 255, 0.84)',
    surfaceDark: 'rgba(20, 14, 30, 0.70)',
    surfaceBorderLight: 'rgba(255, 255, 255, 0.62)',
    surfaceBorderDark: 'rgba(196, 109, 255, 0.12)',
    topbarLight: 'rgba(252, 249, 255, 0.44)',
    topbarDark: 'rgba(17, 12, 26, 0.48)',
    topbarBorderLight: 'rgba(255, 255, 255, 0.24)',
    topbarBorderDark: 'rgba(255, 255, 255, 0.06)',
    sidebarLight: 'rgba(252, 249, 255, 0.48)',
    sidebarDark: 'rgba(17, 12, 26, 0.50)',
    sidebarBorderLight: 'rgba(255, 255, 255, 0.24)',
    sidebarBorderDark: 'rgba(255, 255, 255, 0.06)',
    modalBackdropLight: 'rgba(155, 88, 210, 0.18)',
    modalBackdropDark: 'rgba(8, 4, 12, 0.48)',
  },
};

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 0 };

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export { hslToHex };

function rgba(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : `rgba(75, 142, 255, ${alpha})`;
}

function mixHex(base: string, target: string, amount: number) {
  const a = hexToRgb(base);
  const b = hexToRgb(target);
  if (!a || !b) return base;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `#${mix(a.r, b.r).toString(16).padStart(2, '0')}${mix(a.g, b.g).toString(16).padStart(2, '0')}${mix(a.b, b.b).toString(16).padStart(2, '0')}`;
}

function deriveAccent(primary: string) {
  const { h, s, l } = hexToHsl(primary);
  return hslToHex((h + 28) % 360, Math.min(95, Math.max(48, s)), Math.min(72, Math.max(44, l + 6)));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [visualTheme, setVisualThemeState] = useState<VisualThemeId>(DEFAULT_VISUAL_THEME);
  const [colorSource, setColorSource] = useState<ColorSource>('theme');
  const [customPrimaryColor, setCustomPrimaryColor] = useState(themePresets[0].primary);
  const [blur, setBlur] = useState(DEFAULT_BLUR);

  const activeTheme = visualThemes[visualTheme];
  const primaryColor = colorSource === 'custom' ? customPrimaryColor : activeTheme.primary;
  const accentColor = colorSource === 'custom' ? deriveAccent(customPrimaryColor) : activeTheme.accent;
  const { h: hue, s: saturation, l: lightness } = useMemo(() => hexToHsl(primaryColor), [primaryColor]);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === 'dark';
    const primaryRgb = hexToRgb(primaryColor);
    const accentRgb = hexToRgb(accentColor);

    root.classList.toggle('dark', isDark);
    root.style.setProperty('--primary-color', primaryColor);
    root.style.setProperty('--accent-color', accentColor);
    root.style.setProperty('--primary-hue', hue.toString());
    root.style.setProperty('--glass-blur', `${blur}px`);
    root.style.setProperty('--background', isDark ? activeTheme.backgroundDark : activeTheme.backgroundLight);
    root.style.setProperty('--foreground', isDark ? '#f6f7fb' : '#1b2233');
    root.style.setProperty('--surface-bg', isDark ? activeTheme.surfaceDark : activeTheme.surfaceLight);
    root.style.setProperty('--surface-border', isDark ? activeTheme.surfaceBorderDark : activeTheme.surfaceBorderLight);
    root.style.setProperty('--surface-shadow', isDark ? '0 16px 40px rgba(0, 0, 0, 0.30)' : '0 10px 32px rgba(24, 36, 80, 0.08)');
    root.style.setProperty('--surface-subtle', isDark ? rgba(primaryColor, 0.10) : rgba(primaryColor, 0.07));
    root.style.setProperty('--surface-subtle-strong', isDark ? rgba(primaryColor, 0.16) : rgba(primaryColor, 0.12));
    root.style.setProperty('--topbar-bg', isDark ? activeTheme.topbarDark : activeTheme.topbarLight);
    root.style.setProperty('--topbar-border', isDark ? activeTheme.topbarBorderDark : activeTheme.topbarBorderLight);
    root.style.setProperty('--sidebar-bg', isDark ? activeTheme.sidebarDark : activeTheme.sidebarLight);
    root.style.setProperty('--sidebar-border', isDark ? activeTheme.sidebarBorderDark : activeTheme.sidebarBorderLight);
    root.style.setProperty('--control-bg', isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.70)');
    root.style.setProperty('--control-bg-hover', isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.84)');
    root.style.setProperty('--control-border', isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(150, 170, 210, 0.22)');
    root.style.setProperty('--control-text', isDark ? '#eef2ff' : '#35405e');
    root.style.setProperty('--muted-text', isDark ? '#a4adbf' : '#71809e');
    root.style.setProperty('--button-primary-bg', primaryColor);
    root.style.setProperty('--button-primary-hover', mixHex(primaryColor, isDark ? '#ffffff' : '#000000', 0.08));
    root.style.setProperty('--button-primary-text', '#ffffff');
    root.style.setProperty('--button-default-bg', isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.72)');
    root.style.setProperty('--button-default-hover', isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.88)');
    root.style.setProperty('--button-default-border', isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(150, 170, 210, 0.24)');
    root.style.setProperty('--button-default-text', isDark ? '#f5f7ff' : '#33405d');
    root.style.setProperty('--button-ghost-text', isDark ? '#dbe3f6' : '#586884');
    root.style.setProperty('--button-ghost-hover', isDark ? 'rgba(255, 255, 255, 0.10)' : rgba(primaryColor, 0.08));
    root.style.setProperty('--button-active-soft-bg', isDark ? rgba(primaryColor, 0.18) : rgba(primaryColor, 0.12));
    root.style.setProperty('--button-active-soft-border', isDark ? rgba(primaryColor, 0.34) : rgba(primaryColor, 0.24));
    root.style.setProperty('--button-active-soft-text', primaryColor);
    root.style.setProperty('--modal-backdrop', isDark ? activeTheme.modalBackdropDark : activeTheme.modalBackdropLight);
    root.style.setProperty('--page-tint', isDark ? rgba(accentColor, 0.08) : rgba(accentColor, 0.05));
    root.style.setProperty('--theme-glow', isDark ? rgba(accentColor, 0.18) : rgba(accentColor, 0.12));
    root.style.setProperty('--outline-soft', isDark ? rgba(primaryColor, 0.36) : rgba(primaryColor, 0.24));
    root.style.setProperty('--toggle-off-bg', isDark ? '#4a4a52' : '#d4d4d9');

    if (primaryRgb) {
      root.style.setProperty('--primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
    }
    if (accentRgb) {
      root.style.setProperty('--accent-rgb', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`);
    }
  }, [theme, activeTheme, primaryColor, accentColor, hue, blur]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const setPrimaryColor = (color: string) => {
    setColorSource('custom');
    setCustomPrimaryColor(color);
  };

  const setVisualTheme = (themeId: VisualThemeId) => {
    setVisualThemeState(themeId);
    setColorSource('theme');
  };

  const setBackgroundEffect = (effect: BackgroundEffectType) => {
    setVisualTheme(effect);
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
  };

  const updateTheme = (updates: Partial<{ hue: number; saturation: number; lightness: number; blur: number }>) => {
    if (
      updates.hue !== undefined ||
      updates.saturation !== undefined ||
      updates.lightness !== undefined
    ) {
      const nextHue = updates.hue ?? hue;
      const nextSaturation = updates.saturation ?? saturation;
      const nextLightness = updates.lightness ?? lightness;
      setColorSource('custom');
      setCustomPrimaryColor(hslToHex(nextHue, nextSaturation, nextLightness));
    }
    if (updates.blur !== undefined) {
      setBlur(updates.blur);
    }
  };

  const resetTheme = () => {
    setThemeState('light');
    setVisualThemeState(DEFAULT_VISUAL_THEME);
    setColorSource('theme');
    setCustomPrimaryColor(themePresets[0].primary);
    setBlur(DEFAULT_BLUR);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        primaryColor,
        accentColor,
        hue,
        saturation,
        lightness,
        blur,
        visualTheme,
        backgroundEffect: visualTheme,
        colorSource,
        toggleTheme,
        setPrimaryColor,
        setTheme,
        setVisualTheme,
        setBackgroundEffect,
        updateTheme,
        resetTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
