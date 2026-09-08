import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {useQueryClient} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {useMemo, useState} from "react";
import {addBasket} from "@/core/add.ts";
import {generateIndex} from "@/core/generate.ts";
import {
  DEFAULT_STRATEGY,
  STRATEGY_GROUP_LABELS,
  STRATEGY_TEMPLATES,
  strategyName,
  type StrategyGroup,
} from "@/core/strategies.ts";
import type {CatalogAsset, UserBasket} from "@/core/types.ts";
import {depositOnChain, mintTestUsd} from "@/core/evm-seam.ts";
import {useCatalog} from "@/core/use-data.ts";
import {useOnchain} from "@/core/use-onchain.ts";
import {useWallet} from "@/core/wallet-context.tsx";

const usd = (x: number | null) =>
  x == null ? "-" : `$${x.toLocaleString(undefined, {maximumFractionDigits: x < 10 ? 4 : 2})}`;
const short = (a?: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "your wallet");
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "index";

// Strategy picker options grouped by intervals / harnesses / combined.
const STRATEGY_SELECT_DATA = (["intervals", "harnesses", "combined"] as StrategyGroup[]).map(
  (g) => ({
    group: STRATEGY_GROUP_LABELS[g],
    items: STRATEGY_TEMPLATES.filter((s) => s.group === g).map((s) => ({
      value: s.id,
      label: s.name,
    })),
  })
);

// Starter prompts for the "Generate from prompt" box (RWA universe).
const PROMPT_TEMPLATES = [
  "Bloomberg top 5 US tech stocks",
  "Magnificent 7 tokenized equities",
  "AI and semiconductor leaders",
  "Gold-heavy precious metals hedge",
  "Wall Street money-center banks",
  "Broad-market ETF core: S&P, Nasdaq, small-cap",
  "Tokenized big pharma",
  "High-dividend blue chips",
];

