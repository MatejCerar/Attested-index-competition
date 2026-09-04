import {AppShell, Container} from "@mantine/core";
import {Outlet} from "@tanstack/react-router";
import {Header} from "@/components/layout/header.tsx";

export function RootLayout() {
  return (
    <AppShell
      header={{height: 56}}
      withBorder={false}
      bg="light-dark(var(--mantine-color-neutrals-gray-50), #1a1a1a)"
    >
      <AppShell.Header bg="var(--mantine-color-neutrals-fills-white)">
        <Header />
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl" py="xl">
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
