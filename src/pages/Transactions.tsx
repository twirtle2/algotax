import { useEffect, useState, useMemo } from 'react'
import { db } from '@/db'
import { useAppStore } from '@/store/appStore'
import type { UnifiedTransaction, TxClassification } from '@/types'

import { getFYBoundaries } from '@/utils/date-utils'

const CLASSIFICATION_LABELS: Record<TxClassification, string> = {
    buy: 'Buy',
    sell: 'Sell',
    swap: 'Swap',
    transfer_in: 'Transfer In',
    transfer_out: 'Transfer Out',
    staking_reward: 'Staking Reward',
    governance_reward: 'Gov. Reward',
    lp_add: 'LP Add',
    lp_remove: 'LP Remove',
    airdrop: 'Airdrop',
    nft_purchase: 'NFT Purchase',
    nft_sale: 'NFT Sale',
    nft_mint: 'NFT Mint',
    opt_in: 'Opt-In',
    app_call: 'App Call',
    fee: 'Fee',
    income_other: 'Other Income',
    unknown: 'Unknown',
}

const CLASSIFICATION_BADGE: Record<TxClassification, string> = {
    buy: 'badge-gain',
    sell: 'badge-loss',
    swap: 'badge-info',
    transfer_in: 'badge-accent',
    transfer_out: 'badge-neutral',
    staking_reward: 'badge-gain',
    governance_reward: 'badge-gain',
    lp_add: 'badge-info',
    lp_remove: 'badge-info',
    airdrop: 'badge-accent',
    nft_purchase: 'badge-info',
    nft_sale: 'badge-loss',
    nft_mint: 'badge-accent',
    opt_in: 'badge-neutral',
    app_call: 'badge-neutral',
    fee: 'badge-neutral',
    income_other: 'badge-gain',
    unknown: 'badge-warning',
}

function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function truncateAddress(address: string): string {
    if (address.length <= 12) return address
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatFiat(value: number, currency: string = 'AUD'): string {
    return new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
    }).format(value)
}

export default function Transactions() {
    const financialYear = useAppStore((s) => s.financialYear)
    const currency = useAppStore((s) => s.currency)
    const [transactions, setTransactions] = useState<UnifiedTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const [filterClassification, setFilterClassification] = useState<string>('all')
    const [filterSource, setFilterSource] = useState<string>('all')
    const [filterAsset, setFilterAsset] = useState<string>('all')
    const [searchText, setSearchText] = useState('')

    useEffect(() => {
        async function load() {
            setLoading(true)
            try {
                const { start, end } = getFYBoundaries(financialYear || '2024-25')
                const txns = await db.transactions
                    .where('timestamp')
                    .between(start, end, true, true)
                    .reverse()
                    .sortBy('timestamp')
                setTransactions(txns)
            } catch (err) {
                console.error('Failed to load transactions:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [financialYear])

    // Unique assets in the data
    const uniqueAssets = useMemo(() => {
        const assets = new Set(transactions.map((tx) => tx.assetName))
        return [...assets].sort()
    }, [transactions])

    // Filtered transactions
    const filtered = useMemo(() => {
        return transactions.filter((tx) => {
            const classification = tx.manualClassification ?? tx.classification
            if (filterClassification !== 'all' && classification !== filterClassification) return false
            if (filterSource !== 'all' && tx.source !== filterSource) return false
            if (filterAsset !== 'all' && tx.assetName !== filterAsset) return false
            if (searchText) {
                const q = searchText.toLowerCase()
                return (
                    tx.txHash.toLowerCase().includes(q) ||
                    tx.assetName.toLowerCase().includes(q) ||
                    tx.fromAddress?.toLowerCase().includes(q) ||
                    tx.toAddress?.toLowerCase().includes(q) ||
                    tx.notes?.toLowerCase().includes(q)
                )
            }
            return true
        })
    }, [transactions, filterClassification, filterSource, filterAsset, searchText])

    // Handle manual classification override
    const handleClassificationChange = async (txId: string, newClassification: TxClassification) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db.transactions as any).update(txId, { manualClassification: newClassification })
        setTransactions((prev) =>
            prev.map((tx) =>
                tx.id === txId ? { ...tx, manualClassification: newClassification } : tx
            )
        )
    }

    return (
        <div>
            <div className="page-header">
                <h2>Transactions</h2>
                <p>
                    {filtered.length.toLocaleString()} transaction{filtered.length !== 1 ? 's' : ''}
                    {` in FY ${financialYear}`}
                </p>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="filters">
                        <select
                            className="select"
                            value={filterClassification}
                            onChange={(e) => setFilterClassification(e.target.value)}
                        >
                            <option value="all">All Types</option>
                            {Object.entries(CLASSIFICATION_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>

                        <select
                            className="select"
                            value={filterSource}
                            onChange={(e) => setFilterSource(e.target.value)}
                        >
                            <option value="all">All Sources</option>
                            <option value="algorand">Algorand</option>
                            <option value="coinbase">Coinbase</option>
                        </select>

                        <select
                            className="select"
                            value={filterAsset}
                            onChange={(e) => setFilterAsset(e.target.value)}
                        >
                            <option value="all">All Assets</option>
                            {uniqueAssets.map((asset) => (
                                <option key={asset} value={asset}>{asset}</option>
                            ))}
                        </select>

                        <input
                            type="text"
                            className="input"
                            placeholder="Search tx hash, address, notes..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            style={{ minWidth: 200 }}
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="empty-state">
                        <div className="loading-spinner" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="empty-state">
                        <div className="icon">📋</div>
                        <h3>No transactions found</h3>
                        <p>Add wallets and sync transactions from the Settings page.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Source</th>
                                    <th>Asset</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                    <th>From</th>
                                    <th>To</th>
                                    <th style={{ textAlign: 'right' }}>{currency} Value</th>
                                    <th>Notes</th>
                                    <th>Classify</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.slice(0, 200).map((tx) => {
                                    const classification = tx.manualClassification ?? tx.classification
                                    return (
                                        <tr key={tx.id}>
                                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                {formatDate(tx.timestamp)}
                                            </td>
                                            <td>
                                                <span className={`badge ${CLASSIFICATION_BADGE[classification]}`}>
                                                    {CLASSIFICATION_LABELS[classification]}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`badge ${tx.source === 'algorand' ? 'badge-accent' : 'badge-info'}`}>
                                                    {tx.source}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                                {tx.assetName}
                                            </td>
                                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                                                {tx.amount > 0 ? tx.amount.toFixed(tx.amount < 1 ? 6 : 4) : '—'}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                                                {tx.fromAddress ? truncateAddress(tx.fromAddress) : '—'}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                                                {tx.toAddress ? truncateAddress(tx.toAddress) : '—'}
                                            </td>
                                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                                                {tx.audValueAtTime !== undefined
                                                    ? formatFiat(tx.audValueAtTime, currency)
                                                    : '—'}
                                            </td>
                                            <td style={{ fontSize: '0.75rem', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {tx.notes ?? '—'}
                                            </td>
                                            <td>
                                                <select
                                                    className="select"
                                                    value={classification}
                                                    onChange={(e) => handleClassificationChange(tx.id, e.target.value as TxClassification)}
                                                    style={{ fontSize: '0.7rem', padding: '2px 4px', minWidth: 90 }}
                                                >
                                                    {Object.entries(CLASSIFICATION_LABELS).map(([key, label]) => (
                                                        <option key={key} value={key}>{label}</option>
                                                    ))}
                                                </select>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        {filtered.length > 200 && (
                            <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                Showing 200 of {filtered.length.toLocaleString()} transactions. Use filters to narrow results.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
