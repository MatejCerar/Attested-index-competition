import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {useQueryClient} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {useEffect, useMemo, useState} from "react";
import {addBasket} from "@/core/add.ts";
import {
  COMPETITIVE_POSITIONS,
  GICS_SECTORS,
  HOUSE_CONFIG,
  SCORING_FEATURES,
  previewIndex,
  weightsToUnits,
  type IndexConfig,
  type IndexEntry,
} from "@/core/index-config.ts";
import {recordDeposit} from "@/core/cost-basis.ts";
import {generateIndex} from "@/core/generate.ts";
import {
  DEFAULT_REBALANCE_PRESET,
  FRACTION_FEATURES,
  REBALANCE_PRESETS,
  REBALANCE_PROMPT_TEMPLATES,
  generateRebalanceStrategy,
  type FeatureCondition,
  type RebalanceSpec,
} from "@/core/rebalance.ts";
import type {BasketConfig, CatalogAsset, UserBasket} from "@/core/types.ts";
import {depositOnChain, mintTestUsd} from "@/core/evm-seam.ts";
import {useCatalog} from "@/core/use-data.ts";
import {useOnchain} from "@/core/use-onchain.ts";
import {useWallet} from "@/core/wallet-context.tsx";

const short = (a?: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "your wallet");
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "index";
const titleCase = (s: string) =>
  s.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmtMs = (ms: number) => {
  if (ms % 86400000 === 0) return `${ms / 86400000}d`;
  if (ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0) return `${ms / 60000}m`;
  return `${Math.round(ms / 1000)}s`;
};
const fmtPct = (f: number) => `${+f.toFixed(2)}%`;
// Feature condition -> "avg dividend_yield < 2%" / "market_vol > 25%".
const condReadout = (c: FeatureCondition) => {
  const v = FRACTION_FEATURES.has(c.feature) ? fmtPct(c.value * 100) : `${+c.value.toFixed(2)}`;
  return `${c.scope === "market" ? "" : "avg "}${c.feature} ${c.op === "lt" ? "<" : ">"} ${v}`;
};
// Compact spec readout: every enabled trigger plus combine + step guard.
const specReadout = (s: RebalanceSpec) =>
  [
    s.intervalMs != null ? `interval ${fmtMs(s.intervalMs)}` : null,
    s.driftBps != null ? `drift ${fmtPct(s.driftBps / 100)}` : null,
    s.nameBreachBps != null ? `name breach ${fmtPct(s.nameBreachBps / 100)}` : null,
    s.sectorDriftBps != null ? `sector drift ${fmtPct(s.sectorDriftBps / 100)}` : null,
    s.takeProfitPct != null ? `take profit ${fmtPct(s.takeProfitPct * 100)}` : null,
    s.drawdownPct != null ? `drawdown ${fmtPct(s.drawdownPct * 100)}` : null,
    s.volBandPct != null ? `vol band ${fmtPct(s.volBandPct * 100)}` : null,
    s.trendFlip != null ? `trend flip ${s.trendFlip}p` : null,
    s.relativeLagPct != null ? `rel lag ${fmtPct(s.relativeLagPct * 100)}` : null,
    ...(s.featureConditions ?? []).map(condReadout),
    s.cooldownMs != null ? `cooldown ${fmtMs(s.cooldownMs)}` : null,
    `combine ${s.combine}`,
    `step guard ${fmtPct(s.maxStepMoveBps / 100)}`,
  ]
    .filter(Boolean)
    .join(" / ");

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

// The one active rebalance rule: always a valid spec, shown in the readout and
// submitted with the basket. origin drives the small source label.
interface ActiveRule {
  label: string;
  spec: RebalanceSpec;
  origin: "default" | "preset" | "prompt";
  note?: string;
  fallback?: boolean;
}

const DEFAULT_RULE: ActiveRule = {
  label: DEFAULT_REBALANCE_PRESET.label,
  spec: DEFAULT_REBALANCE_PRESET.spec,
  origin: "default",
};

const SECTOR_OPTIONS = GICS_SECTORS.map((s) => ({value: s, label: titleCase(s)}));
const POSITION_OPTIONS = COMPETITIVE_POSITIONS.map((p) => ({value: p, label: titleCase(p)}));
const FEATURE_GROUPS = ["Value", "Yield", "Growth", "Quality", "Momentum", "AI-scored"];

