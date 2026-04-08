import type { UnifiedTransaction, TxClassification, KoinlyExportOptions } from '@/types'


export interface KoinlyExportStats {
    total: number
    exported: number
    excludedDust: number
    excludedOwnTransfers: number
    excludedZeroAmount: number
    excludedOptIns: number
    excludedAppCalls: number
    excludedNFTs: number
    excludedASAs: number
    mergedSwaps: number
    excludedASAMapping: Record<string, { name: string; count: number }>
}

export interface MergedSwapRow {
    timestamp: number
    sentAmount: number
    sentCurrency: string
    receivedAmount: number
    receivedCurrency: string
    feeAmount: number
    feeCurrency: string
    txHash: string
    walletAddress?: string
    description: string
    label: string
}

export type ProcessedExportRow = UnifiedTransaction | MergedSwapRow

interface CoinTrackerRow {
    sortTimestamp: number
    date: string
    receivedQuantity: string
    receivedCurrency: string
    sentQuantity: string
    sentCurrency: string
    feeAmount: string
    feeCurrency: string
    tag: string
    transactionId: string
}

function isMergedSwapRow(row: ProcessedExportRow): row is MergedSwapRow {
    return 'sentAmount' in row
}

/**
 * Filter transactions for Koinly export and collect stats
 */
export function filterForKoinly(
    txns: UnifiedTransaction[],
    ownAddresses: string[],
    options: KoinlyExportOptions
): { filtered: UnifiedTransaction[]; stats: KoinlyExportStats } {
    const ownSet = new Set(ownAddresses.map(a => a.toUpperCase()))
    const whitelist = new Set(options.whitelistedAssetIds || [])

    const stats: KoinlyExportStats = {
        total: txns.length,
        exported: 0,
        excludedDust: 0,
        excludedOwnTransfers: 0,
        excludedZeroAmount: 0,
        excludedOptIns: 0,
        excludedAppCalls: 0,
        excludedNFTs: 0,
        excludedASAs: 0,
        mergedSwaps: 0,
        excludedASAMapping: {},
    }

    const filtered = txns.filter(tx => {
        const classification = tx.manualClassification ?? tx.classification

        // Exclude Dust (ALGO only, or micro assets)
        if (tx.assetId === 'ALGO' && tx.amount < options.dustThreshold) {
            stats.excludedDust++
            return false
        }

        // Exclude Zero Amount
        if (options.excludeZeroAmount && tx.amount === 0 && classification !== 'opt_in' && classification !== 'app_call') {
            stats.excludedZeroAmount++
            return false
        }

        // Exclude Opt-ins
        if (options.excludeOptIns && classification === 'opt_in') {
            stats.excludedOptIns++
            return false
        }

        // Exclude App Calls (amount 0)
        if (classification === 'app_call' && tx.amount === 0) {
            stats.excludedAppCalls++
            return false
        }

        // Exclude Own-wallet transfers
        if (options.excludeOwnTransfers && (classification === 'transfer_in' || classification === 'transfer_out')) {
            const senderOwn = tx.fromAddress ? ownSet.has(tx.fromAddress.toUpperCase()) : false
            const receiverOwn = tx.toAddress ? ownSet.has(tx.toAddress.toUpperCase()) : false
            if (senderOwn && receiverOwn) {
                stats.excludedOwnTransfers++
                return false
            }
        }

        // Exclude NFTs
        if (options.excludeNFTs && (classification === 'nft_purchase' || classification === 'nft_sale' || classification === 'nft_mint')) {
            stats.excludedNFTs++
            return false
        }

        // Exclude ASAs (non-ALGO)
        if (options.excludeASAs && tx.assetId !== 'ALGO') {
            // Check whitelist
            if (whitelist.has(tx.assetId)) {
                return true
            }

            // Track stats
            stats.excludedASAs++
            const assetKey = tx.assetId.toString()
            if (!stats.excludedASAMapping[assetKey]) {
                stats.excludedASAMapping[assetKey] = { name: tx.assetName, count: 0 }
            }
            stats.excludedASAMapping[assetKey].count++
            return false
        }

        return true
    })

    return { filtered, stats }
}

/**
 * Merge swap pairs (sent/received) into single Koinly rows
 */
