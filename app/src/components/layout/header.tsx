import {Badge, Button, Group, Text} from "@mantine/core";
import {Link, useRouterState} from "@tanstack/react-router";
import {useState} from "react";
import {ConnectWalletModal} from "@/components/connect-wallet-modal.tsx";
import {FlareLogo} from "@/components/flare-logo.tsx";
import {useWallet} from "@/core/wallet-context.tsx";

const NAV = [
  {to: "/", label: "Build"},
  {to: "/leaderboard", label: "Leaderboard"},
  {to: "/live", label: "Live"},
  {to: "/portfolio", label: "My positions"},
];

export function Header() {
  const [modalOpen, setModalOpen] = useState(false);
  const {connected, address, mode, disconnect} = useWallet();
  const path = useRouterState({select: (s) => s.location.pathname});

  return (
    <Group justify="space-between" h="100%" wrap="nowrap" px="md">
      <Group gap="sm" wrap="nowrap">
        <FlareLogo size={54} color="var(--mantine-color-neutrals-fills-dark)" />
        <Text fw={600} visibleFrom="xs">
          Index Competition
        </Text>
      </Group>

      <Group gap="lg" visibleFrom="sm">
        {NAV.map((n) => {
          const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
          return (
            <Text
              key={n.to}
              component={Link}
              to={n.to}
              fw={active ? 600 : 400}
              c={active ? undefined : "dimmed"}
              style={{textDecoration: "none"}}
            >
              {n.label}
            </Text>
          );
        })}
      </Group>

      {connected ? (
        <Group gap="xs" wrap="nowrap">
          <Badge color={mode === "injected" ? "green" : "gray"} variant="light">
            {mode === "injected" ? "Coston2" : "demo"}
          </Badge>
          <Button variant="default" size="sm" onClick={disconnect}>
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Disconnect"}
          </Button>
        </Group>
      ) : (
        <Button size="sm" onClick={() => setModalOpen(true)}>
          Connect wallet
        </Button>
      )}

      <ConnectWalletModal opened={modalOpen} onClose={() => setModalOpen(false)} />
    </Group>
  );
}
