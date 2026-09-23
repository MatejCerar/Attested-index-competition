import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Strict 3-color palette: gray (Mantine default) for everything neutral,
// flare pink for brand, muted up/down greens and reds for returns only.
const flare: MantineColorsTuple = [
  "#ffe9ef",
  "#ffd3de",
  "#f9a7bb",
  "#f37897",
  "#ee5078",
  "#eb3765",
  "#e62058",
  "#cd134b",
  "#b80a42",
  "#a20038"
];

const up: MantineColorsTuple = [
  "#eaf3ed",
  "#dbe8df",
  "#b8d0c0",
  "#92b89f",
  "#72a383",
  "#578c67",
  "#3d7a4f",
  "#326a43",
  "#285c39",
  "#1b4d2d"
];

const down: MantineColorsTuple = [
  "#faeeed",
  "#f2dcda",
  "#e5b8b4",
  "#d8938c",
  "#cd746c",
  "#c65f56",
  "#b0504a",
  "#9c443e",
  "#8c3b35",
  "#7c312c"
];

export const theme = createTheme({
  colors: {flare, up, down},
  primaryColor: "flare",
  primaryShade: 6,
  fontFamily: "Satoshi-Variable, sans-serif",
  headings: {
    fontFamily: "Satoshi-Variable, sans-serif",
    sizes: {
      h1: {
        fontSize: "var(--sizes-headings-h1)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h1)"
      },
      h2: {
        fontSize: "var(--sizes-headings-h2)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h2)"
      },
      h3: {
        fontSize: "var(--sizes-headings-h3)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h3)"
      },
      h4: {
        fontSize: "var(--sizes-headings-h4)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h4)"
      },
      h5: {
        fontSize: "var(--sizes-headings-h5)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h5)"
      },
      h6: {
        fontSize: "var(--sizes-headings-h6)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h6)"
      },
      // eslint-disable-next-line ts/ban-ts-comment
      // @ts-expect-error
      h7: {
        fontSize: "var(--sizes-headings-h7)",
        fontWeight: "500",
        lineHeight: "var(--line-height-h7)"
      }
    }
  },
  fontSizes: {
    lBody: "var(--sizes-body-l-body)",
    sBody: "var(--sizes-body-s-body)",
    body: "var(--sizes-body-body)",
    note: "var(--sizes-body-note)",
    xlLabel: "var(--sizes-label-xl-label)",
    lLabel: "var(--sizes-label-l-label)",
    label: "var(--sizes-label-label)",
    sLabel: "var(--sizes-label-s-label)",
    lLink: "var(--sizes-link-l-link)",
    bodyLink: "var(--sizes-link-body-link)",
    smallBodyLink: "var(--sizes-link-small-body-link)",
    noteTextLink: "var(--sizes-link-note-text-link)"
  },
  spacing: {
    n: "var(--sizes-n)",
    none: "var(--sizes-none)",
    "2n": "var(--sizes-2n)",
    "3n": "var(--sizes-3n)",
    xs: "var(--sizes-xs)",
    md: "var(--sizes-md)",
    lg: "var(--sizes-lg)",
    xl: "var(--sizes-xl)",
    xxl: "var(--sizes-xxl)",
    sm: "var(--sizes-sm)",
    xl2: "var(--sizes-xl2)"
  },
  radius: {
    n: "var(--sizes-n)",
    none: "var(--sizes-none)",
    "2n": "var(--sizes-2n)",
    "3n": "var(--sizes-3n)",
    xs: "var(--sizes-xs)",
    md: "var(--sizes-md)",
    lg: "var(--sizes-lg)",
    xl: "var(--sizes-xl)",
    xxl: "var(--sizes-xxl)",
    sm: "var(--sizes-sm)",
    xl2: "var(--sizes-xl2)"
  },

  lineHeights: {
    h1: "var(--line-height-h1)",
    h6: "var(--line-height-h6)",
    h5: "var(--line-height-h5)",
    h7: "var(--line-height-h7)",
    h3: "var(--line-height-h3)",
    h2: "var(--line-height-h2)",
    h4: "var(--line-height-h4)",
    note: "var(--line-height-note)",
    body: "var(--line-height-body)",
    sBody: "var(--line-height-s-body)",
    lBody: "var(--line-height-l-body)",
    sLabel: "var(--line-height-s-label)",
    lLabel: "var(--line-height-l-label)",
    label: "var(--line-height-label)",
    xlLabel: "var(--line-height-xl-label)",
    noteTextLink: "var(--line-height-note-text-link)",
    bodyLink: "var(--line-height-body-link)",
    smallBodyLink: "var(--line-height-small-body-link)",
    largeLink: "var(--line-height-large-link)"
  },

  breakpoints: {
    xl: "94.5em",
  },

  other: {}
});
