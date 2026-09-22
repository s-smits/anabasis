export function AnabasisMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      aria-hidden="true"
      className={className}
    >
      <path d="M3 21 H9 V15 H15 V9 H21 V3 H13" />
    </svg>
  );
}

export function AnabasisWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 114 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      aria-hidden="true"
      className={className}
    >
      <path d="M1 17 V1 H11 V17 M1 10 H11" />
      <path transform="translate(15 0)" d="M1 17 V1 M11 1 V17 M1 1 H3 V4 H5 V8 H7 V12 H9 V15 H11 V17" />
      <path transform="translate(30 0)" d="M1 17 V1 H11 V17 M1 10 H11" />
      <path transform="translate(45 0)" d="M11 1 H1 V17 H11 V7 H1 M11 1 V7" />
      <path transform="translate(60 0)" d="M1 17 V1 H11 V17 M1 10 H11" />
      <path transform="translate(75 0)" d="M11 1 H4 V4 H1 V9 H11 V14 H8 V17 H1" />
      <path transform="translate(88 0)" d="M3 1 H9 M6 1 V17 M3 17 H9" />
      <path transform="translate(101 0)" d="M11 1 H4 V4 H1 V9 H11 V14 H8 V17 H1" />
    </svg>
  );
}
