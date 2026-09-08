import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {Link} from "@tanstack/react-router";
import {useEffect, useState} from "react";
import {getCostBasis} from "@/core/cost-basis.ts";
import {readVaultPosition, type VaultPosition} from "@/core/evm-seam.ts";
import {useLive} from "@/core/use-data.ts";
import {useOnchain} from "@/core/use-onchain.ts";
import {useWallet} from "@/core/wallet-context.tsx";

const usd = (x?: number | null) =>
  x == null ? "-" : `$${x.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

export function PortfolioPage() {
  const {data: live} = useLive();
  const {data: onchain} = useOnchain();
  const {connected, mode, provider, address} = useWallet();
  const realWallet = connected && mode === "injected" && provider != null;

  const indices = live?.indices ?? [];
  const vaultOf = (id: string, fallback?: string | null) =>
    onchain?.vaults[id]?.addr ?? fallback ?? null;

  const [positions, setPositions] = useState<Record<string, VaultPosition>>({});
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const ids = indices.map((b) => b.id).join(",");
  useEffect(() => {
    if (!realWallet) {
      setPositions({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    const targets = (live?.indices ?? [])
      .map((b) => ({id: b.id, vault: vaultOf(b.id, b.vault)}))
      .filter((t) => t.vault);
    Promise.all(
      targets.map(async (t) => {
        const pos = await readVaultPosition({
          provider,
          vault: t.vault!,
          address,
          mode,
        });
        return [t.id, pos] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        const out: Record<string, VaultPosition> = {};
        for (const [id, pos] of entries)
          if (pos && pos.shares > 0n) out[id] = pos;
        setPositions(out);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realWallet, address, mode, ids, nonce]);

  if (!realWallet)
    return (
      <Alert color="yellow" title="Connect a wallet">
        Connect an injected wallet on Coston2 to see your positions. Mint test USD
        and Invest into an index on the{" "}
        <Text component={Link} to="/live" inherit c="blue">
          Live
        </Text>{" "}
        page first.
      </Alert>
    );

  const held = indices.filter((b) => positions[b.id]);
  const totalValue = held.reduce((a, b) => a + positions[b.id].valueUsd, 0);
  const totalCost = held.reduce(
    (a, b) => a + getCostBasis(vaultOf(b.id, b.vault) ?? ""),
    0
  );
  const totalPnl = totalCost > 0 ? totalValue / totalCost - 1 : 0;
  const myIndices = indices.filter((b) => b.owner === "you" || b.mine);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1}>My positions</Title>
          <Text c="dimmed">
            Your live on-chain stake in each index: what it is worth now and your
            profit/loss versus what you invested.
          </Text>
        </div>
        <Button variant="light" loading={loading} onClick={() => setNonce((n) => n + 1)}>
          Refresh
        </Button>
      </Group>

      <Group gap="xl">
        <Meta label="Positions">{held.length}</Meta>
        <Meta label="Total value">{usd(totalValue)}</Meta>
        <Meta label="Invested">{totalCost > 0 ? usd(totalCost) : "-"}</Meta>
        <Meta label="P&L">
          <Text component="span" c={totalPnl >= 0 ? "green" : "red"} fw={700}>
            {totalCost > 0 ? pct(totalPnl) : "-"}
          </Text>
        </Meta>
      </Group>

      {held.length === 0 ? (
        <Alert color="gray" variant="light">
          You have no positions yet. Go to{" "}
          <Text component={Link} to="/live" inherit c="blue">
            Live
          </Text>
          , Mint test USD, then Invest into an index - it will show up here.
        </Alert>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Index</Table.Th>
                <Table.Th style={{textAlign: "right"}}>Invested</Table.Th>
                <Table.Th style={{textAlign: "right"}}>Value now</Table.Th>
                <Table.Th style={{textAlign: "right"}}>P&L</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {held.map((b) => {
                const pos = positions[b.id];
                const vault = vaultOf(b.id, b.vault) ?? "";
                const cost = getCostBasis(vault);
                const pnl = cost > 0 ? pos.valueUsd / cost - 1 : (b.ret ?? 0);
                return (
                  <Table.Tr key={b.id}>
                    <Table.Td>
                      <Group gap={6}>
                        <Text fw={600}>{b.name}</Text>
                        {(b.owner === "you" || b.mine) && (
                          <Badge size="xs" color="teal" variant="filled">
                            Yours
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td style={{textAlign: "right"}}>
                      {cost > 0 ? usd(cost) : "-"}
                    </Table.Td>
                    <Table.Td style={{textAlign: "right"}}>
                      {usd(pos.valueUsd)}
                    </Table.Td>
                    <Table.Td style={{textAlign: "right"}}>
                      <Text c={pnl >= 0 ? "green" : "red"} fw={700}>
                        {pct(pnl)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {myIndices.length > 0 && (
        <Card withBorder radius="md">
          <Text fw={600} mb="xs">
            Indices you created ({myIndices.length})
          </Text>
          <Stack gap={6}>
            {myIndices.map((b) => (
              <Group key={b.id} justify="space-between">
                <Text>{b.name}</Text>
                <Group gap="lg">
                  <Text size="sm" c="dimmed">
                    NAV {b.nav != null ? usd(b.nav) : "-"}
                  </Text>
                  <Text size="sm" c={(b.ret ?? 0) >= 0 ? "green" : "red"} fw={600}>
                    {b.ret != null ? pct(b.ret) : "-"}
                  </Text>
                </Group>
              </Group>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="xs">
            Return since the index started (share NAV), independent of your own
            deposits.
          </Text>
        </Card>
      )}

      {loading && held.length === 0 && <Loader size="sm" />}
    </Stack>
  );
}

function Meta({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text>{children}</Text>
    </div>
  );
}
