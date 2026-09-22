import {
  Alert,
  Badge,
  Button,
  Card,
  CloseButton,
  Divider,
  Grid,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {useDebouncedValue} from "@mantine/hooks";
import {notifications} from "@mantine/notifications";
import {useQueryClient} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {useMemo, useState} from "react";
import {addBasket} from "@/core/add.ts";
import {useBasket} from "@/core/basket-context.tsx";
import {weightsToUnits} from "@/core/index-config.ts";
import {
  DEFAULT_STRATEGY,
  STRATEGY_GROUP_LABELS,
  STRATEGY_TEMPLATES,
  strategyName,
  type StrategyGroup,
} from "@/core/strategies.ts";
import type {CatalogAsset, UserBasket} from "@/core/types.ts";
import {useCatalog} from "@/core/use-data.ts";

// Cap on rendered rows so the ~1,300-asset table stays snappy. Never silent:
// the "showing N of M" line always says when the list is truncated.
const MAX_ROWS = 200;

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "index";
const titleCase = (s: string) =>
  s.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
const usd = (x: number | null | undefined) =>
  x == null ? "-" : `$${x.toLocaleString(undefined, {maximumFractionDigits: 2})}`;

const STRATEGY_SELECT_DATA = (["intervals", "harnesses", "combined"] as StrategyGroup[]).map(
  (g) => ({
    group: STRATEGY_GROUP_LABELS[g],
    items: STRATEGY_TEMPLATES.filter((s) => s.group === g).map((s) => ({
      value: s.id,
      label: s.name,
    })),
  })
);

export function UniversePage() {
  const {data: catalog, isLoading} = useCatalog();
  const basket = useBasket();

  const [query, setQuery] = useState("");
  const [debounced] = useDebouncedValue(query, 200);
  const [assetClass, setAssetClass] = useState<string | null>(null);

  // The selectable universe: priceable catalog assets only (the same set the
  // rebalancer can score), sorted by 24h volume so the cap keeps the most
  // liquid names on top.
  const universe = useMemo<CatalogAsset[]>(() => {
    if (!catalog) return [];
    return catalog.assets
      .filter((a) => a.priceSource)
      .sort((a, b) => (b.vol24 ?? 0) - (a.vol24 ?? 0));
  }, [catalog]);

  const classOptions = useMemo(() => {
    const set = new Set(universe.map((a) => a.assetClass));
    return [...set].sort().map((c) => ({value: c, label: titleCase(c)}));
  }, [universe]);

  const matches = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return universe.filter((a) => {
      if (assetClass && a.assetClass !== assetClass) return false;
      if (!q) return true;
      return (
        a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
      );
    });
  }, [universe, debounced, assetClass]);

  const shown = matches.slice(0, MAX_ROWS);

  if (isLoading || !catalog) return <Loader />;

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Universe</Title>
        <Text c="dimmed">
          Every priceable instrument in the RWA catalog. Search by ticker or
          name, filter by asset class, and add names to your basket to build an
          index by hand. The config and prompt builders live on{" "}
          <Text component={Link} to="/" span c="inherit" td="underline">
            Build
          </Text>
          .
        </Text>
      </div>

      <Grid gutter="lg">
        <Grid.Col span={{base: 12, md: 8}}>
          <Card withBorder radius="md">
            <Group mb="xs" align="flex-end">
              <TextInput
                flex={1}
                label="Search"
                placeholder="Ticker or name, e.g. NVDA or gold"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              <Select
                label="Asset class"
                placeholder="All classes"
                data={classOptions}
                value={assetClass}
                onChange={setAssetClass}
                clearable
                searchable
                w={230}
              />
            </Group>
            <Text size="note" c="dimmed" mb="xs">
              Showing {shown.length} of {matches.length} matching assets
              ({universe.length} in the universe)
              {matches.length > MAX_ROWS
                ? ", top by 24h volume - refine the search to see the rest"
                : ""}
              .
            </Text>

            <Table.ScrollContainer minWidth={640}>
              <Table highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Ticker</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Issuer</Table.Th>
                    <Table.Th>Class</Table.Th>
                    <Table.Th style={{textAlign: "right"}}>Price</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((a) => {
                    const inBasket = basket.has(a.id);
                    return (
                      <Table.Tr key={a.id}>
                        <Table.Td>
                          <Text fw={600} size="sm">
                            {a.ticker}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" truncate maw={220}>
                            {a.name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {a.issuerName}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color="grape">
                            {titleCase(a.assetClass)}
                          </Badge>
                        </Table.Td>
                        <Table.Td
                          style={{textAlign: "right", fontVariantNumeric: "tabular-nums"}}
                        >
                          {usd(a.priceUsd)}
                        </Table.Td>
                        <Table.Td style={{textAlign: "right"}}>
                          {inBasket ? (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              onClick={() => basket.remove(a.id)}
                            >
                              Remove
                            </Button>
                          ) : (
                            <Button
                              size="compact-xs"
                              variant="light"
                              onClick={() => basket.add(a.id)}
                            >
                              Add
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {shown.length === 0 && (
              <Text size="note" c="dimmed" py="md" ta="center">
                No assets match. Try a different search or clear the class
                filter.
              </Text>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{base: 12, md: 4}}>
          <BasketPanel universe={universe} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

// The manual builder: chosen assets with editable weights, equal-weight, live
// sum, name + strategy, and submit through the same addBasket path the config
// and prompt builders use.
function BasketPanel({universe}: {universe: CatalogAsset[]}) {
  const basket = useBasket();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [strategy, setStrategy] = useState<string>(DEFAULT_STRATEGY);
  const [submitting, setSubmitting] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const byId = useMemo(() => new Map(universe.map((a) => [a.id, a])), [universe]);
  const sum = basket.items.reduce((a, i) => a + i.pct, 0);
  const active = basket.items.filter((i) => i.pct > 0);
  const canSubmit = active.length > 0 && name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    // Normalize the typed weights to clean integer percentages summing to 100
    // (same largest-remainder split the config builder uses).
    const pcts = weightsToUnits(active.map((i) => i.id), active.map((i) => i.pct), 100);
    const weights: Record<string, number> = {};
    active.forEach((it, k) => {
      if (pcts[k] > 0) weights[it.id] = pcts[k];
    });
    const b: UserBasket = {
      id: slug(name),
      name: name.trim(),
      prompt: thesis.trim() || name.trim(),
      kind: "rwa",
      strategy,
      weights,
    };

    setSubmitting(true);
    try {
      // Same rule as Build: only a successful server response counts as added.
      // If the competition server is unreachable, fail loudly, add nothing.
      const added = await addBasket(b);
      if (!added.ok) {
        notifications.show({
          color: "red",
          title: "Not added to the competition",
          message:
            "Could not reach the competition server - is `npm run compete` running? " +
            `Your index was not submitted (${added.error}). Nothing was added.`,
          autoClose: false,
        });
        return;
      }
      await queryClient.invalidateQueries({queryKey: ["leaderboard"]});
      notifications.show({
        color: "green",
        title: "Added to the competition",
        message:
          `"${b.name}" is in the competition (${added.mode}). ` +
          `It joins Live and the leaderboard on the next engine tick.`,
      });
      setLastAdded(b.name);
      basket.clear();
      setName("");
      setThesis("");
      setStrategy(DEFAULT_STRATEGY);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card withBorder radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Your basket ({basket.items.length})</Text>
        {basket.items.length > 0 && (
          <Button size="compact-xs" variant="subtle" color="red" onClick={basket.clear}>
            clear
          </Button>
        )}
      </Group>

      {basket.items.length === 0 ? (
        <Text size="note" c="dimmed" mb="sm">
          Nothing picked yet. Add assets from the table - each row's Add button
          puts it here with an editable weight.
        </Text>
      ) : (
        <Stack gap={6} mb="sm" mah="40vh" style={{overflowY: "auto"}}>
          {basket.items.map((it) => {
            const a = byId.get(it.id);
            return (
              <Group key={it.id} gap={6} wrap="nowrap" justify="space-between">
                <div style={{minWidth: 0}}>
                  <Text fw={600} size="sm" truncate>
                    {a?.ticker ?? it.id}
                  </Text>
                  {a && (
                    <Text size="note" c="dimmed" truncate>
                      {titleCase(a.assetClass)} - {usd(a.priceUsd)}
                    </Text>
                  )}
                </div>
                <Group gap={4} wrap="nowrap" style={{flexShrink: 0}}>
                  <NumberInput
                    value={it.pct}
                    onChange={(v) => basket.setPct(it.id, Math.max(0, Number(v) || 0))}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    size="xs"
                    w={80}
                  />
                  <CloseButton size="sm" onClick={() => basket.remove(it.id)} />
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}

      <Group justify="space-between" mb="sm">
        <Button
          size="compact-sm"
          variant="default"
          disabled={basket.items.length === 0}
          onClick={basket.equalWeight}
        >
          Equal weight
        </Button>
        <Text fw={700} c={sum > 0 ? "green" : "red"} style={{fontVariantNumeric: "tabular-nums"}}>
          {sum}%
        </Text>
      </Group>
      {sum !== 100 && active.length > 0 && (
        <Text size="note" c="dimmed" mb="sm">
          Weights are relative and get normalized to exactly 100% on submit.
        </Text>
      )}

      <Divider mb="sm" />
      <TextInput
        placeholder="Index name (e.g. My Hand-Picked 10)"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        mb="xs"
      />
      <Textarea
        placeholder="Thesis: why these assets? (optional)"
        value={thesis}
        onChange={(e) => setThesis(e.currentTarget.value)}
        autosize
        minRows={2}
        mb="xs"
      />
      <Select
        label="Rebalance strategy"
        data={STRATEGY_SELECT_DATA}
        value={strategy}
        onChange={(v) => setStrategy(v ?? DEFAULT_STRATEGY)}
        searchable
        mb={4}
      />
      <Text size="note" c="dimmed" mb="sm">
        {STRATEGY_TEMPLATES.find((s) => s.id === strategy)?.description ??
          strategyName(strategy)}
      </Text>

      <Button fullWidth disabled={!canSubmit} loading={submitting} onClick={submit}>
        {submitting ? "Adding to competition..." : "Add to competition"}
      </Button>
      {!canSubmit && !submitting && (
        <Text size="note" c="dimmed" mt={6}>
          Needs a name and at least one asset with weight above 0.
        </Text>
      )}

      {lastAdded && (
        <Alert color="green" variant="light" mt="sm" title="In the competition">
          {`"${lastAdded}" was added and joins the live board on the next engine tick.`}
          <Group mt="sm" gap="sm">
            <Button component={Link} to="/live" color="green" size="compact-sm">
              Watch it live
            </Button>
            <Button component={Link} to="/leaderboard" variant="light" size="compact-sm">
              View on leaderboard
            </Button>
          </Group>
        </Alert>
      )}
    </Card>
  );
}
