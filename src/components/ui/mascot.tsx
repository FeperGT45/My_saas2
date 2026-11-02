import { useId } from 'react';
/** Ри — авторский кристальный скат-комета. SVG, без внешних ассетов. */
export function Mascot({ className = '' }: { className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 240 220"
      role="img"
      aria-label="Ри — космический скат, маскот Voklumi"
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#82fff0" />
          <stop offset=".5" stopColor="#62b8ff" />
          <stop offset="1" stopColor="#a88aff" />
        </linearGradient>
      </defs>
      <ellipse cx="123" cy="197" rx="63" ry="10" fill="#0a0b20" opacity=".3" />
      <path d="M128 140 Q187 157 174 192 Q196 176 178 151" fill="#9e86ff" />
      <path
        d="M105 58 Q120 23 135 58 L155 78 Q172 82 216 56 Q223 124 170 145 Q123 181 73 145 Q21 123 25 57 Q67 83 89 78Z"
        fill={`url(#${id})`}
        stroke="#c0eaff"
        strokeWidth="3"
      />
      <path
        d="M26 61 Q48 109 79 120 L90 81M215 60 Q193 111 162 119 L153 81"
        fill="#6587f2"
        opacity=".45"
      />
      <path d="M121 46 111 65 121 77 131 65Z" fill="#efffff" />
      <ellipse cx="99" cy="110" rx="9" ry="13" fill="#15182e" />
      <ellipse cx="145" cy="110" rx="9" ry="13" fill="#15182e" />
      <circle cx="102" cy="106" r="3" fill="white" />
      <circle cx="148" cy="106" r="3" fill="white" />
      <path
        d="M114 129 Q122 138 130 129"
        fill="none"
        stroke="#242445"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="84" cy="126" rx="9" ry="4" fill="#c499ed" />
      <ellipse cx="159" cy="126" rx="9" ry="4" fill="#c499ed" />
      <path
        d="m40 28 3 8 8 3-8 3-3 8-3-8-8-3 8-3ZM198 143l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"
        fill="#c9b7ff"
      />
      <circle cx="185" cy="26" r="3" fill="#61e6de" />
    </svg>
  );
}
