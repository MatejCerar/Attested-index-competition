// Sign via the real Flare tee-node /sign (loopback). The key stays in the
// TEE; we recover the signer locally to learn and self-check it.
import {getBytes, keccak256, toUtf8Bytes, verifyMessage} from "ethers";

export async function teeSign(signUrl, messageHex, retries = 30) {
    const bytes = getBytes(messageHex);
    const messageB64 = Buffer.from(bytes).toString("base64");

    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(signUrl, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({message: messageB64}),
            });
            if (!res.ok) throw new Error(`tee /sign ${res.status}: ${await res.text()}`);
            const j = await res.json();
            const sig = Buffer.from(j.signature, "base64");
            if (sig.length !== 65) throw new Error(`bad sig length ${sig.length}`);
            if (sig[64] < 27) sig[64] += 27; // normalize v to 27/28
            const sigHex = "0x" + sig.toString("hex");
            const inner = keccak256(messageHex);
            const recovered = verifyMessage(getBytes(inner), sigHex);
            return {sig: sigHex, recovered};
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 1000)); // tee-node still booting
        }
    }
    throw lastErr;
}

// Sign a JSON envelope through the enclave INDEX/REBALANCE op (gateway /sign
// forwards the utf8 JSON bytes as originalMessage; the extension recomputes
// the deterministic build and refuses non-matching weights). The signature is
// EIP-191 over digestHex (keccak256 of the abi rebalance preimage), so we
// recover against THAT, not the envelope bytes.
export async function teeSignEnvelope(signUrl, envelope, digestHex, retries = 30) {
    const messageB64 = Buffer.from(toUtf8Bytes(JSON.stringify(envelope))).toString("base64");
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(signUrl, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({message: messageB64}),
            });
            if (!res.ok) throw new Error(`tee /sign ${res.status}: ${await res.text()}`);
            const j = await res.json();
            const sig = Buffer.from(j.signature, "base64");
            if (sig.length !== 65) throw new Error(`bad sig length ${sig.length}`);
            if (sig[64] < 27) sig[64] += 27;
            const sigHex = "0x" + sig.toString("hex");
            const recovered = verifyMessage(getBytes(digestHex), sigHex);
            return {sig: sigHex, recovered};
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    throw lastErr;
}
