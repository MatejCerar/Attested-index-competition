import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Text,
  Title,
  Anchor,
} from "@mantine/core";
import {Link} from "@tanstack/react-router";
import {useEffect, useRef} from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {useLive} from "@/core/use-data.ts";
import type {LiveData, LiveIndex} from "@/core/types.ts";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${x.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
const EXP = "https://coston2-explorer.flare.network";
const short = (h?: string | null) => (h ? `${h.slice(0, 10)}...` : "");
const isZero = (h?: string | null) => !h || /^0x0+$/.test(h);
// Distinct line colours, one per index by rank order.
const LINE_COLORS = ["#e62058", "#f5a623", "#22b8cf", "#7048e8", "#20c997", "#adb5bd"];

export function LivePage() {
  const {data, isLoading, error} = useLive();

  if (isLoading) return <Loader />;
  if (error || !data)
    return (
      <Alert color="yellow">
        No live data yet. Run <code>npm run compete</code> (or{" "}
        <code>node scripts/live-engine.mjs</code>), which writes
        <code> app/public/data/live.json</code> every tick; the board refreshes
        every 5s.
      </Alert>
    );

  const exec = data.indices.filter((b) => !b.notExecutable);
  const nExec = exec.length;
  const continuous = data.continuous || data.durationSec === 0;
  const progress = continuous
    ? 100
    : Math.min(100, (100 * data.elapsedSec) / (data.durationSec || 1));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="xs">
            <Title order={1}>Live competition</Title>
            <Badge color={data.finished ? "yellow" : "green"} variant="light">
              {data.finished ? "FINAL" : "LIVE"}
            </Badge>
            {data.source === "onchain" && (
              <Badge color="grape" variant="light">
                on-chain
              </Badge>
            )}
            {data.sample && (
              <Badge color="gray" variant="light">
                sample
              </Badge>
            )}
          </Group>
          <Text c="dimmed">
            The 5 house indices racing on real prices, each rebalancing on its
            own strategy from equal starting capital, updated every tick. Full
            standings and the indices you submit are on{" "}
            <Anchor component={Link} to="/leaderboard">
              Leaderboard
            </Anchor>
            .
          </Text>
        </div>
      </Group>

      {!continuous && <Progress value={progress} color="green" />}

      <Group gap="xl">
        <Meta label="Elapsed">
          {Math.floor(data.elapsedSec / 60)}m {data.elapsedSec % 60}s
          {continuous ? " (continuous)" : ` / ${Math.round(data.durationSec / 60)}m`}
        </Meta>
        <Meta label="Capital each">{usd(data.capital)}</Meta>
        <Meta label="Tick">{data.intervalSec}s</Meta>
        <Meta label="Executable">
          {nExec}/{data.indices.length}
        </Meta>
        <Meta label="Source">{data.sourceLabel ?? data.source}</Meta>
      </Group>

      <NavChart data={data} />

      <Table.ScrollContainer minWidth={860}>
        <Table verticalSpacing="md" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Index</Table.Th>
              <Table.Th>Holdings (live change)</Table.Th>
              <Table.Th>Last rebalance</Table.Th>
              <Table.Th style={{textAlign: "right"}}>NAV</Table.Th>
              <Table.Th style={{textAlign: "right"}}>Return</Table.Th>
              <Table.Th style={{textAlign: "right"}}>Rebal</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.indices.map((b) => (
              <LiveRow key={b.id} b={b} source={data.source} />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

// Per-index return-since-t0 lines over time (recharts). Merges each index's NAV
// series into one time-indexed dataset keyed by index id.
function NavChart({data}: {data: LiveData}) {
  const series = data.indices.filter((b) => b.series && b.series.length > 1);
  if (!series.length)
    return (
      <Card withBorder radius="md">
        <Text size="sm" c="dimmed">
          Charting NAV over time. Lines appear after the first few ticks.
        </Text>
      </Card>
    );

  // Union of timestamps -> rows {t, [id]: retPct}.
  const times = new Set<number>();
  for (const b of series) for (const p of b.series!) times.add(p.t);
  const sorted = [...times].sort((a, b) => a - b);
  const byIdx = new Map(series.map((b) => [b.id, new Map(b.series!.map((p) => [p.t, p.ret]))]));
  const rows = sorted.map((t) => {
    const row: Record<string, number | string> = {
      t: new Date(t).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
    for (const b of series) {
      const v = byIdx.get(b.id)!.get(t);
      if (v != null) row[b.id] = Number((v * 100).toFixed(3));
    }
    return row;
  });

  return (
    <Card withBorder radius="md">
      <Text fw={600} mb="xs">
        Return since start (%)
      </Text>
      <div style={{width: "100%", height: 300}}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{top: 8, right: 16, bottom: 0, left: -8}}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="t" tick={{fontSize: 11}} minTickGap={40} />
            <YAxis tick={{fontSize: 11}} unit="%" width={48} />
            <Tooltip
              contentStyle={{fontSize: 12}}
              formatter={(value, name) => {
                const v = Number(value);
                return [`${v >= 0 ? "+" : ""}${v}%`, String(name)];
              }}
            />
            {series.map((b, i) => (
              <Line
                key={b.id}
                type="monotone"
                dataKey={b.id}
                name={b.name}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Group gap="md" mt="xs">
        {series.map((b, i) => (
          <Group key={b.id} gap={4}>
            <div style={{width: 12, height: 3, background: LINE_COLORS[i % LINE_COLORS.length]}} />
            <Text size="note" c="dimmed">
              {b.name}
            </Text>
          </Group>
        ))}
      </Group>
    </Card>
  );
}

function Meta({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div>
      <Text size="note" c="dimmed">
        {label}
      </Text>
      <Text size="sBody">{children}</Text>
    </div>
  );
}

function LiveRow({b, source}: {b: LiveIndex; source: string}) {
  // Track rank movement between refreshes for an up/down arrow.
  const prevRank = useRef<number | undefined>(b.rank);
  const move = b.rank != null && prevRank.current != null ? prevRank.current - b.rank : 0;
  useEffect(() => {
    prevRank.current = b.rank;
  }, [b.rank]);

  if (b.notExecutable) {
    return (
      <Table.Tr opacity={0.5}>
        <Table.Td>-</Table.Td>
        <Table.Td>
          <Text fw={600}>{b.name}</Text>
          <Text size="note" c="dimmed">
            "{b.prompt}"
          </Text>
        </Table.Td>
        <Table.Td colSpan={5}>
          <Text size="note" fs="italic" c="dimmed">
            not listed on {source} - excluded
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  }
  const mine = b.owner === "you" || b.mine === true;
  return (
    <Table.Tr style={mine ? {background: "var(--mantine-color-teal-light)"} : undefined}>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Text fw={700} size="lg">
            {b.rank}
          </Text>
          {move > 0 && (
            <Text component="span" c="green" size="sm">
              &#9650;
            </Text>
          )}
          {move < 0 && (
            <Text component="span" c="red" size="sm">
              &#9660;
            </Text>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={6}>
          <Text fw={600}>{b.name}</Text>
          {mine && (
            <Badge size="xs" variant="filled" color="teal">
              Yours
            </Badge>
          )}
          <Badge size="xs" variant="light" color="grape">
            RWA
          </Badge>
          {b.strategyName && (
            <Badge size="xs" variant="outline" color="gray">
              {b.strategyName}
            </Badge>
          )}
          {b.coverage < 1 && (
            <Badge size="xs" variant="light" color="yellow">
              {Math.round(b.coverage * 100)}% on venue
            </Badge>
          )}
        </Group>
        <Text size="note" c="dimmed" maw={320}>
          "{b.prompt}"
        </Text>
        {!isZero(b.rebalanceTx) && (
          <Group gap={8} mt={4}>
            <Anchor size="note" href={`${EXP}/tx/${b.rebalanceTx}`} target="_blank">
              tx {short(b.rebalanceTx)}
              {b.txSample ? " (sample)" : ""}
            </Anchor>
            {b.vault && (
              <Anchor size="note" href={`${EXP}/address/${b.vault}`} target="_blank">
                vault {short(b.vault)}
              </Anchor>
            )}
          </Group>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {b.legs.map((l) => (
            <Badge
              key={l.sym}
              variant="light"
              color="gray"
              style={l.dead ? {textDecoration: "line-through", opacity: 0.4} : undefined}
            >
              {l.sym} {l.weight}%
              {!l.dead && l.chg != null && (
                <Text component="span" c={l.chg >= 0 ? "green" : "red"} ml={4}>
                  {pct(l.chg)}
                </Text>
              )}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="note" c="dimmed" maw={220}>
          {b.lastReason ?? "-"}
        </Text>
      </Table.Td>
      <Table.Td style={{textAlign: "right"}}>{b.nav != null ? usd(b.nav) : "-"}</Table.Td>
      <Table.Td style={{textAlign: "right"}}>
        <Text fw={700} c={(b.ret ?? 0) >= 0 ? "green" : "red"}>
          {b.ret != null ? pct(b.ret) : "-"}
        </Text>
      </Table.Td>
      <Table.Td style={{textAlign: "right"}}>{b.rebalances ?? 0}</Table.Td>
    </Table.Tr>
  );
}
