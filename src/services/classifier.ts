import type {
    AlgorandIndexerTransaction,
    UnifiedTransaction,
    TxClassification,
} from '@/types'
import { fetchAssetInfo, toStandardUnits, getAssetDisplayName } from './nodely'
import { getProtocolForAppId, GOVERNANCE_NOTE_PREFIXES, isLikelyNFT, ASSET_ID_TO_NAME } from './defi-app-ids'

// ─── Transaction Classifier ─────────────────────────────────────────

/**
 * Classify a raw Algorand indexer transaction into a UnifiedTransaction.
 * Uses the wallet addresses list to determine if transfers are between
 * own wallets or external.
 */
export async function classifyTransaction(
    tx: AlgorandIndexerTransaction,
    ownAddresses: Set<string>,
): Promise<UnifiedTransaction[]> {
    // Global check for Node Validator Heartbeat (Ignore)
    const HEARTBEAT_ADDR = 'GAU5WA6DT2EPFS6LKOA333BQP67NXIHZ7JPOOHMZWJDPZRL4XMHDDDUCKA'
    const receiver = tx['payment-transaction']?.receiver
        ?? tx['asset-transfer-transaction']?.receiver
        ?? undefined

    if (tx.sender === HEARTBEAT_ADDR || receiver === HEARTBEAT_ADDR) {
        return [createUnified(tx, 'app_call', 'ALGO', 'ALGO', 0, receiver, tx.sender, 'Node Validator Heartbeat')]
    }

    const results: UnifiedTransaction[] = []

    switch (tx['tx-type']) {
        case 'pay':
            results.push(await classifyPayment(tx, ownAddresses))
            break
        case 'axfer':
            results.push(await classifyAssetTransfer(tx, ownAddresses))
            break
        case 'appl':
            results.push(...await classifyAppCall(tx, ownAddresses))
            break
        case 'acfg':
            results.push(classifyAssetConfig(tx))
            break
        case 'afrz':
            results.push(classifyAssetFreeze(tx))
            break
        case 'keyreg':
            results.push(classifyKeyReg(tx))
            break
        default:
            results.push(createUnified(tx, 'unknown', 'ALGO', 'ALGO', 0))
    }

    return results
}

/**
 * Batch classify all transactions, resolving asset info as needed.
 */
export async function classifyAllTransactions(
    txns: AlgorandIndexerTransaction[],
    ownAddresses: string[],
): Promise<UnifiedTransaction[]> {
    const addressSet = new Set(ownAddresses.map((a) => a.toUpperCase()))
    const results: UnifiedTransaction[] = []

    for (const tx of txns) {
        try {
            const classified = await classifyTransaction(tx, addressSet)
            results.push(...classified)
        } catch (err) {
            console.warn(`Failed to classify tx ${tx.id}:`, err)
            results.push(createUnified(tx, 'unknown', 'ALGO', 'ALGO', 0))
        }
    }

    // Post-processing: detect swaps that were split into transfer_out + transfer_in/staking_reward
    return detectSwapsInGroups(results)
}

/**
 * Post-processing to link related transactions in a group.
 * Specifically handles the case where a swap is recorded as:
 * 1. Transfer Out (sent asset)
 * 2. Staking Reward OR Transfer In (received asset)
 *
 * This often happens when the protocol doesn't emit inner transactions in a way
 * that `classifyInnerTransactions` automatically catches, or if they appear as
 * top-level siblings in a group.
 */
