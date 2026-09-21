import {Badge, Divider, Group, HoverCard, Stack, Text} from "@mantine/core";
import type {IndexProvenance} from "@/core/types.ts";

// Compact provenance badge + hover popover for one index: config version,
// matrix hash, attestation epoch/quorum, and the price oracle mode. Renders
// nothing when the index carries no provenance fields (old data).

const shortHash = (h?: string) =>
  h ? (h.length > 14 ? `${h.slice(0, 10)}...${h.slice(-4)}` : h) : null;

const ORACLE_LABELS: Record<string, string> = {
  "enclave-signed": "enclave-signed",
  fdc: "FDC-attested",
  raw: "raw feed",
};

export function ProvenanceBadge({p}: {p: IndexProvenance}) {
  const has =
    p.matrixHash != null ||
    p.configVersion != null ||
    p.epochId != null ||
    p.attestedByCount != null ||
    p.outputRoot != null ||
    p.priceOracleMode != null;
  if (!has) return null;

  const quorum = (p.attestedByCount ?? 0) >= 2;
  const color = p.attestedByCount != null ? (quorum ? "green" : "yellow") : "gray";
  const label =
    p.attestedByCount != null
      ? `attested x${p.attestedByCount}`
      : p.configVersion != null
        ? `config v${p.configVersion}`
        : "provenance";

  return (
    <HoverCard width={320} shadow="md" withArrow position="bottom-start">
      <HoverCard.Target>
        <Badge size="xs" variant="light" color={color} style={{cursor: "help"}}>
          {label}
        </Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Build provenance
          </Text>
          {p.configVersion != null && <Line k="Config">version {p.configVersion}</Line>}
          {p.matrixHash && <Line k="Feature matrix">{shortHash(p.matrixHash)}</Line>}
          {p.outputRoot && <Line k="Output root">{shortHash(p.outputRoot)}</Line>}
          {(p.epochId != null || p.attestedByCount != null) && (
            <Line k="Attestation">
              {p.epochId != null ? `epoch ${p.epochId}` : "epoch -"}
              {p.attestedByCount != null && (
                <Text component="span" c={quorum ? "green" : "yellow"} fw={600}>
                  {" "}
                  attested by {p.attestedByCount} enclave{p.attestedByCount === 1 ? "" : "s"}
                </Text>
              )}
            </Line>
          )}
          {p.priceOracleMode && (
            <>
              <Divider my={2} />
              <Line k="Prices">
                {ORACLE_LABELS[p.priceOracleMode] ?? p.priceOracleMode}
                {p.priceAttested != null && (p.priceAttested ? ", attested" : ", not attested")}
                {p.lastPriceRound != null && `, round ${p.lastPriceRound}`}
              </Line>
              <Text size="note" c="dimmed">
                The live chart price is a display feed. The money-moving price
                is attested at rebalance, not on every tick.
              </Text>
            </>
          )}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function Line({k, children}: {k: string; children: React.ReactNode}) {
  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      <Text size="note" c="dimmed" w={92} style={{flexShrink: 0}}>
        {k}
      </Text>
      <Text size="note">{children}</Text>
    </Group>
  );
}
