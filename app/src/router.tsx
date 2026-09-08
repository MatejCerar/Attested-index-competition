import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {RootLayout} from "@/components/layout/root-layout.tsx";
import {BuildPage} from "@/routes/build.tsx";
import {LeaderboardPage} from "@/routes/leaderboard.tsx";
import {LivePage} from "@/routes/live.tsx";
import {PortfolioPage} from "@/routes/portfolio.tsx";

const rootRoute = createRootRoute({component: RootLayout});

const buildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BuildPage,
});

const leaderboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leaderboard",
  component: LeaderboardPage,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: LivePage,
});

const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portfolio",
  component: PortfolioPage,
});

const routeTree = rootRoute.addChildren([
  buildRoute,
  leaderboardRoute,
  liveRoute,
  portfolioRoute,
]);

export const router = createRouter({routeTree, defaultPreload: "intent"});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
