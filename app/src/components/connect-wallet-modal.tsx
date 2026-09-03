import {Button, Group, Modal, Stack, Text, UnstyledButton} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {useWallet} from "@/core/wallet-context.tsx";

// The connect-wallet modal LOOK, lifted from the template's multi-step modal
// but wired to the EVM seam (mock by default, injected wallet if present). No
// XRPL plumbing: two entry points, an injected EVM wallet and a demo (mock)
// account.
export function ConnectWalletModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const {connect} = useWallet();

  const pick = async (mode: "injected" | "mock") => {
    await connect(mode);
    notifications.show({
      color: "green",
      message: mode === "injected" ? "Wallet connected" : "Demo account connected (mock)",
    });
    onClose();
  };

  const injectedAvailable =
    typeof window !== "undefined" && Boolean((window as any).ethereum);

  return (
    <Modal opened={opened} onClose={onClose} centered title="Connect wallet" radius="md">
      <Stack gap="sm">
        <Text size="sBody" c="dimmed">
          Deposits run on an EVM seam on Coston2. Connect an injected wallet for a
          real testnet deposit, or use the demo account to explore the flow.
        </Text>
        <WalletOption
          label="Injected EVM wallet"
          hint={injectedAvailable ? "MetaMask / browser wallet detected" : "No injected wallet found"}
          disabled={!injectedAvailable}
          onClick={() => pick("injected")}
        />
        <WalletOption
          label="Demo account"
          hint="Mocked: no chain, no funds. The real deal, just mocked."
          onClick={() => pick("mock")}
        />
      </Stack>
    </Modal>
  );
}

function WalletOption({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <UnstyledButton
      onClick={disabled ? undefined : onClick}
      style={{
        border: "1px solid var(--mantine-color-neutrals-stroke-medium)",
        borderRadius: "var(--mantine-radius-md)",
        padding: "12px 14px",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <Group justify="space-between">
        <div>
          <Text fw={600}>{label}</Text>
          <Text size="note" c="dimmed">
            {hint}
          </Text>
        </div>
        {!disabled && (
          <Button size="xs" variant="light" component="span">
            Select
          </Button>
        )}
      </Group>
    </UnstyledButton>
  );
}
