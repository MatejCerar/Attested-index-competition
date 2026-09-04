import {
  localStorageColorSchemeManager,
  MantineProvider,
} from "@mantine/core";
import {Notifications} from "@mantine/notifications";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {RouterProvider} from "@tanstack/react-router";
import {WalletProvider} from "@/core/wallet-context.tsx";
import {router} from "@/router.tsx";
import {theme} from "@/theme.ts";

const queryClient = new QueryClient();
const colorSchemeManager = localStorageColorSchemeManager({
  key: "index-competition-theme",
});

export const App = () => {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="dark"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <RouterProvider router={router} />
        </WalletProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
};
