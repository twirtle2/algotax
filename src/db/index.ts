import Dexie, { type EntityTable } from 'dexie'
import type { UnifiedTransaction, WalletConfig } from '@/types'

// ─── Database Schema ────────────────────────────────────────────────
export class AlgoTaxDB extends Dexie {
    transactions!: EntityTable<UnifiedTransaction, 'id'>
    wallets!: EntityTable<WalletConfig, 'address'>
    missingAssets!: EntityTable<{ id: number }, 'id'>

    constructor() {
        super('algo-tax-au')

        this.version(4).stores({
            transactions: 'id, source, timestamp, classification, assetId, txHash, groupId, fromAddress, toAddress, [source+txHash]',
            wallets: 'address',
            missingAssets: 'id',
        })
    }
}

export const db = new AlgoTaxDB()

// ─── Helper Functions ───────────────────────────────────────────────

/** Upsert transactions (avoids duplicates) */
export async function upsertTransactions(txns: UnifiedTransaction[]): Promise<void> {
    await db.transactions.bulkPut(txns)
}

/** Get all transactions for a financial year */
export async function getTransactionsForFY(
    startTimestamp: number,
    endTimestamp: number
): Promise<UnifiedTransaction[]> {
    return db.transactions
        .where('timestamp')
        .between(startTimestamp, endTimestamp, true, true)
        .sortBy('timestamp')
}

/** Get all transactions from a specific source */
export async function getTransactionsBySource(source: 'algorand' | 'coinbase'): Promise<UnifiedTransaction[]> {
    return db.transactions.where('source').equals(source).sortBy('timestamp')
}

/** Clear all data (for reset) */
export async function clearAllData(): Promise<void> {
    await Promise.all([
        db.transactions.clear(),
        db.wallets.clear(),
    ])
}

/** Export all data as JSON */
export async function exportAllData(): Promise<string> {
    const [transactions, wallets] = await Promise.all([
        db.transactions.toArray(),
        db.wallets.toArray(),
    ])
    return JSON.stringify({ transactions, wallets, exportedAt: Date.now() }, null, 2)
}

/** Import data from JSON */
export async function importData(json: string): Promise<void> {
    const data = JSON.parse(json) as {
        transactions?: UnifiedTransaction[]
        wallets?: WalletConfig[]
    }
    if (data.transactions) await db.transactions.bulkPut(data.transactions)
    if (data.wallets) await db.wallets.bulkPut(data.wallets)
}
