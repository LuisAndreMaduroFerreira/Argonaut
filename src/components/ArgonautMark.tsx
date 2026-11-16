interface ArgonautMarkProps {
  size?: number;
}

export function ArgonautMark({ size = 30 }: ArgonautMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      strokeLinecap="round"
      aria-hidden="true"
      className="argonaut-mark"
    >
      <path
        d="M44 17.5A22 22 0 1 0 53.3 30.5"
        className="mark-gold"
        strokeWidth={3.24}
      />
      <g className="mark-blue" strokeWidth={1.55}>
        <path d="M40.7 21.8A16 16 0 1 0 47.5 31.3" />
        <path d="M37.6 25.9A11.2 11.2 0 1 0 42.4 32" />
      </g>
    </svg>
  );
}
