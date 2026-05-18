interface MarqueeTextProps {
  children: string | number | null | undefined;
  className?: string;
}

export function MarqueeText({ children, className }: MarqueeTextProps) {
  return <span className={['marquee-text', className || ''].join(' ')}>{children || ''}</span>;
}
