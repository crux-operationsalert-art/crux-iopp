/** One line-icon set (1.6px stroke, 24 grid) instead of emoji, so every screen looks the same on every phone (D-100). */
const P: Record<string, string> = {
  home: 'M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z',
  day: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M8 16.5h6',
  chat: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1-3 3.6-4.5 6.5-4.5s5.5 1.5 6.5 4.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.6c1.6.6 2.8 2 3.5 4.4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
  rupee: 'M7 4h10M7 8.5h10M7 4c5 0 6 1.5 6 4.5S11 13 7 13l7.5 7',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4.5l3 1.5',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  flame: 'M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.9 3.1-5.9 3.9-9.8 2.4 1.6 3.4 3.7 3.4 5.6 1-.6 1.7-1.6 2-2.8 2 1.8 3.7 4.3 3.7 7 0 3.6-2.6 6.2-6.5 6.2z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  send: 'M4 12 20 4l-6 16-2.5-6.5z M11.5 13.5 20 4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  seal: 'M12 2.8l2 1.6 2.5-.3.9 2.4 2.3 1.1-.4 2.5 1.5 2-1.5 2 .4 2.5-2.3 1.1-.9 2.4-2.5-.3-2 1.6-2-1.6-2.5.3-.9-2.4-2.3-1.1.4-2.5-1.5-2 1.5-2-.4-2.5 2.3-1.1.9-2.4 2.5.3z',
};
export type IconName = keyof typeof P;
export function Icon({ name, size = 20, className = '', title }: { name: string; size?: number; className?: string; title?: string }) {
  const d = P[name] ?? P.spark;
  return (
    <svg className={`ico-svg ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}<path d={d} />
    </svg>
  );
}