// One resulting holding, as shown in the output panel and submitted on add.
interface ResultLeg {
  key: string; // matrix ticker or catalog id
  ticker: string;
  sector?: string;
  pct: number; // integer percent, sums to 100 across mapped legs
  catalogId: string | null; // null = not in the RWA catalog, dropped on submit
}

// Map a matrix ticker (NVDA) to a priceable catalog asset id, trying the
// common tokenized-equity naming (NVDA, NVDAx, NVDAon, bNVDA, aNVDA).
function mapTicker(t: string, byTicker: Map<string, CatalogAsset>): string | null {
  const cands = [t, `${t}x`, `${t}on`, `b${t}`, `a${t}`];
  for (const c of cands) {
    const a = byTicker.get(c.toLowerCase());
    if (a) return a.id;
  }
  return null;
}

export function BuildPage() {
  const {data: catalog, isLoading} = useCatalog();
  const {data: onchain} = useOnchain();
  const {connected, mode, provider, address} = useWallet();
  const queryClient = useQueryClient();
  const [minting, setMinting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // How much of your own test USD to deposit into your index on submit.
  const [depositAmt, setDepositAmt] = useState(1000);

  const stable = onchain?.stable ?? null;
  // A real wallet (not the mock demo) that can sign Coston2 txs.
  const realWallet = connected && mode === "injected" && provider != null;

  // The index definition: a config, not typed percentages.
  const [cfg, setCfg] = useState<IndexConfig>(() => structuredClone(HOUSE_CONFIG));
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [built, setBuilt] = useState<UserBasket[]>([]);
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  // The unified rebalance rule: starts as the default preset, replaced by a
  // preset chip (instant) or a generated prompt rule. Always valid.
  const [rule, setRule] = useState<ActiveRule>(DEFAULT_RULE);
  const [rebPrompt, setRebPrompt] = useState("");
  const [rebGenerating, setRebGenerating] = useState(false);

  const allAssets = useMemo<CatalogAsset[]>(() => {
    if (!catalog) return [];
    return catalog.assets.map((a) => ({...a, kind: "rwa" as const}));
  }, [catalog]);
  const byId = useMemo(() => new Map(allAssets.map((a) => [a.id, a])), [allAssets]);
  const byTicker = useMemo(() => {
    const m = new Map<string, CatalogAsset>();
    for (const a of allAssets) {
      if (a.priceSource && !m.has(a.ticker.toLowerCase())) m.set(a.ticker.toLowerCase(), a);
    }
    return m;
  }, [allAssets]);

  // Recompute the resulting weights from the config, debounced. The build runs
  // on the server (/api/build via VITE_BUILD_URL); no server, no preview.
  useEffect(() => {
    let live = true;
    setPreviewBusy(true);
    const t = setTimeout(async () => {
      const res = await previewIndex(cfg);
      if (!live) return;
      setEntries(res.entries);
      setPreviewError(res.ok ? null : (res.error ?? "build failed"));
      setPreviewBusy(false);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [cfg]);

  // The output legs: config-computed entries mapped to catalog assets.
  const legs = useMemo<ResultLeg[]>(() => {
    if (!entries.length) return [];
    const mapped = entries.map((e) => ({e, catalogId: mapTicker(e.id, byTicker)}));
    const inCat = mapped.filter((m) => m.catalogId);
    const pcts = inCat.length
      ? weightsToUnits(inCat.map((m) => m.e.id), inCat.map((m) => m.e.weight), 100)
      : [];
    const pctById = new Map(inCat.map((m, i) => [m.e.id, pcts[i]]));
    return mapped.map(({e, catalogId}) => ({
      key: e.id,
      ticker: e.id,
      sector: e.sector,
      pct: catalogId ? (pctById.get(e.id) ?? 0) : Math.round(e.weight * 100),
      catalogId,
    }));
  }, [entries, byTicker]);

  const submitLegs = legs.filter((l) => l.catalogId && l.pct > 0);
  const unmapped = legs.filter((l) => !l.catalogId);
  const canSubmit = submitLegs.length > 0 && name.trim().length > 0 && !previewBusy;

  const setWeight = (feat: string, w: number) =>
    setCfg((c) => ({...c, weights: {...c.weights, [feat]: w}}));
  const resetConfig = () => setCfg(structuredClone(HOUSE_CONFIG));

  const runMint = async () => {
    setMinting(true);
    try {
      const res = await mintTestUsd({provider, stable, mode, amountUsdc: 1000});
      notifications.show({
        color: res.ok ? "up" : "down",
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
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const g = await generateIndex(genPrompt.trim());
      setCfg(g.config);
      setName(g.name);
      setThesis(g.rationale || genPrompt.trim());
      notifications.show({
        color: "up",
        message: `Config pre-filled from prompt (${g.source}). Tweak, then add to competition.`,
      });
    } finally {
      setGenerating(false);
    }
  };

  const runRebalanceGenerate = async () => {
    if (!rebPrompt.trim()) return;
    setRebGenerating(true);
    try {
      const g = await generateRebalanceStrategy(rebPrompt.trim());
      setRule({
        label: g.name,
        spec: g.spec,
        origin: "prompt",
        note: g.note,
        fallback: g.source === "fallback",
      });
      notifications.show({
        color: g.source === "live" ? "up" : "gray",
        title:
          g.source === "live"
            ? "Rebalance rule generated"
            : "Live generation unavailable, default rule applied",
        message: g.note,
      });
    } finally {
      setRebGenerating(false);
    }
  };

  const submit = async () => {
    if (!canSubmit || submitting) return;
    const weights: Record<string, number> = {};
    for (const l of submitLegs) weights[l.catalogId!] = l.pct;
    // Config-built baskets carry the full definition, not just percentages.
    const basketConfig: BasketConfig = {
      configVersion: cfg.version,
      weights: {...cfg.weights},
      normalization: cfg.normalization,
      winsor: cfg.winsor,
      weighting: cfg.weighting,
      topN: cfg.top_n,
      maxWeight: cfg.max_weight,
      sectorCap: cfg.sector_cap,
      eligibleSectors: [...cfg.eligible_sectors],
      minMarketCapUsd: cfg.min_market_cap_usd,
      competitivePosition: cfg.competitive_position.length
        ? [...cfg.competitive_position]
        : undefined,
    };
    const basket: UserBasket = {
      id: slug(name),
      name: name.trim(),
      prompt: thesis.trim() || name.trim(),
      kind: "rwa",
      strategy: rule.label,
      weights,
      config: basketConfig,
      rebalanceSpec: rule.spec,
    };

    setSubmitting(true);
    try {
      // Submit to the competition server: it scores the basket with the real
      // rebalance math, tags it owner:"you" in user-baskets.json (so the live
      // engine races it), and ranks it on the leaderboard. If the server is
      // unreachable the submission never reaches the competition, so we FAIL
      // LOUDLY and do NOT present it as added.
      const added = await addBasket(basket, address);
      if (!added.ok) {
        notifications.show({
          color: "down",
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
        color: "up",
        title: "Added to the competition",
        message:
          `"${basket.name}" is in the competition (${added.mode}). ` +
          `It joins Live and the leaderboard on the next engine tick.`,
      });

      // Deposit YOUR 1000 mUSDC into the index's real vault - that is your
      // position. The server just deployed a fresh vault for this index (mode
      // "chain") and returns its address; prefer that, else fall back to a
      // pre-known house vault. No real vault (off-chain) -> no deposit.
      const vaultAddr =
        (added.mode === "chain" ? added.entry?.vault : null) ??
        onchain?.vaults[basket.id]?.addr ??
        null;
      if (realWallet && vaultAddr && depositAmt > 0) {
        const res = await depositOnChain({
          provider,
          stable,
          vault: vaultAddr,
          amountUsdc: depositAmt,
          mode,
        });
        if (res.ok && !res.mocked) recordDeposit(vaultAddr, depositAmt);
        notifications.show({
          color: res.ok ? "up" : "down",
          title: res.ok
            ? `Deposited $${depositAmt.toLocaleString()} into your index vault`
            : "Deposit failed",
          message: res.ok
            ? res.mocked
              ? "Mocked (demo account, no chain)."
              : `Your $${depositAmt.toLocaleString()} mUSDC is now your position. ` +
                `tx ${res.txHash?.slice(0, 10)}... See My positions.`
            : String(res.error),
        });
      }

      setName("");
      setThesis("");
      setRule(DEFAULT_RULE);
      setRebPrompt("");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <Loader />;

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Build an index</Title>
        <Text c="dimmed">
          Autonomous AI indices on Flare. Define the index as a config - signed
          factor weights, eligibility filters, caps, normalization - and the
          deterministic builder computes the holdings. Same config + same frozen
          feature matrix, same index, byte for byte. Prefer to hand-pick assets?
          Browse the{" "}
          <Text component={Link} to="/universe" span c="inherit" td="underline">
            Universe
          </Text>{" "}
          and build a basket by hand.
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
          Produces a full index config (name, thesis, factor weights, filters,
          strategy) and loads it into the editor below; the holdings recompute
          from it like any other config.
        </Text>
      </Card>

      <Grid gutter="lg">
        <Grid.Col span={{base: 12, md: 7}}>
          <Card withBorder radius="md">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>Index config (v{cfg.version})</Text>
              <Button size="compact-xs" variant="default" onClick={resetConfig}>
                Reset to house config
              </Button>
            </Group>
            <Text size="note" c="dimmed" mb="sm">
              Signed factor weights: positive means higher is better, negative
              means lower is better (valuation multiples, leverage, volatility,
              regulatory risk). The composite score ranks the universe.
            </Text>

            {FEATURE_GROUPS.map((g) => (
              <div key={g}>
                <Text size="note" fw={600} tt="uppercase" c="dimmed" mt="xs" mb={4}>
                  {g}
                </Text>
                {SCORING_FEATURES.filter((f) => f.group === g).map((f) => {
                  const w = cfg.weights[f.name] ?? 0;
                  return (
                    <Group key={f.name} gap="sm" wrap="nowrap" mb={6}>
                      <div style={{width: 170, flexShrink: 0}}>
                        <Text size="sm" truncate>
                          {f.label}
                        </Text>
                        <Text size="note" c="dimmed">
                          {f.kind === "score" ? "AI-scored 0..5" : "data feed"}
                          {f.lowerIsBetter ? ", lower is better" : ""}
                        </Text>
                      </div>
                      <Slider
                        flex={1}
                        min={-0.2}
                        max={0.2}
                        step={0.005}
                        value={w}
                        onChange={(v) => setWeight(f.name, Number(v.toFixed(3)))}
                        label={(v) => `${v > 0 ? "+" : ""}${v.toFixed(3)}`}
                        marks={[{value: 0}]}
                        color={w < 0 ? "down" : "up"}
                      />
                      <Text
                        size="sm"
                        fw={700}
                        w={56}
                        ta="right"
                        c={w < 0 ? "down.7" : w > 0 ? "up.7" : "dimmed"}
                        style={{flexShrink: 0, fontVariantNumeric: "tabular-nums"}}
                      >
                        {w > 0 ? "+" : ""}
                        {w.toFixed(3)}
                      </Text>
                    </Group>
                  );
                })}
              </div>
            ))}

            <Divider my="sm" />
            <Text fw={600} size="sm" mb={6}>
              Eligibility filters
            </Text>
            <MultiSelect
              label="Eligible sectors (GICS)"
              description="Empty allows all 11 sectors"
              data={SECTOR_OPTIONS}
              value={cfg.eligible_sectors}
              onChange={(v) => setCfg((c) => ({...c, eligible_sectors: v}))}
              clearable
              mb="xs"
            />
            <Group grow mb="xs">
              <NumberInput
                label="Min market cap"
                value={cfg.min_market_cap_usd / 1e9}
                onChange={(v) =>
                  setCfg((c) => ({...c, min_market_cap_usd: Math.max(0, Number(v) || 0) * 1e9}))
                }
                min={0}
                step={10}
                prefix="$"
                suffix="B"
              />
              <MultiSelect
                label="Competitive position"
                description="Optional; empty allows all"
                data={POSITION_OPTIONS}
                value={cfg.competitive_position}
                onChange={(v) => setCfg((c) => ({...c, competitive_position: v}))}
                clearable
              />
            </Group>

            <Divider my="sm" />
            <Text fw={600} size="sm" mb={6}>
              Selection and caps
            </Text>
            <Group grow mb="xs">
              <NumberInput
                label="Top N names"
                value={cfg.top_n}
                onChange={(v) => setCfg((c) => ({...c, top_n: Math.max(1, Math.round(Number(v) || 1))}))}
                min={1}
                max={50}
              />
              <NumberInput
                label="Max weight per name"
                value={Math.round(cfg.max_weight * 100)}
                onChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    max_weight: Math.min(100, Math.max(1, Number(v) || 1)) / 100,
                  }))
                }
                min={1}
                max={100}
                suffix="%"
              />
              <NumberInput
                label="Sector cap"
                value={Math.round(cfg.sector_cap * 100)}
                onChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    sector_cap: Math.min(100, Math.max(1, Number(v) || 1)) / 100,
                  }))
                }
                min={1}
                max={100}
                suffix="%"
              />
            </Group>

            <Divider my="sm" />
            <Group grow>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Normalization
                </Text>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  data={[
                    {value: "zscore", label: "z-score"},
                    {value: "rank", label: "rank"},
                    {value: "minmax", label: "min-max"},
                  ]}
                  value={cfg.normalization}
                  onChange={(v) =>
                    setCfg((c) => ({...c, normalization: v as IndexConfig["normalization"]}))
                  }
                />
              </div>
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Weighting
                </Text>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  data={[
                    {value: "score_tilt", label: "score tilt"},
                    {value: "equal", label: "equal"},
                  ]}
                  value={cfg.weighting}
                  onChange={(v) => setCfg((c) => ({...c, weighting: v as IndexConfig["weighting"]}))}
                />
              </div>
            </Group>
            <Text size="note" c="dimmed" mt="xs">
              Features are winsorized at the {Math.round(cfg.winsor * 100)}th
              percentile, normalized, and summed with the signed weights. Top N
              by score, then per-name and per-sector caps by water-filling.
            </Text>
          </Card>
        </Grid.Col>

        <Grid.Col span={{base: 12, md: 5}}>
          <Card withBorder radius="md">
            <Text fw={600} mb="xs">
              Your index
            </Text>
            <TextInput
              placeholder="Index name (e.g. Quality-Momentum 20)"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              mb="xs"
            />
            <Textarea
              placeholder="Thesis: what is this index and why this config?"
              value={thesis}
              onChange={(e) => setThesis(e.currentTarget.value)}
              autosize
              minRows={2}
              mb="xs"
            />
            <Text fw={600} size="sm" mb={4}>
              Rebalance rule
            </Text>
            <Text size="note" c="dimmed" mb="xs">
              Pick a preset, or describe your own policy below. The active rule
              is what the live engine evaluates each tick.
            </Text>
            <Group gap={6} mb="sm">
              {REBALANCE_PRESETS.map((p) => {
                const active = rule.origin !== "prompt" && rule.label === p.label;
                return (
                  <Badge
                    key={p.label}
                    variant={active ? "filled" : "light"}
                    color={active ? "flare" : "gray"}
                    style={{cursor: "pointer"}}
                    onClick={() =>
                      setRule({label: p.label, spec: p.spec, origin: "preset"})
                    }
                  >
                    {p.label}
                  </Badge>
                );
              })}
            </Group>

            <Text size="note" c="dimmed" mb={4}>
              or describe your own
            </Text>
            <Textarea
              placeholder="e.g. take profit at 10%, otherwise rebalance weekly, never more than once a day"
              value={rebPrompt}
              onChange={(e) => setRebPrompt(e.currentTarget.value)}
              autosize
              minRows={2}
              mb="xs"
            />
            <Group gap={6} mb="xs">
              <Text size="note" c="dimmed">
                Try:
              </Text>
              {REBALANCE_PROMPT_TEMPLATES.map((t) => (
                <Badge
                  key={t}
                  variant="light"
                  color="gray"
                  style={{cursor: "pointer"}}
                  onClick={() => setRebPrompt(t)}
                >
                  {t}
                </Badge>
              ))}
            </Group>
            <Group gap="sm" mb="sm">
              <Button
                size="compact-sm"
                loading={rebGenerating}
                disabled={!rebPrompt.trim()}
                onClick={runRebalanceGenerate}
              >
                Generate rebalance rule
              </Button>
            </Group>

            <Alert
              color={rule.origin === "prompt" && !rule.fallback ? "up" : "gray"}
              variant="light"
              mb="sm"
              title="Active rebalance rule"
            >
              <Badge size="xs" variant="light" color="gray" mb={4}>
                {rule.origin === "preset"
                  ? `preset: ${rule.label}`
                  : rule.origin === "prompt"
                    ? `from your prompt: ${rule.label}`
                    : "default"}
              </Badge>
              {rule.note && <Text size="sm">{rule.note}</Text>}
              <Text size="note" c="dimmed" mt={4} style={{fontVariantNumeric: "tabular-nums"}}>
                {specReadout(rule.spec)}
              </Text>
              {rule.fallback && (
                <Text size="note" c="dimmed" mt={4}>
                  Live generation was unavailable; this is the safe default
                  rule, not your prompt. Pick a preset or generate again.
                </Text>
              )}
            </Alert>
            <Divider mb="sm" />

            <Group justify="space-between" mb={4}>
              <Text fw={600} size="sm">
                Computed weights (output)
              </Text>
              <Group gap={6}>
                {previewBusy && <Loader size={14} />}
                <Badge size="xs" variant="light" color="gray">
                  built on server
                </Badge>
              </Group>
            </Group>
            <Text size="note" c="dimmed" mb="xs">
              Weights are computed from the config, not typed. Change the config
              and the holdings recompute.
            </Text>

            {previewError ? (
              <Alert color="gray" variant="light" mb="sm">
                {previewError}
              </Alert>
            ) : legs.length === 0 ? (
              <Text size="note" c="dimmed" py="sm">
                No holdings yet. Adjust the config, or generate from a prompt.
              </Text>
            ) : (
              <Stack gap={4} mb="sm" mah="40vh" style={{overflowY: "auto"}}>
                {legs.map((l) => (
                  <Group key={l.key} justify="space-between" wrap="nowrap">
                    <Group gap={6} wrap="nowrap" style={{minWidth: 0}}>
                      <Text fw={600} truncate style={l.catalogId ? undefined : {opacity: 0.5}}>
                        {l.ticker}
                      </Text>
                      {l.sector && (
                        <Badge size="xs" variant="light" color="gray">
                          {titleCase(l.sector)}
                        </Badge>
                      )}
                      {!l.catalogId && (
                        <Badge size="xs" variant="light" color="gray">
                          not in catalog
                        </Badge>
                      )}
                    </Group>
                    <Text fw={700} style={{fontVariantNumeric: "tabular-nums"}}>
                      {l.pct}%
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
            {unmapped.length > 0 && (
              <Text size="note" c="dimmed" mb="sm">
                {unmapped.map((l) => l.ticker).join(", ")}{" "}
                {unmapped.length === 1 ? "has" : "have"} no tokenized RWA in the
                catalog; the remaining names are renormalized to 100% on submit.
              </Text>
            )}

            <Group justify="space-between" mb="sm">
              <Text fw={600}>Total weight</Text>
              <Text fw={700} c={submitLegs.length > 0 ? "up.7" : "down.7"}>
                {submitLegs.reduce((a, l) => a + l.pct, 0)}%
              </Text>
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
            <NumberInput
              label="Your deposit into this index"
              description="Your own test USD that becomes your position. You need at least this much minted."
              value={depositAmt}
              onChange={(v) => setDepositAmt(Math.max(0, Number(v) || 0))}
              min={0}
              step={100}
              prefix="$"
              thousandSeparator=","
              mb="sm"
            />
            <Button
              fullWidth
              disabled={!canSubmit || submitting}
              loading={submitting}
              onClick={submit}
            >
              {submitting
                ? "Adding to competition..."
                : realWallet && depositAmt > 0
                  ? `Add to competition + deposit $${depositAmt.toLocaleString()}`
                  : "Add to competition"}
            </Button>
            {!canSubmit && (
              <Text size="note" c="dimmed" mt={6}>
                Needs a name and at least one catalog-mapped holding from the
                config (or a generated index).
              </Text>
            )}
            <Text size="note" c="dimmed" mt={6}>
              The submitted basket carries the full config (version, signed
              weights, filters, caps, normalization) alongside the resulting
              weights, so any enclave can rebuild and attest it. Mint calls
              MockUSDC.faucet() on Coston2; deposits into the index vault are
              on-chain for the house indices, mocked with the demo account.
            </Text>
          </Card>

          {built.length > 0 && (
            <Card withBorder radius="md" mt="md" style={{borderColor: "var(--mantine-color-up-6)"}}>
              <Alert color="up" variant="light" mb="sm" title="In the competition">
                {`"${built[built.length - 1].name}" was added and joins the live board on the
                next engine tick (about 15s). It is being scored with the real rebalance math
                right now.`}
              </Alert>
              <Text fw={600} mb="xs">
                Added to the competition this session ({built.length})
              </Text>
              <Stack gap={6}>
                {built.map((b, i) => (
                  <Group key={i} justify="space-between">
                    <div>
                      <Group gap={6}>
                        <Text fw={600}>{b.name}</Text>
                        {b.config && (
                          <Badge size="xs" variant="light" color="gray">
                            config v{b.config.configVersion}
                          </Badge>
                        )}
                      </Group>
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
                      color="gray"
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
                <Button component={Link} to="/live" size="sm">
                  Watch it live
                </Button>
                <Button component={Link} to="/leaderboard" variant="light" size="sm">
                  View on leaderboard
                </Button>
              </Group>
            </Card>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