export function BuildPage() {
  const {data: catalog, isLoading} = useCatalog();
  const {data: onchain} = useOnchain();
  const {connected, mode, provider} = useWallet();
  const queryClient = useQueryClient();
  const [minting, setMinting] = useState(false);

  const stable = onchain?.stable ?? null;
  // A real wallet (not the mock demo) that can sign Coston2 txs.
  const realWallet = connected && mode === "injected" && provider != null;

  // Builder state.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [strategy, setStrategy] = useState<string>(DEFAULT_STRATEGY);
  const [built, setBuilt] = useState<UserBasket[]>([]);

  // Universe filters.
  const [q, setQ] = useState("");
  const [fclass, setFclass] = useState<string | null>("");
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const allAssets = useMemo<CatalogAsset[]>(() => {
    if (!catalog) return [];
    return catalog.assets.map((a) => ({...a, kind: "rwa" as const}));
  }, [catalog]);

  const byId = useMemo(() => new Map(allAssets.map((a) => [a.id, a])), [allAssets]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return allAssets
      .filter((a) => {
        if (!a.priceSource) return false; // priceable RWA only
        if (fclass && a.assetClass !== fclass) return false;
        if (ql) {
          const hay = `${a.ticker} ${a.name} ${a.issuerName}`.toLowerCase();
          if (!hay.includes(ql)) return false;
        }
        return true;
      })
      .slice(0, 200);
  }, [allAssets, q, fclass]);

  const total = Object.values(picked).reduce((a, v) => a + (Number(v) || 0), 0);
  const canSubmit = total === 100 && Object.keys(picked).length > 0 && name.trim().length > 0;

  const addAsset = (id: string) => {
    if (id in picked) return;
    const ids = [...Object.keys(picked), id];
    setPicked(evenWeights(ids));
  };
  const removeAsset = (id: string) => {
    const {[id]: _, ...rest} = picked;
    setPicked(rest);
  };
  const setWeight = (id: string, w: number) => setPicked((p) => ({...p, [id]: w}));

  const equalWeight = () => setPicked(evenWeights(Object.keys(picked)));
  const normalize = () => {
    if (total <= 0) return equalWeight();
    const ids = Object.keys(picked);
    let acc = 0;
    const out: Record<string, number> = {};
    ids.forEach((id, i) => {
      const w = i === ids.length - 1 ? 100 - acc : Math.round((picked[id] / total) * 100);
      out[id] = w;
      acc += w;
    });
    setPicked(out);
  };

  const runMint = async () => {
    setMinting(true);
    try {
      const res = await mintTestUsd({provider, stable, mode, amountUsdc: 1000});
      notifications.show({
        color: res.ok ? "green" : "red",
        title: res.ok ? "Minted 1000 test USD" : "Mint failed",
        message: res.ok
          ? res.mocked
            ? "Mocked (demo account, no chain)."
            : `1000 mUSDC minted to ${short(res.address)} on Coston2. ` +
              `tx ${res.txHash?.slice(0, 10)}...`
          : String(res.error),
      });
    } finally {
      setMinting(false);
    }
  };

  const runGenerate = async () => {
    if (!catalog || !genPrompt.trim()) return;
    setGenerating(true);
    try {
      const g = await generateIndex(genPrompt.trim(), catalog);
      setPicked(g.weights);
      setName(g.name);
      setThesis(g.rationale || genPrompt.trim());
      setStrategy(g.strategy);
      notifications.show({
        color: "green",
        message: `Pre-filled from prompt (${g.source}). Tweak, then add to competition.`,
      });
    } catch (e) {
      notifications.show({color: "red", message: `Generation failed: ${String(e)}`});
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    const basket: UserBasket = {
      id: slug(name),
      name: name.trim(),
      prompt: thesis.trim() || name.trim(),
      kind: "rwa",
      strategy,
      weights: {...picked},
    };

    // Submit to the competition server: it scores the basket with the real
    // rebalance math, tags it owner:"you" in user-baskets.json (so the live
    // engine races it), and ranks it on the leaderboard. If the server is
    // unreachable the submission never reaches the competition, so we FAIL LOUDLY
    // and do NOT present it as added.
    const added = await addBasket(basket);
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

    // Only a successful server response counts as added: echo it locally and
    // show success + the leaderboard / live links.
    setBuilt((b) => [...b, basket]);
    await queryClient.invalidateQueries({queryKey: ["leaderboard"]});
    notifications.show({
      color: "green",
      title: "Added to the competition",
      message:
        `"${basket.name}" is in the competition (${added.mode}). ` +
        `Ranked #${added.entry?.rank} at ${((added.entry?.weekReturn ?? 0) * 100).toFixed(2)}%. ` +
        `It joins Live on the next engine tick.`,
    });

    // On-chain deposit only for indices with a DEPLOYED vault (the 5 house
    // indices). A user-submitted basket has no on-chain vault, so it stays
    // off-chain (the server already scored it above): no fake deposit.
    const vaultAddr = onchain?.vaults[basket.id]?.addr ?? null;
    if (realWallet && vaultAddr) {
      const res = await depositOnChain({
        provider,
        stable,
        vault: vaultAddr,
        amountUsdc: 1000,
        mode,
      });
      notifications.show({
        color: res.ok ? "green" : "red",
        title: res.ok ? "Deposited into the index vault" : "Deposit failed",
        message: res.ok
          ? res.mocked
            ? "Mocked (demo account, no chain)."
            : `1000 mUSDC deposited on Coston2. tx ${res.txHash?.slice(0, 10)}...`
          : String(res.error),
      });
    }

    setPicked({});
    setName("");
    setThesis("");
    setStrategy(DEFAULT_STRATEGY);
  };

  if (isLoading) return <Loader />;

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Build an index</Title>
        <Text c="dimmed">
          Autonomous AI indices on Flare. Pick from ~1,300 priceable tokenized
          real-world assets, set weights, choose a rebalance strategy, and enter
          the competition.
        </Text>
      </div>

      <Card withBorder radius="md">
        <Text fw={600} mb="xs">
          Generate from prompt
        </Text>
        <Group align="flex-end">
          <TextInput
            flex={1}
            placeholder="e.g. A gold-heavy precious metals hedge with some silver and platinum"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.currentTarget.value)}
          />
          <Button loading={generating} onClick={runGenerate} disabled={!genPrompt.trim()}>
            Generate
          </Button>
        </Group>
        <Group gap={6} mt="xs">
          <Text size="note" c="dimmed">
            Try:
          </Text>
          {PROMPT_TEMPLATES.map((t) => (
            <Badge
              key={t}
              variant="light"
              color="gray"
              style={{cursor: "pointer"}}
              onClick={() => setGenPrompt(t)}
            >
              {t}
            </Badge>
          ))}
        </Group>
        <Text size="note" c="dimmed" mt={6}>
          Produces a whole index (name, thesis, assets, weights, strategy) chosen
          only from the catalog, then pre-fills the builder below.
        </Text>
      </Card>

      <Grid gutter="lg">
        <Grid.Col span={{base: 12, md: 7}}>
          <Card withBorder radius="md">
            <Text fw={600} mb="xs">
              Universe {catalog ? `(${catalog.priceable.toLocaleString()} priceable RWA)` : ""}
            </Text>
            <Group mb="sm">
              <TextInput
                flex={1}
                placeholder="Search ticker, name or issuer (TSLA, gold, ondo)"
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
              <Select
                data={[
                  {value: "", label: "All classes"},
                  ...(catalog?.classes ?? []).map((c) => ({value: c, label: c})),
                ]}
                value={fclass}
                onChange={setFclass}
                w={180}
              />
            </Group>
            <Stack gap={4} mah="55vh" style={{overflowY: "auto"}}>
              {filtered.map((a) => (
                <Group key={a.id} justify="space-between" wrap="nowrap">
                  <div style={{minWidth: 0}}>
                    <Group gap={6}>
                      <Text fw={600} truncate>
                        {a.ticker}
                      </Text>
                      <Badge size="xs" variant="light" color="grape">
                        {a.assetClass}
                      </Badge>
                    </Group>
                    <Text size="note" c="dimmed" truncate>
                      {a.name} - {a.issuerName}
                    </Text>
                  </div>
                  <Group gap="sm" wrap="nowrap">
                    <Text size="note" c="dimmed">
                      {usd(a.priceUsd)}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="light"
                      disabled={a.id in picked}
                      onClick={() => addAsset(a.id)}
                    >
                      {a.id in picked ? "added" : "+ add"}
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{base: 12, md: 5}}>
          <Card withBorder radius="md">
            <Text fw={600} mb="xs">
              Your index
            </Text>
            <TextInput
              placeholder="Index name (e.g. Mag-7 Tokenized)"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              mb="xs"
            />
            <Textarea
              placeholder="Thesis: what is this index and why these weights?"
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

            {Object.keys(picked).length === 0 ? (
              <Text size="note" c="dimmed" py="sm">
                No assets yet. Add from the universe, or generate from a prompt.
              </Text>
            ) : (
              <Stack gap={6} mb="sm">
                {Object.keys(picked).map((id) => {
                  const a = byId.get(id);
                  return (
                    <Group key={id} justify="space-between" wrap="nowrap">
                      <div style={{minWidth: 0}}>
                        <Text fw={600} truncate>
                          {a?.ticker ?? id}
                        </Text>
                        <Text size="note" c="dimmed" truncate>
                          {a?.name}
                        </Text>
                      </div>
                      <Group gap={4} wrap="nowrap">
                        <NumberInput
                          value={picked[id]}
                          onChange={(v) => setWeight(id, Number(v) || 0)}
                          min={0}
                          max={100}
                          w={80}
                          suffix="%"
                        />
                        <Button size="compact-xs" variant="subtle" color="red" onClick={() => removeAsset(id)}>
                          x
                        </Button>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            )}

            <Group justify="space-between" mb="sm">
              <Text fw={600}>Total weight</Text>
              <Text fw={700} c={total === 100 ? "green" : "red"}>
                {total}%
              </Text>
            </Group>
            <Group mb="sm" grow>
              <Button variant="default" onClick={equalWeight}>
                Equal weight
              </Button>
              <Button variant="default" onClick={normalize}>
                Normalize to 100%
              </Button>
            </Group>
            <Button
              variant="light"
              fullWidth
              mb="sm"
              loading={minting}
              disabled={realWallet && !stable}
              onClick={runMint}
            >
              Mint 1000 test USD
            </Button>
            <Button fullWidth disabled={!canSubmit} onClick={submit}>
              Add to competition
              {realWallet && onchain?.vaults[slug(name)]?.addr ? " + deposit" : ""}
            </Button>
            {!canSubmit && (
              <Text size="note" c="dimmed" mt={6}>
                Weights must sum to 100% with at least one asset and a name.
              </Text>
            )}
            <Text size="note" c="dimmed" mt={6}>
              Mint calls MockUSDC.faucet() to send 1000 test USD (6 decimals) to
              your connected wallet on Coston2. Deposits into the index vault are
              on-chain for the house indices; mocked with the demo account.
            </Text>
          </Card>

          {built.length > 0 && (
            <Card withBorder radius="md" mt="md">
              <Text fw={600} mb="xs">
                Added to the competition this session ({built.length})
              </Text>
              <Stack gap={6}>
                {built.map((b, i) => (
                  <Group key={i} justify="space-between">
                    <div>
                      <Text fw={600}>{b.name}</Text>
                      <Text size="note" c="dimmed">
                        {Object.entries(b.weights)
                          .map(([id, w]) => `${byId.get(id)?.ticker ?? id} ${w}%`)
                          .join(", ")}{" "}
                        - {b.strategy}
                      </Text>
                    </div>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() => setBuilt((x) => x.filter((_, j) => j !== i))}
                    >
                      remove
                    </Button>
                  </Group>
                ))}
              </Stack>
              <Alert mt="sm" color="gray" variant="light">
                Each of these reached the competition server, which scored it with
                the real rebalance math and ranked it on <code>/leaderboard</code>;
                the live engine races it on the next tick. With <code>PK</code> +
                <code> TEE_SIGN_URL</code> set the server also deposits and the FCC
                tee-node signs the rebalance on Coston2.
              </Alert>
              <Group mt="sm" gap="sm">
                <Button component={Link} to="/leaderboard" variant="light" size="sm">
                  View on leaderboard
                </Button>
                <Button component={Link} to="/live" variant="subtle" size="sm">
                  Watch live
                </Button>
              </Group>
            </Card>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

// Even integer weights over ids, remainder on the last.
function evenWeights(ids: string[]): Record<string, number> {
  const n = ids.length;
  if (!n) return {};
  const even = Math.floor(100 / n);
  let rem = 100;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    const w = i === n - 1 ? rem : even;
    out[id] = w;
    rem -= w;
  });
  return out;
}
