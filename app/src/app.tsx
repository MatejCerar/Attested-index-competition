import {
  localStorageColorSchemeManager,
  MantineProvider,
} from "@mantine/core";
import {Notifications} from "@mantine/notifications";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {RouterProvider} from "@tanstack/react-router";
import {BasketProvider} from "@/core/basket-context.tsx";
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
          <BasketProvider>
            <RouterProvider router={router} />
          </BasketProvider>
        </WalletProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
};
