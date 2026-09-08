import {Button, Group, Image, Modal, Stack, Text, UnstyledButton} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {useWallet} from "@/core/wallet-context.tsx";

// The connect-wallet modal. It lists the injected wallets discovered via
// EIP-6963 (fixing the MetaMask + Phantom collision on window.ethereum), plus a
// fallback "Injected wallet" if none announce, plus a demo (mock) account.
// Picking a real wallet requests accounts on THAT provider; errors surface as a
// red notification (never swallowed).
export function ConnectWalletModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const {connect, wallets} = useWallet();

  const run = async (
    target: {kind: "eip6963"; uuid: string} | {kind: "injected"} | {kind: "mock"},
    label: string
  ) => {
    try {
      await connect(target);
      notifications.show({
        color: "green",
        message: target.kind === "mock" ? "Demo account connected (mock)" : `${label} connected`,
      });
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Connect failed",
        message: String((e as Error)?.message ?? e),
      });
    }
  };

  const hasInjectedFallback =
    wallets.length === 0 &&
    typeof window !== "undefined" &&
    Boolean((window as {ethereum?: unknown}).ethereum);

  return (
    <Modal opened={opened} onClose={onClose} centered title="Connect wallet" radius="md">
      <Stack gap="sm">
        <Text size="sBody" c="dimmed">
          Mint and deposits run on Coston2 (Flare testnet). Connect a browser
          wallet for real testnet txs, or use the demo account to explore the flow.
        </Text>

        {wallets.map((w) => (
          <WalletOption
            key={w.info.uuid}
            label={w.info.name}
            hint="Injected wallet (EIP-6963)"
            icon={w.info.icon}
            onClick={() => run({kind: "eip6963", uuid: w.info.uuid}, w.info.name)}
          />
        ))}

        {hasInjectedFallback && (
          <WalletOption
            label="Injected wallet"
            hint="Browser wallet detected on window.ethereum"
            onClick={() => run({kind: "injected"}, "Injected wallet")}
          />
        )}

        {wallets.length === 0 && !hasInjectedFallback && (
          <Text size="note" c="dimmed">
            No injected wallet detected. Install MetaMask (or another EIP-6963
            wallet) and add Coston2, or use the demo account below.
          </Text>
        )}

        <WalletOption
          label="Demo account"
          hint="Mocked: no chain, no funds. The real deal, just mocked."
          onClick={() => run({kind: "mock"}, "Demo account")}
        />
      </Stack>
    </Modal>
  );
}

function WalletOption({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        border: "1px solid var(--mantine-color-neutrals-stroke-medium)",
        borderRadius: "var(--mantine-radius-md)",
        padding: "12px 14px",
        cursor: "pointer",
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{minWidth: 0}}>
          {icon && <Image src={icon} w={24} h={24} radius="sm" alt={label} />}
          <div style={{minWidth: 0}}>
            <Text fw={600} truncate>
              {label}
            </Text>
            <Text size="note" c="dimmed" truncate>
              {hint}
            </Text>
          </div>
        </Group>
        <Button size="xs" variant="light" component="span">
          Select
        </Button>
      </Group>
    </UnstyledButton>
  );
}
