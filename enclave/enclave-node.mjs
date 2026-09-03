// Enclave node: sign the epoch attestation with the co-located tee-node,
// then commit on-chain. The tee-node holds the key; this process pays gas.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {JsonRpcProvider, Wallet, Contract, getAddress, AbiCoder} from "ethers";
import {manifestHash, indexOutputRoot, seriesId, attestationMessage} from "./deterministic.mjs";
import {teeSign} from "./teesign.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();

const NAME = process.env.NODE_NAME ?? "enclave";
const RPC = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const REGISTRY = process.env.REGISTRY;
const GAS_KEY = process.env.GAS_KEY;
const TEE_SIGN_URL = process.env.TEE_SIGN_URL ?? "http://127.0.0.1:7701/sign";
const MEASUREMENT = process.env.MEASUREMENT;
const EPOCH = BigInt(process.env.EPOCH ?? "1");

const ABI = [
    "function submitEpoch((bytes32,uint64,bytes32,bytes32,bytes32,uint64),bytes) external",
    "function registerEnclaveWithQuote(bytes) external",
    "function enclaveMeasurement(address) view returns (bytes32)",
    "function allowedCode(bytes32) view returns (bool)",
    "function isFinalized(bytes32,uint64) view returns (bool)",
    "function outputRootOf(bytes32,uint64) view returns (bytes32)",
];

const log = (m) => process.stdout.write(`[${NAME}] ${m}\n`);

async function main() {
    if (!REGISTRY || !GAS_KEY || !MEASUREMENT)
        throw new Error("REGISTRY, GAS_KEY, MEASUREMENT required");
    const inputs = JSON.parse(readFileSync(join(__dirname, "inputs.json"), "utf8"));

    const provider = new JsonRpcProvider(RPC);
    const gas = new Wallet(GAS_KEY, provider);
    const reg = new Contract(REGISTRY, ABI, gas);

    const att = {
        seriesId: seriesId(inputs.seriesName),
        epochId: EPOCH,
        manifestHash: manifestHash(inputs.manifest),
        outputRoot: indexOutputRoot(inputs.rows),
        codeMeasurement: MEASUREMENT,
        producedAt: BigInt(inputs.producedAt),
    };
    log(`epoch ${EPOCH} outputRoot=${att.outputRoot}`);

    log(`requesting signature from tee-node at ${TEE_SIGN_URL} ...`);
    const {sig, recovered} = await teeSign(TEE_SIGN_URL, attestationMessage(att));
    const teeSigner = getAddress(recovered);
    log(`tee-node signed; recovered signer=${teeSigner}`);

    if (!(await reg.allowedCode(MEASUREMENT)))
        throw new Error(`measurement ${MEASUREMENT} not allow-listed`);
    const cur = await reg.enclaveMeasurement(teeSigner);
    if (cur.toLowerCase() !== MEASUREMENT.toLowerCase()) {
        const quote = abi.encode(["address", "bytes32"], [teeSigner, MEASUREMENT]);
        const tx = await reg.registerEnclaveWithQuote(quote);
        await tx.wait();
        log(`registered tee signer via quote (tx ${tx.hash})`);
    } else {
        log("tee signer already registered");
    }

    const tuple = [att.seriesId, att.epochId, att.manifestHash, att.outputRoot, att.codeMeasurement, att.producedAt];
    const tx = await reg.submitEpoch(tuple, sig);
    const rc = await tx.wait();
    const finalized = await reg.isFinalized(att.seriesId, EPOCH);
    log(`submitEpoch tx ${rc.hash}; finalized=${finalized}`);
    if (finalized) log(`EPOCH ${EPOCH} FINALIZED; root=${await reg.outputRootOf(att.seriesId, EPOCH)}`);
    else log("submitted; waiting for the other enclave");
}

main().catch((e) => {
    process.stderr.write(`[${NAME}] fatal: ${String(e.shortMessage ?? e)}\n`);
    process.exit(1);
});
