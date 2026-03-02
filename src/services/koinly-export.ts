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
export function mergeSwapPairs(txns: UnifiedTransaction[], ownAddresses: string[]): { merged: any[]; count: number } {
    const result: any[] = []
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
export function toKoinlyCSV(processedRows: any[]): string {
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
        const description = row.description ?? row.notes ?? ''
        const label = row.label ?? (row.classification ? mapToKoinlyLabel(row.classification) : '')

        // If it's a merged swap row
        if ('sentAmount' in row) {
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
