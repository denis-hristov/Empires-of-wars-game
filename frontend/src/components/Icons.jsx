const paths = {
  shop: "M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M9 21v-6h6v6",
  potion: "M9 3h6M10 3v6L5 17a3 3 0 0 0 3 4h8a3 3 0 0 0 3-4l-5-8V3M8 14h8",
  time: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  check: "m5 12 4 4L19 6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6m0-10v1",
  upgrade: "m4 20 8-8m-5-7 4-3 10 10-3 4-4-1-5-5Zm5 7 3 3",
  collect: "M4 10h16l-2 11H6ZM8 10l4-7 4 7M9 14v3m6-3v3",
  move: "M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4",
  clear: "m4 20 8-8m-3-8 3-2 9 9-2 3-4-1-6-6Z",
  dismiss: "M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 10v-3c0-5 12-5 12 0v3m2-11h5",

  food: "M12 21V3m0 7C5 10 5 5 5 5c7 0 7 5 7 5Zm0 6c7 0 7-5 7-5-7 0-7 5-7 5Z",
  wood: "m5 17 11-11m-8 15 13-13M3 14l7 7 11-11-7-7Z",
  stone: "m3 17 3-9 9-4 6 10-5 7-10-1ZM6 8l7 5 8 1m-8-1 3 8",
  iron: "m4 9 8-6 8 6-3 11H7Zm0 0h16M8 9l4-6 4 6-4 11Z",
  coins:
    "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 7v10m3-8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9",
  build: "m3 11 9-8 9 8M6 10v11h12V10M10 21v-7h4v7",
  army: "m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Zm-4 8 3 3 5-6",
  research: "M4 5h7v15H4Zm9 0h7v15h-7ZM4 8h7m2 0h7",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  save: "M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c-5 5-5 13 0 18 5-5 5-13 0-18",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  people:
    "M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9v-3c0-5 12-5 12 0v3m1-14c5 0 5 6 0 6m2 2c3 0 3 3 3 6",
  pause: "M8 5v14M16 5v14",
  play: "m8 4 12 8-12 8Z",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 2v6m0 8v6M2 12h6m8 0h6",
};
export function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.globe} />
    </svg>
  );
}