export function mergeSwapPairs(txns: UnifiedTransaction[], ownAddresses: string[]): { merged: ProcessedExportRow[]; count: number } {
    const result: ProcessedExportRow[] = []
    const groups = new Map<string, UnifiedTransaction[]>()
    let mergedCount = 0

    // Group by groupId for swap detection
    for (const tx of txns) {
        if (tx.groupId && (tx.manualClassification ?? tx.classification) === 'swap') {
            if (!groups.has(tx.groupId)) groups.set(tx.groupId, [])
            groups.get(tx.groupId)!.push(tx)
        } else {
            result.push(tx)
        }
    }


    for (const group of groups.values()) {
        if (group.length >= 2) {
            const sent = group.find(t => t.notes?.includes('(sent)'))
            const received = group.find(t => t.notes?.includes('(received)'))

            if (sent && received) {
                const ownSet = new Set(ownAddresses.map((a: string) => a.toUpperCase()))
                const walletAddress = (sent.fromAddress && ownSet.has(sent.fromAddress.toUpperCase()))
                    ? sent.fromAddress
                    : (received.toAddress && ownSet.has(received.toAddress.toUpperCase()))
                        ? received.toAddress
                        : sent.fromAddress

                result.push({
                    timestamp: sent.timestamp,
                    sentAmount: sent.amount,
                    sentCurrency: sent.assetName,
                    receivedAmount: received.amount,
                    receivedCurrency: received.assetName,
                    feeAmount: sent.feeAlgo + received.feeAlgo,
                    feeCurrency: 'ALGO',
                    txHash: sent.txHash,
                    walletAddress,
                    description: `Swap via ${sent.notes?.split(' ')[0] ?? 'DEX'}`,
                    label: '',
                })
                continue
            }
        }
        // If not a clean pair, push individuals
        result.push(...group)
    }

    return {
        merged: result.sort((a, b) => a.timestamp - b.timestamp),
        count: mergedCount
    }
}

/**
 * Map our classification to Koinly labels
 */
function mapToKoinlyLabel(classification: TxClassification): string {
    switch (classification) {
        case 'staking_reward':
        case 'governance_reward':
            return 'reward'
        case 'airdrop':
            return 'airdrop'
        case 'income_other':
            return 'income'
        case 'lp_add':
        case 'lp_remove':
            return 'stake'
        default:
            return ''
    }
}

/**
 * Generate CSV string in Koinly Universal format
 */
export function toKoinlyCSV(processedRows: ProcessedExportRow[]): string {
    const headers = [
        'Date',
        'Sent Amount',
        'Sent Currency',
        'Received Amount',
        'Received Currency',
        'Fee Amount',
        'Fee Currency',
        'Net Worth Amount',
        'Net Worth Currency',
        'Label',
        'Description',
        'TxHash'
    ]

    const escapeCSV = (value: string): string => {
        if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
            return `"${value.replace(/"/g, '""')}"`
        }
        return value
    }

    const rows = processedRows.map(row => {
        // Common fields
        const date = new Date(row.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
        const txHash = row.txHash ?? ''
        const description = isMergedSwapRow(row) ? row.description : (row.notes ?? '')
        const label = isMergedSwapRow(row) ? row.label : (row.classification ? mapToKoinlyLabel(row.classification) : '')

        // If it's a merged swap row
        if (isMergedSwapRow(row)) {
            return [
                date,
                row.sentAmount.toFixed(8),
                row.sentCurrency,
                row.receivedAmount.toFixed(8),
                row.receivedCurrency,
                row.feeAmount.toFixed(8),
                row.feeCurrency,
                '',
                '',
                label,
                description,
                txHash
            ]
        }

        // Regular unified transaction
        const classification = row.manualClassification ?? row.classification
        let sentAmount = ''
        let sentCurrency = ''
        let receivedAmount = ''
        let receivedCurrency = ''

        const isOut = ['sell', 'transfer_out', 'nft_sale', 'lp_add'].includes(classification)
        const isIn = ['buy', 'transfer_in', 'nft_purchase', 'nft_mint', 'staking_reward', 'governance_reward', 'airdrop', 'income_other', 'lp_remove'].includes(classification)

        if (isOut) {
            sentAmount = row.amount.toFixed(8)
            sentCurrency = row.assetName
        } else if (isIn) {
            receivedAmount = row.amount.toFixed(8)
            receivedCurrency = row.assetName
        }

        const feeAmount = row.feeAlgo > 0 ? row.feeAlgo.toFixed(8) : ''
        const feeCurrency = row.feeAlgo > 0 ? 'ALGO' : ''

        return [
            date,
            sentAmount,
            sentCurrency,
            receivedAmount,
            receivedCurrency,
            feeAmount,
            feeCurrency,
            '',
            '',
            label,
            description,
            txHash
        ]
    })

    return [
        headers.join(','),
        ...rows.map(r => r.map(v => escapeCSV(String(v ?? ''))).join(','))
    ].join('\n')
}

function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

