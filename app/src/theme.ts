import { createTheme } from "@mantine/core";

export const theme = createTheme({
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
