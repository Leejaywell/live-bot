import React, { createContext, useContext, useState, useEffect } from 'react';

export type BackgroundEffectType =
  | 'particle-galaxy' // 1. 粒子星河
  | 'fluid-ripple'    // 2. 流体波纹
  | 'aurora-bands'    // 3. 极光光带
  | 'sakura-fall'     // 4. 樱花飘落
  | 'constellation'   // 5. 星座连线
  | 'blobs'           // 6. 动态气泡
  | 'mountain-parallax' // 7. 山水层峦
  | 'gold-flakes';    // 8. 金箔微光

interface ThemeContextType {
  theme: 'light' | 'dark';
  primaryColor: string;
  hue: number;
  saturation: number;
  lightness: number;
  blur: number;
  backgroundEffect: BackgroundEffectType;
  toggleTheme: () => void;
  setPrimaryColor: (color: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setBackgroundEffect: (effect: BackgroundEffectType) => void;
  updateTheme: (updates: Partial<{ hue: number; saturation: number; lightness: number; blur: number }>) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_HUE = 211;
const DEFAULT_SATURATION = 100;
const DEFAULT_LIGHTNESS = 50;
const DEFAULT_BLUR = 20;

export const themePresets = [
  {
    id: 'blue',
    name: '蓝色',
    primary: '#4b8eff',
    primaryLight: '#adc6ff',
    primaryDark: '#005bc1',
    blob: '#4b8eff',
    hue: 211,
  },
  {
    id: 'pink',
    name: '玫红',
    primary: '#de0541',
    primaryLight: '#ffb3b5',
    primaryDark: '#920027',
    blob: '#ff2d55',
    hue: 343,
  },
  {
    id: 'green',
    name: '翠绿',
    primary: '#00a741',
    primaryLight: '#53e16f',
    primaryDark: '#00531c',
    blob: '#34c759',
    hue: 143,
  },
  {
    id: 'orange',
    name: '橙色',
    primary: '#ff9500',
    primaryLight: '#ffb366',
    primaryDark: '#cc7700',
    blob: '#ff9500',
    hue: 35,
  },
  {
    id: 'purple',
    name: '紫色',
    primary: '#af52de',
    primaryLight: '#d9b3ff',
    primaryDark: '#7d3ba8',
    blob: '#bf5af2',
    hue: 280,
  },
];


function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
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
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
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
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export { hslToHex };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [hue, setHue] = useState(DEFAULT_HUE);
  const [saturation, setSaturation] = useState(DEFAULT_SATURATION);
  const [lightness, setLightness] = useState(DEFAULT_LIGHTNESS);
  const [blur, setBlur] = useState(DEFAULT_BLUR);
  const [backgroundEffect, setBackgroundEffect] = useState<BackgroundEffectType>('particle-galaxy');
  const [primaryColor, setPrimaryColorState] = useState(themePresets[0].primary);

  useEffect(() => {
    const hsl = hexToHsl(primaryColor);
    setHue(hsl.h);
    setSaturation(hsl.s);
    setLightness(hsl.l);
  }, [primaryColor]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.setProperty('--primary-color', primaryColor);
    document.documentElement.style.setProperty('--primary-hue', hue.toString());
    document.documentElement.style.setProperty('--glass-blur', `${blur}px`);
    
    // Set RGB components for flexible opacity in CSS
    const rgb = hexToRgb(primaryColor);
    if (rgb) {
      document.documentElement.style.setProperty('--primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    }
  }, [theme, primaryColor, hue, blur]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  const setPrimaryColor = (color: string) => {
    setPrimaryColorState(color);
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
  };

  const updateTheme = (updates: Partial<{ hue: number; saturation: number; lightness: number; blur: number }>) => {
    if (updates.hue !== undefined) {
      setHue(updates.hue);
      setPrimaryColorState(hslToHex(updates.hue, saturation, lightness));
    }
    if (updates.saturation !== undefined) {
      setSaturation(updates.saturation);
      setPrimaryColorState(hslToHex(hue, updates.saturation, lightness));
    }
    if (updates.lightness !== undefined) {
      setLightness(updates.lightness);
      setPrimaryColorState(hslToHex(hue, saturation, updates.lightness));
    }
    if (updates.blur !== undefined) setBlur(updates.blur);
  };

  const resetTheme = () => {
    setThemeState('light');
    setPrimaryColorState(themePresets[0].primary);
    setHue(DEFAULT_HUE);
    setSaturation(DEFAULT_SATURATION);
    setLightness(DEFAULT_LIGHTNESS);
    setBlur(DEFAULT_BLUR);
    setBackgroundEffect('particle-galaxy');
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, primaryColor, hue, saturation, lightness, blur, backgroundEffect,
      toggleTheme, setPrimaryColor, setTheme, setBackgroundEffect, updateTheme, resetTheme 
    }}>
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