function formatCoinTrackerDate(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    const pad = (value: number) => String(value).padStart(2, '0')

    return [
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        date.getUTCFullYear(),
    ].join('/') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function formatQuantity(value: number): string {
    return Number.isFinite(value) ? String(value) : ''
}

function buildCoinTrackerRow(row: CoinTrackerRow): string {
    return [
        row.date,
        row.receivedQuantity,
        row.receivedCurrency,
        row.sentQuantity,
        row.sentCurrency,
        row.feeAmount,
        row.feeCurrency,
        row.tag,
        row.transactionId,
    ].map(value => escapeCSV(value)).join(',')
}

function mapSingleTransactionToCoinTrackerRow(tx: UnifiedTransaction): CoinTrackerRow {
    const classification = tx.manualClassification ?? tx.classification
    const isOut = ['sell', 'transfer_out', 'nft_sale', 'lp_add'].includes(classification)
    const isIn = ['buy', 'transfer_in', 'nft_purchase', 'nft_mint', 'staking_reward', 'governance_reward', 'airdrop', 'income_other', 'lp_remove'].includes(classification)

    return {
        sortTimestamp: tx.timestamp,
        date: formatCoinTrackerDate(tx.timestamp),
        receivedQuantity: isIn ? formatQuantity(tx.amount) : '',
        receivedCurrency: isIn ? tx.assetName : '',
        sentQuantity: isOut ? formatQuantity(tx.amount) : '',
        sentCurrency: isOut ? tx.assetName : '',
        feeAmount: tx.feeAlgo > 0 ? formatQuantity(tx.feeAlgo) : '',
        feeCurrency: tx.feeAlgo > 0 ? 'ALGO' : '',
        tag: '',
        transactionId: tx.txHash ?? '',
    }
}

function buildCoinTrackerRowsForSwapGroup(group: UnifiedTransaction[]): CoinTrackerRow[] {
    const sentLegs = group.filter(tx => tx.notes?.includes('(sent)'))
    const receivedLegs = group.filter(tx => tx.notes?.includes('(received)'))

    if (sentLegs.length === 0 || receivedLegs.length === 0) {
        return group.map(mapSingleTransactionToCoinTrackerRow)
    }

    const referenceTx = sentLegs[0] ?? receivedLegs[0]
    if (!referenceTx) {
        return group.map(mapSingleTransactionToCoinTrackerRow)
    }
    const rows: CoinTrackerRow[] = receivedLegs.map(tx => ({
        sortTimestamp: tx.timestamp,
        date: formatCoinTrackerDate(tx.timestamp),
        receivedQuantity: formatQuantity(tx.amount),
        receivedCurrency: tx.assetName,
        sentQuantity: '',
        sentCurrency: '',
        feeAmount: '',
        feeCurrency: '',
        tag: '',
        transactionId: tx.txHash ?? referenceTx.txHash ?? '',
    }))

    sentLegs.forEach((tx, index) => {
        rows.push({
            sortTimestamp: tx.timestamp,
            date: formatCoinTrackerDate(tx.timestamp),
            receivedQuantity: '',
            receivedCurrency: '',
            sentQuantity: formatQuantity(tx.amount),
            sentCurrency: tx.assetName,
            feeAmount: index === 0 && tx.feeAlgo > 0 ? formatQuantity(tx.feeAlgo) : '',
            feeCurrency: index === 0 && tx.feeAlgo > 0 ? 'ALGO' : '',
            tag: '',
            transactionId: tx.txHash ?? referenceTx.txHash ?? '',
        })
    })

    return rows
}

export function exportCoinTracker(transactions: UnifiedTransaction[]): string {
    const headers = [
        'Date',
        'Received Quantity',
        'Received Currency',
        'Sent Quantity',
        'Sent Currency',
        'Fee Amount',
        'Fee Currency',
        'Tag',
        'Transaction ID',
    ]

    const groupedSwaps = new Map<string, UnifiedTransaction[]>()
    const ungroupedRows: CoinTrackerRow[] = []

    for (const tx of transactions) {
        const classification = tx.manualClassification ?? tx.classification
        if (tx.groupId && classification === 'swap') {
            if (!groupedSwaps.has(tx.groupId)) {
                groupedSwaps.set(tx.groupId, [])
            }
            groupedSwaps.get(tx.groupId)!.push(tx)
            continue
        }

        ungroupedRows.push(mapSingleTransactionToCoinTrackerRow(tx))
    }

    const swapRows = Array.from(groupedSwaps.values())
        .sort((a, b) => (a[0]?.timestamp ?? 0) - (b[0]?.timestamp ?? 0))
        .flatMap(buildCoinTrackerRowsForSwapGroup)

    return [
        headers.join(','),
        ...[...ungroupedRows, ...swapRows]
            .sort((a, b) => a.sortTimestamp - b.sortTimestamp)
            .map(buildCoinTrackerRow),
    ].join('\n')
}
