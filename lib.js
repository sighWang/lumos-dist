"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.capacityOf = exports.transfer = exports.asyncSleep = exports.ethereum = exports.CONFIG = void 0;
const lumos_1 = lumos;
const omni_1 = require("./generated/omni");
exports.CONFIG = lumos_1.config.createConfig({
    PREFIX: "ckt",
    SCRIPTS: {
        ...lumos_1.config.predefined.AGGRON4.SCRIPTS,
        // for more about Omni lock, please check https://github.com/XuJiandong/docs-bank/blob/master/omni_lock.md
        OMNI_LOCK: {
            CODE_HASH: "0x79f90bb5e892d80dd213439eeab551120eb417678824f282b4ffb5f21bad2e1e",
            HASH_TYPE: "type",
            TX_HASH: "0x9154df4f7336402114d04495175b37390ce86a4906d2d4001cf02c3e6d97f39c",
            INDEX: "0x0",
            DEP_TYPE: "code",
        },
    },
});
lumos_1.config.initializeConfig(exports.CONFIG);
const CKB_RPC_URL = "https://testnet.ckb.dev/rpc";
const CKB_INDEXER_URL = "https://testnet.ckb.dev/indexer";
const rpc = new lumos_1.RPC(CKB_RPC_URL);
const indexer = new lumos_1.Indexer(CKB_INDEXER_URL, CKB_RPC_URL);
// @ts-ignore
exports.ethereum = window.ethereum;
function asyncSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.asyncSleep = asyncSleep;
async function transfer(options) {
    let tx = lumos_1.helpers.TransactionSkeleton({});
    const fromScript = lumos_1.helpers.parseAddress(options.from);
    const toScript = lumos_1.helpers.parseAddress(options.to);
    // additional 0.001 ckb for tx fee
    // the tx fee could calculated by tx size
    // this is just a simple example
    const neededCapacity = BigInt(options.amount) + /*0.00*/ 100000n;
    let collectedSum = 0n;
    const collectedCells = [];
    const collector = indexer.collector({ lock: fromScript, type: "empty" });
    for await (const cell of collector.collect()) {
        collectedSum += BigInt(cell.cell_output.capacity);
        collectedCells.push(cell);
        if (collectedSum >= neededCapacity)
            break;
    }
    if (collectedSum < neededCapacity) {
        throw new Error(`Not enough CKB, expected: ${neededCapacity}, actual: ${collectedSum} `);
    }
    const transferOutput = {
        cell_output: {
            capacity: "0x" + BigInt(options.amount).toString(16),
            lock: toScript,
        },
        data: "0x",
    };
    const changeOutput = {
        cell_output: {
            capacity: "0x" + BigInt(collectedSum - neededCapacity).toString(16),
            lock: fromScript,
        },
        data: "0x",
    };
    tx = tx.update("inputs", (inputs) => inputs.push(...collectedCells));
    tx = tx.update("outputs", (outputs) => outputs.push(transferOutput, changeOutput));
    tx = tx.update("cellDeps", (cellDeps) => cellDeps.push(
    // omni lock dep
    {
        out_point: {
            tx_hash: exports.CONFIG.SCRIPTS.OMNI_LOCK.TX_HASH,
            index: exports.CONFIG.SCRIPTS.OMNI_LOCK.INDEX,
        },
        dep_type: exports.CONFIG.SCRIPTS.OMNI_LOCK.DEP_TYPE,
    }, 
    // SECP256K1 lock is depended by omni lock
    {
        out_point: {
            tx_hash: exports.CONFIG.SCRIPTS.SECP256K1_BLAKE160.TX_HASH,
            index: exports.CONFIG.SCRIPTS.SECP256K1_BLAKE160.INDEX,
        },
        dep_type: exports.CONFIG.SCRIPTS.SECP256K1_BLAKE160.DEP_TYPE,
    }));
    const messageForSigning = (() => {
        const hasher = new lumos_1.utils.CKBHasher();
        const rawTxHash = lumos_1.utils.ckbHash(lumos_1.core.SerializeRawTransaction(lumos_1.toolkit.normalizers.NormalizeRawTransaction(lumos_1.helpers.createTransactionFromSkeleton(tx))));
        // serialized unsigned witness
        const serializedWitness = lumos_1.core.SerializeWitnessArgs({
            lock: new lumos_1.toolkit.Reader("0x" +
                "00".repeat((0, omni_1.SerializeRcLockWitnessLock)({
                    signature: new lumos_1.toolkit.Reader("0x" + "00".repeat(65)),
                }).byteLength)),
        });
        hasher.update(rawTxHash);
        hashWitness(hasher, serializedWitness);
        return hasher.digestHex();
    })();
    let signedMessage = await exports.ethereum.request({
        method: "personal_sign",
        params: [exports.ethereum.selectedAddress, messageForSigning],
    });
    let v = Number.parseInt(signedMessage.slice(-2), 16);
    if (v >= 27)
        v -= 27;
    signedMessage = "0x" + signedMessage.slice(2, -2) + v.toString(16).padStart(2, "0");
    const signedWitness = new lumos_1.toolkit.Reader(lumos_1.core.SerializeWitnessArgs({
        lock: (0, omni_1.SerializeRcLockWitnessLock)({
            signature: new lumos_1.toolkit.Reader(signedMessage),
        }),
    })).serializeJson();
    tx = tx.update("witnesses", (witnesses) => witnesses.push(signedWitness));
    const signedTx = lumos_1.helpers.createTransactionFromSkeleton(tx);
    const txHash = await rpc.send_transaction(signedTx, "passthrough");
    return txHash;
}
exports.transfer = transfer;
function hashWitness(hasher, witness) {
    const lengthBuffer = new ArrayBuffer(8);
    const view = new DataView(lengthBuffer);
    view.setBigUint64(0, BigInt(new lumos_1.toolkit.Reader(witness).length()), true);
    hasher.update(lengthBuffer);
    hasher.update(witness);
}
async function capacityOf(address) {
    const collector = indexer.collector({
        lock: lumos_1.helpers.parseAddress(address),
    });
    let balance = 0n;
    for await (const cell of collector.collect()) {
        balance += BigInt(cell.cell_output.capacity);
    }
    return balance;
}
exports.capacityOf = capacityOf;
//# sourceMappingURL=lib.js.map