function detectSwapsInGroups(transactions: UnifiedTransaction[]): UnifiedTransaction[] {
    const groups = new Map<string, UnifiedTransaction[]>()
    const ungrouped: UnifiedTransaction[] = []

    // Group by groupId
    for (const tx of transactions) {
        if (tx.groupId) {
            if (!groups.has(tx.groupId)) groups.set(tx.groupId, [])
            groups.get(tx.groupId)!.push(tx)
        } else {
            ungrouped.push(tx)
        }
    }

    const processed: UnifiedTransaction[] = [...ungrouped]

    for (const group of groups.values()) {
        const transferOut = group.find(t => t.classification === 'transfer_out')
        // Potential swap receive side could be transfer_in or staking_reward (common in some dApps)
        const receiveSide = group.find(t =>
            (t.classification === 'transfer_in' || t.classification === 'staking_reward') &&
            t.notes !== 'Node Validator Heartbeat' // Exclude our heartbeat fix
        )

        // If we have exactly one out and one in/reward in the group, reclassify as swap
        // (Simple heuristic - can be refined if groups get more complex)
        if (transferOut && receiveSide && group.length === 2) {
            transferOut.classification = 'swap'
            transferOut.notes = 'Swap (sent) [Grouped]'

            receiveSide.classification = 'swap'
            receiveSide.notes = 'Swap (received) [Grouped]'
        }

        processed.push(...group)
    }

    return processed.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Re-run classification on existing transactions.
 * Preserves manual classifications and notes if they differ from the original default.
 * (Actually, we generally want to overwrite system notes with new system notes, but keep manual classification).
 */
export async function reclassifyTransactions(
    transactions: UnifiedTransaction[],
    ownAddresses: string[],
): Promise<UnifiedTransaction[]> {
    const algoTxns = transactions.filter(t => t.source === 'algorand' && t.rawData)
    const otherTxns = transactions.filter(t => t.source !== 'algorand' || !t.rawData)

    // Extract raw payloads — CRITICAL: Filter out inner transactions here.
    // Inner transactions are re-generated by the classifier when the parent App Call is processed.
    // If we include them as top-level raw transactions, they get processed twice, potentially
    // with stale ID formats if the logic changed.
    const indexerTxns = algoTxns
        .filter(t => !t.id.includes('/inner/'))
        .map(t => t.rawData as AlgorandIndexerTransaction)

    // Re-run classification
    const reclassified = await classifyAllTransactions(indexerTxns, ownAddresses)

    // Merge preservation logic
    // We want to keep 'manualClassification' from the old transaction if it exists.

    const finalAlgoTxns: UnifiedTransaction[] = []

    // We iterate over the *new* reclassified list to ensure we have the latest shapes.
    // But we need to check if the old one had manual overrides.
    // Wait, `classifyAllTransactions` might return DIFFERENT IDs if logic changes? 
    // Unlikely for Algo, ID is `algo-{txID}`.

    // Use the old map for lookups
    const oldMap = new Map(algoTxns.map(t => [t.id, t]))

    // Handle ID format transition for manual classification preservation
    // Map old format: TXID-inner-i
    // To new format: TXID/inner/i+1
    const getOldTx = (newId: string) => {
        const direct = oldMap.get(newId)
        if (direct) return direct

        const innerMatch = newId.match(/(.+)\/inner\/(\d+)$/)
        if (innerMatch && innerMatch[1] && innerMatch[2]) {
            const parentId = innerMatch[1]
            const indexStr = innerMatch[2]
            const oldId = `${parentId}-inner-${parseInt(indexStr) - 1}`
            return oldMap.get(oldId)
        }

        return undefined
    }

    for (const newTx of reclassified) {
        const oldTx = getOldTx(newTx.id)
        if (oldTx) {
            // Preserve manual classification
            if (oldTx.manualClassification) {
                newTx.manualClassification = oldTx.manualClassification
            }
            // Preserve notes if they were potentially user-edited
            // (Note: Currently we overwrite if they match known system labels, but
            // for now let's just keep the logic minimal to fix the ID issue).
        }
        finalAlgoTxns.push(newTx)
    }


    // Combine with untouched transactions (e.g. Coinbase)
    // Note: This effectively replaces the old Algo txns with new ones.
    return [...otherTxns, ...finalAlgoTxns].sort((a, b) => a.timestamp - b.timestamp)
}

// ─── Payment Transaction ────────────────────────────────────────────
async function classifyPayment(
    tx: AlgorandIndexerTransaction,
    ownAddresses: Set<string>,
): Promise<UnifiedTransaction> {
    const payment = tx['payment-transaction']
    if (!payment) return createUnified(tx, 'unknown', 'ALGO', 'ALGO', 0)

    const amountAlgo = payment.amount / 1_000_000
    const senderOwn = ownAddresses.has(tx.sender.toUpperCase())
    const receiverOwn = ownAddresses.has(payment.receiver.toUpperCase())

    // Check if this is a governance-related tx
    if (isGovernanceTransaction(tx)) {
        if (!senderOwn && receiverOwn) {
            return createUnified(tx, 'governance_reward', 'ALGO', 'ALGO', amountAlgo, payment.receiver, tx.sender)
        }
        return createUnified(tx, 'app_call', 'ALGO', 'ALGO', amountAlgo, payment.receiver, tx.sender)
    }

    // Skip zero-amount non-governance payments (spam / dust)
    if (amountAlgo === 0) {
        return createUnified(tx, 'app_call', 'ALGO', 'ALGO', 0, payment.receiver, tx.sender)
    }

    let classification: TxClassification
    if (senderOwn && receiverOwn) {
        classification = 'transfer_in' // Between own wallets
    } else if (senderOwn) {
        classification = 'transfer_out'
    } else if (receiverOwn) {
        classification = 'transfer_in'
    } else {
        classification = 'unknown'
    }

    return createUnified(tx, classification, 'ALGO', 'ALGO', amountAlgo, payment.receiver, tx.sender)
}

// ─── Asset Transfer ─────────────────────────────────────────────────
async function classifyAssetTransfer(
    tx: AlgorandIndexerTransaction,
    ownAddresses: Set<string>,
): Promise<UnifiedTransaction> {
    const axfer = tx['asset-transfer-transaction']
    if (!axfer) return createUnified(tx, 'unknown', 'ALGO', 'ALGO', 0)

    const assetId = axfer['asset-id']
    const assetName = await resolveAssetName(assetId)
    const decimals = await resolveAssetDecimals(assetId)
    const amount = toStandardUnits(axfer.amount, decimals)

    // Self-transfer with 0 amount = opt-in
    if (axfer.amount === 0 && tx.sender === axfer.receiver) {
        return createUnified(tx, 'opt_in', assetId, assetName, 0, axfer.receiver, tx.sender)
    }

    const senderOwn = ownAddresses.has(tx.sender.toUpperCase())
    const receiverOwn = ownAddresses.has(axfer.receiver.toUpperCase())

    // Check if it's an NFT
    const assetInfo = await fetchAssetInfoSafe(assetId)
    const isNFT = assetInfo && isLikelyNFT(assetInfo.params.total, assetInfo.params.decimals)

    let classification: TxClassification
    if (senderOwn && receiverOwn) {
        classification = 'transfer_in'
    } else if (senderOwn && !receiverOwn) {
        classification = isNFT ? 'nft_sale' : 'transfer_out'
    } else if (!senderOwn && receiverOwn) {
        classification = isNFT ? 'nft_purchase' : 'transfer_in'
    } else {
        classification = 'unknown'
    }

    return createUnified(tx, classification, assetId, assetName, amount, axfer.receiver, tx.sender)
}

// ─── Application Call ───────────────────────────────────────────────
async function classifyAppCall(
    tx: AlgorandIndexerTransaction,
    ownAddresses: Set<string>,
): Promise<UnifiedTransaction[]> {
    const appTx = tx['application-transaction']
    if (!appTx) return [createUnified(tx, 'unknown', 'ALGO', 'ALGO', 0)]

    const appId = appTx['application-id']
    const protocol = getProtocolForAppId(appId)
    const results: UnifiedTransaction[] = []

    // Process inner transactions — these contain the actual asset movements
    if (tx['inner-txns'] && tx['inner-txns'].length > 0) {
        const innerResults = await classifyInnerTransactions(tx, tx['inner-txns'], ownAddresses, protocol)
        results.push(...innerResults)
    }

    // If no inner txns produced results, create a generic app_call entry
    if (results.length === 0) {
        const feeAlgo = tx.fee / 1_000_000
        results.push({
            id: `algo-${tx.id}`,
            source: 'algorand',
            timestamp: tx['round-time'],
            classification: 'app_call',
            fromAddress: tx.sender,
            assetId: 'ALGO',
            assetName: 'ALGO',
            amount: 0,
            feeAlgo,
            txHash: tx.id,
            groupId: tx.group,
            notes: `App call: ${protocol} (${appId})`,
            rawData: tx,
        })
    }

    return results
}

// ─── Inner Transaction Processing ───────────────────────────────────
async function classifyInnerTransactions(
    parentTx: AlgorandIndexerTransaction,
    innerTxns: AlgorandIndexerTransaction[],
    ownAddresses: Set<string>,
    protocol: string,
): Promise<UnifiedTransaction[]> {
    const results: UnifiedTransaction[] = []

    // Analyse all inner txns to detect swap pattern
    const incoming: UnifiedTransaction[] = []
    const outgoing: UnifiedTransaction[] = []

    for (let i = 0; i < innerTxns.length; i++) {
        const inner = innerTxns[i]!
        let classified: UnifiedTransaction

        if (inner['tx-type'] === 'pay') {
            const amount = (inner['payment-transaction']?.amount ?? 0) / 1_000_000
            const receiver = inner['payment-transaction']?.receiver ?? ''
            classified = createUnified(
                { ...inner, id: `${parentTx.id}/inner/${i + 1}`, 'round-time': parentTx['round-time'], group: parentTx.group },
                'unknown', 'ALGO', 'ALGO', amount, receiver, inner.sender
            )

        } else if (inner['tx-type'] === 'axfer') {
            const axfer = inner['asset-transfer-transaction']
            if (!axfer) continue
            const assetId = axfer['asset-id']
            const assetName = await resolveAssetName(assetId)
            const decimals = await resolveAssetDecimals(assetId)
            const amount = toStandardUnits(axfer.amount, decimals)
            classified = createUnified(
                { ...inner, id: `${parentTx.id}/inner/${i + 1}`, 'round-time': parentTx['round-time'], group: parentTx.group },
                'unknown', assetId, assetName, amount, axfer.receiver, inner.sender
            )

        } else {
            continue
        }

        const receiverOwn = classified.toAddress ? ownAddresses.has(classified.toAddress.toUpperCase()) : false
        const senderOwn = classified.fromAddress ? ownAddresses.has(classified.fromAddress.toUpperCase()) : false

        if (receiverOwn && !senderOwn) {
            incoming.push(classified)
        } else if (senderOwn && !receiverOwn) {
            outgoing.push(classified)
        }
    }

    // Detect swap pattern: we sent one asset and received another
    if (incoming.length > 0 && outgoing.length > 0) {
        // This is a swap — mark outgoing as sell-side and incoming as buy-side
        for (const out of outgoing) {
            out.classification = 'swap'
            out.notes = `${protocol} swap (sent)`
            results.push(out)
        }
        for (const inc of incoming) {
            inc.classification = 'swap'
            inc.notes = `${protocol} swap (received)`
            results.push(inc)
        }
    } else if (incoming.length > 0 && outgoing.length === 0) {
        // Received only — could be reward claim, LP removal, etc.
        for (const inc of incoming) {
            if (protocol === 'governance') {
                inc.classification = 'governance_reward'
            } else {
                inc.classification = 'staking_reward'
            }
            inc.notes = `${protocol} reward/withdrawal`
            results.push(inc)
        }
    } else if (outgoing.length > 0 && incoming.length === 0) {
        // Sent only — deposit, LP add, etc.
        for (const out of outgoing) {
            out.classification = 'app_call'
            out.notes = `${protocol} deposit/action`
            results.push(out)
        }
    }

    return results
}

// ─── Asset Config ───────────────────────────────────────────────────
function classifyAssetConfig(tx: AlgorandIndexerTransaction): UnifiedTransaction {
    const acfg = tx['asset-config-transaction']
    const isCreation = tx['created-asset-index'] !== undefined

    if (isCreation && acfg?.params) {
        const isNFT = isLikelyNFT(acfg.params.total ?? 0, acfg.params.decimals ?? 0)
        if (isNFT) {
            return createUnified(tx, 'nft_mint', tx['created-asset-index']!, acfg.params.name ?? 'NFT', 1)
        }
    }

    return createUnified(tx, 'app_call', 'ALGO', 'ALGO', 0)
}

// ─── Asset Freeze (non-taxable) ─────────────────────────────────────
function classifyAssetFreeze(tx: AlgorandIndexerTransaction): UnifiedTransaction {
    return createUnified(tx, 'app_call', 'ALGO', 'ALGO', 0, undefined, tx.sender)
}

// ─── Key Registration (non-taxable) ─────────────────────────────────
function classifyKeyReg(tx: AlgorandIndexerTransaction): UnifiedTransaction {
    return createUnified(tx, 'app_call', 'ALGO', 'ALGO', 0, undefined, tx.sender)
}

// ─── Governance Detection ───────────────────────────────────────────
function isGovernanceTransaction(tx: AlgorandIndexerTransaction): boolean {
    if (!tx.note) return false
    try {
        const decoded = atob(tx.note)
        return GOVERNANCE_NOTE_PREFIXES.some((prefix) => decoded.startsWith(prefix))
    } catch {
        return false
    }
}

// ─── Helper: Create Unified Transaction ─────────────────────────────
function createUnified(
    tx: AlgorandIndexerTransaction,
    classification: TxClassification,
    assetId: number | 'ALGO',
    assetName: string,
    amount: number,
    toAddress?: string,
    fromAddress?: string,
    notes?: string,
): UnifiedTransaction {
    return {
        id: `algo-${tx.id}`,
        source: 'algorand',
        timestamp: tx['round-time'],
        classification,
        fromAddress: fromAddress ?? tx.sender,
        toAddress,
        assetId,
        assetName,
        amount,
        feeAlgo: tx.fee / 1_000_000,
        txHash: tx.id,
        groupId: tx.group,
        rawData: tx,
        notes,
    }
}

// ─── Helper: Resolve Asset Info ─────────────────────────────────────
async function resolveAssetName(assetId: number): Promise<string> {
    // Check known assets first
    const known = ASSET_ID_TO_NAME[assetId]
    if (known) return known

    try {
        const info = await fetchAssetInfo(assetId)
        return getAssetDisplayName(info)
    } catch {
        return `ASA #${assetId}`
    }
}

async function resolveAssetDecimals(assetId: number): Promise<number> {
    try {
        const info = await fetchAssetInfo(assetId)
        return info.params.decimals
    } catch {
        // Default to 0 decimals for missing assets (most likely deleted NFTs)
        return 0
    }
}

async function fetchAssetInfoSafe(assetId: number) {
    try {
        return await fetchAssetInfo(assetId)
    } catch {
        return null
    }
}
