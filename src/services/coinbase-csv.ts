import Papa from 'papaparse'
import type { UnifiedTransaction, TxClassification } from '@/types'

// ─── Coinbase CSV Column Names ──────────────────────────────────────
interface CoinbaseRow {
    Timestamp: string
    'Transaction Type': string
    Asset: string
    'Quantity Transacted': string
    'Spot Price Currency': string
    'Spot Price at Transaction': string
    Subtotal: string
    'Total (inclusive of fees and/or spread)': string
    'Fees and/or Spread': string
    Notes: string
}

// ─── Type Mapping ───────────────────────────────────────────────────
const COINBASE_TYPE_MAP: Record<string, TxClassification> = {
    'Buy': 'buy',
    'Sell': 'sell',
    'Send': 'transfer_out',
    'Receive': 'transfer_in',
    'Convert': 'swap',
    'Staking Income': 'staking_reward',
    'Rewards Income': 'staking_reward',
    'Coinbase Earn': 'airdrop',
    'Learning Reward': 'airdrop',
    'Advance Trade Buy': 'buy',
    'Advance Trade Sell': 'sell',
    'Advanced Trade Buy': 'buy',
    'Advanced Trade Sell': 'sell',
}

// ─── CSV Parser ─────────────────────────────────────────────────────

/**
 * Parse a Coinbase CSV file into UnifiedTransactions.
 * The CSV file should be the "Transaction History" export from Coinbase.
 */
export function parseCoinbaseCSV(
    csvContent: string,
    usdToAudRate?: number // Fallback FX rate if not available per-row
): { transactions: UnifiedTransaction[]; errors: string[] } {
    const errors: string[] = []

    // Coinbase CSVs sometimes have header rows that aren't the actual column names
    // Find the actual header row (contains "Timestamp")
    const lines = csvContent.split('\n')
    let headerIndex = 0
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
        if (lines[i]?.includes('Timestamp')) {
            headerIndex = i
            break
        }
    }

    // Rejoin from the header row
    const cleanCSV = lines.slice(headerIndex).join('\n')

    const parsed = Papa.parse<CoinbaseRow>(cleanCSV, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
    })

    if (parsed.errors.length > 0) {
        errors.push(...parsed.errors.map((e) => `Row ${e.row}: ${e.message}`))
    }

    const transactions: UnifiedTransaction[] = []
    const defaultFx = usdToAudRate ?? 1.55 // Approximate USD/AUD rate

    for (const row of parsed.data) {
        try {
            const txType = row['Transaction Type']?.trim()
            if (!txType) continue

            const classification = COINBASE_TYPE_MAP[txType] ?? 'unknown'
            const asset = row.Asset?.trim() ?? 'UNKNOWN'
            const quantity = parseFloat(row['Quantity Transacted'] ?? '0')
            const spotPrice = parseFloat(row['Spot Price at Transaction'] ?? '0')
            const fees = parseFloat(row['Fees and/or Spread'] ?? '0')
            const total = parseFloat(row['Total (inclusive of fees and/or spread)'] ?? '0')
            const timestamp = parseTimestamp(row.Timestamp)
            const currency = row['Spot Price Currency']?.trim() ?? 'USD'

            if (isNaN(timestamp)) {
                errors.push(`Invalid timestamp: ${row.Timestamp}`)
                continue
            }

            // Convert to AUD if price is in USD
            const fxRate = currency === 'AUD' ? 1 : defaultFx
            const audSpotPrice = spotPrice * fxRate
            const audValue = quantity * audSpotPrice

            const tx: UnifiedTransaction = {
                id: `cb-${timestamp}-${asset}-${txType}-${quantity}`,
                source: 'coinbase',
                timestamp,
                classification,
                assetId: asset === 'ALGO' ? 'ALGO' : asset as unknown as number,
                assetName: asset,
                amount: Math.abs(quantity),
                feeAlgo: 0,
                audValueAtTime: Math.abs(audValue),
                txHash: `coinbase-${timestamp}`,
                notes: row.Notes?.trim() || `Coinbase ${txType} - Total: ${total} ${currency}, Fees: ${fees} ${currency}`,
                rawData: row,
            }

            transactions.push(tx)
        } catch (err) {
            errors.push(`Failed to parse row: ${err}`)
        }
    }

    return { transactions, errors }
}

// ─── Timestamp Parsing ──────────────────────────────────────────────
function parseTimestamp(value: string): number {
    if (!value) return NaN

    // Coinbase uses various formats:
    // "2024-01-15T12:30:00Z"
    // "2024-01-15 12:30:00 UTC"
    // "1/15/2024 12:30:00 PM"
    const cleaned = value.trim().replace(' UTC', 'Z').replace(' +0000', 'Z')
    const date = new Date(cleaned)
    return Math.floor(date.getTime() / 1000)
}

/**
 * Read a File object and parse it as Coinbase CSV.
 */
export async function parseCoinbaseCSVFile(
    file: File,
    usdToAudRate?: number
): Promise<{ transactions: UnifiedTransaction[]; errors: string[] }> {
    const content = await file.text()
    return parseCoinbaseCSV(content, usdToAudRate)
}
