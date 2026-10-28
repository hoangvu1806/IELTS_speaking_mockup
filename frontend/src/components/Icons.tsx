import type { ReactNode } from 'react'

type P = { size?: number }

const svg = (size: number, children: ReactNode, fill = false) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const MicIcon = ({ size = 28 }: P) =>
  svg(size, <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" /></>)
export const StopIcon = ({ size = 28 }: P) => svg(size, <rect x="6" y="6" width="12" height="12" rx="2" />, true)
export const SpeakerIcon = ({ size = 20 }: P) =>
  svg(size, <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>)
export const PlayIcon = ({ size = 20 }: P) => svg(size, <path d="M7 4.5v15l13-7.5z" />, true)
export const TurtleIcon = ({ size = 20 }: P) =>
  svg(size, <><path d="M4 15a8 6 0 0 1 16 0z" /><path d="M20 13h2M6 15l-1 3M18 15l1 3M2 14l2 1" /></>)
export const BookIcon = ({ size = 18 }: P) =>
  svg(size, <><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5z" /><path d="M8 7h7M8 11h5" /></>)
export const PenIcon = ({ size = 18 }: P) => svg(size, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>)
export const ChatIcon = ({ size = 18 }: P) =>
  svg(size, <><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" /></>)
export const ChartIcon = ({ size = 18 }: P) => svg(size, <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>)
export const KeyboardIcon = ({ size = 20 }: P) =>
  svg(size, <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10" /></>)
export const SendIcon = ({ size = 18 }: P) => svg(size, <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>)
export const WaveIcon = ({ size = 18 }: P) => svg(size, <path d="M3 12h1M7 8v8M11 5v14M15 8v8M19 10v4" />)
export const PrintIcon = ({ size = 18 }: P) =>
  svg(size, <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>)
export const ChevronLeft = ({ size = 20 }: P) => svg(size, <path d="m15 18-6-6 6-6" />)
export const ChevronRight = ({ size = 20 }: P) => svg(size, <path d="m9 18 6-6-6-6" />)
export const Spinner = ({ size = 28 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" fill="none" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
)
