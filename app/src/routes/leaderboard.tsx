import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {Link} from "@tanstack/react-router";
import {useLeaderboard} from "@/core/use-data.ts";
import type {LeaderboardIndex} from "@/core/types.ts";

const EXP = "https://coston2-explorer.flare.network";
// A real, tee-signed StableIndexVault.rebalance() on Coston2 (the mag-7-rwa
// vault, tx succeeded), shown as a reference so the explorer link always
// resolves. Live on-chain runs (PK + TEE_SIGN_URL) replace this per row.
const SAMPLE_TX =
  "0xead0b309340590881850254da16f2c584e5553b325cf3562c5961b744300cba9";
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const usd = (x: number) =>
  `$${x.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
const short = (h?: string) => (h ? `${h.slice(0, 10)}...` : "");
const isZero = (h?: string) => !h || /^0x0+$/.test(h);

export function LeaderboardPage() {
  const {data, isLoading, error} = useLeaderboard();

  if (isLoading) return <Loader />;
  if (error || !data)
    return <Alert color="red">Could not load leaderboard data.</Alert>;

  const rows = [...data.indices].sort((a, b) => a.rank - b.rank);

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Leaderboard</Title>
        <Text c="dimmed">
          The standings. Every index, including ones you submit from Build, is
          scored by the rebalancer and ranked by return. Watch the house field
          race in real time on{" "}
          <Anchor component={Link} to="/live">
            Live
          </Anchor>
          .
        </Text>
      </div>

      <Card withBorder radius="md">
        <Group justify="space-between">
          <div>
            <Text size="note" c="dimmed">
              Platform fees this run ({data.feeBps / 100}% per deposit)
            </Text>
            <Text fw={800} size="xl" c="green">
              {usd(data.platformRevenueUsd)} mUSDC
            </Text>
          </div>
          <Stack gap={2} align="flex-end">
            <Text size="note" c="dimmed">
              {data.network}
            </Text>
            <Text size="note" c="dimmed">
              {data.attestedBy}
            </Text>
            <Anchor size="note" href={`${EXP}/tx/${SAMPLE_TX}`} target="_blank">
              example on-chain rebalance tx
            </Anchor>
            {data.sample && (
              <Badge color="yellow" variant="light">
                sample data
              </Badge>
            )}
          </Stack>
        </Group>
      </Card>

      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="md" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Index / recipe</Table.Th>
              <Table.Th>Weights</Table.Th>
              <Table.Th>Strategy</Table.Th>
              <Table.Th style={{textAlign: "right"}}>NAV</Table.Th>
              <Table.Th style={{textAlign: "right"}}>7d (sim)</Table.Th>
              <Table.Th>Last rebalance</Table.Th>
              <Table.Th>On-chain</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((idx) => (
              <Row key={idx.id} idx={idx} />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Text size="note" c="dimmed">
        Deposits, fees and rebalances are real on Coston2 when run live: each
        vault is moved by a rebalance the FCC tee-node signed. Prices are live
        market data (metal futures and tokenized-equity underlyings); on-chain,
        the keeper pushes each price into a per-asset Uniswap V3 pool the vault
        reads to rebalance. Only the multi-day P&L path is simulated.
      </Text>
    </Stack>
  );
}

function Row({idx}: {idx: LeaderboardIndex}) {
  const nav = idx.positions.reduce((a, p) => a + p.units * p.basePx, 0);
  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={700} size="lg">
          {idx.rank}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={6}>
          <Text fw={600}>{idx.name}</Text>
          {idx.owner === "you" && (
            <Badge size="xs" variant="filled" color="teal">
              Yours
            </Badge>
          )}
        </Group>
        <Text size="note" c="dimmed" maw={280}>
          "{idx.prompt}"
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {idx.positions.map((p) => (
            <Badge key={p.sym} variant="light" color="gray">
              {p.sym} {p.weight}%
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color="blue">
          {idx.strategyName ?? idx.strategy}
        </Badge>
      </Table.Td>
      <Table.Td style={{textAlign: "right"}}>{usd(nav)}</Table.Td>
      <Table.Td style={{textAlign: "right"}}>
        <Text fw={700} c={idx.weekReturn >= 0 ? "green" : "red"}>
          {pct(idx.weekReturn)}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="note" c="dimmed">
          {idx.rebalanceReason ?? "-"}
        </Text>
      </Table.Td>
      <Table.Td>
        {isZero(idx.rebalanceTx) ? (
          <Text size="note" c="dimmed">
            no tx (sample)
          </Text>
        ) : (
          <Stack gap={2}>
            <Anchor size="note" href={`${EXP}/tx/${idx.rebalanceTx}`} target="_blank">
              {short(idx.rebalanceTx)}
              {idx.txSample ? " (sample)" : ""}
            </Anchor>
            <Anchor size="note" href={`${EXP}/address/${idx.vault}`} target="_blank">
              vault {short(idx.vault)}
            </Anchor>
          </Stack>
        )}
      </Table.Td>
    </Table.Tr>
  );
}
