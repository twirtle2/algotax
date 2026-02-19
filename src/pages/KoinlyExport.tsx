import { useEffect, useState, useMemo } from 'react'
import { db } from '@/db'
import { useAppStore } from '@/store/appStore'
import { filterForKoinly, mergeSwapPairs, toKoinlyCSV } from '@/services/koinly-export'
import { getFYBoundaries } from '@/utils/date-utils'
import { KNOWN_ASSETS, ASSET_ID_TO_NAME } from '@/services/defi-app-ids'
import type { UnifiedTransaction, KoinlyExportOptions } from '@/types'

export default function KoinlyExport() {
    const [transactions, setTransactions] = useState<UnifiedTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const financialYear = useAppStore((s) => s.financialYear)
    const wallets = useAppStore((s) => s.wallets)
    const options = useAppStore((s) => s.koinlyOptions)
    const setOptions = useAppStore((s) => s.setKoinlyOptions)
    const [showOtherAsas, setShowOtherAsas] = useState(false)

    // Table State
    const [searchQuery, setSearchQuery] = useState('')
    const [sortField, setSortField] = useState<'timestamp' | 'amount' | 'classification'>('timestamp')
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)
    const [walletFilter, setWalletFilter] = useState<string>('all')

    useEffect(() => {
        async function load() {
            setLoading(true)
            try {
                // For Koinly we often want ALL history to ensure cost basis is correct,
                // but the user might want to export by FY.
                // Koinly handles "start from date" on import anyway.
                // We'll fetch all transactions for the selected addresses.
                const txns = await db.transactions.toArray()
                setTransactions(txns.sort((a, b) => b.timestamp - a.timestamp))
            } catch (err) {
                console.error('Failed to load transactions:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    const { filtered: filteredTxns, stats: baseStats } = useMemo(() => {
        let txnsToProcess = transactions

        if (!options.exportAllHistory && financialYear) {
            const { start, end } = getFYBoundaries(financialYear)
            txnsToProcess = transactions.filter(tx => tx.timestamp >= start && tx.timestamp <= end)
        }

        return filterForKoinly(txnsToProcess, wallets.map(w => w.address), options)
    }, [transactions, wallets, options, financialYear])

    const { merged: processedRows, count: mergedSwaps } = useMemo(() => {
        return mergeSwapPairs(filteredTxns, wallets.map(w => w.address))
    }, [filteredTxns, wallets])

    const stats = { ...baseStats, mergedSwaps }

    const ownAddressesSet = useMemo(() => new Set(wallets.map(w => w.address.toUpperCase())), [wallets])

    // Asset Name Resolution for Whitelist
    const assetNames = useMemo(() => {
        const names: Record<string | number, string> = { ...ASSET_ID_TO_NAME }
        // Populate from transactions to catch ones not in KNOWN_ASSETS
        for (const tx of transactions) {
            if (tx.assetId !== 'ALGO' && !names[tx.assetId]) {
                names[tx.assetId] = tx.assetName
            }
        }
        return names
    }, [transactions])

    // Filter, Sort, Paginate
    const displayRows = useMemo(() => {
        let filtered = [...processedRows]

        // 1. Wallet Filter
        if (walletFilter !== 'all') {
            const normalizedFilter = walletFilter.toUpperCase()
            filtered = filtered.filter(row => {
                if ('walletAddress' in row) return row.walletAddress?.toUpperCase() === normalizedFilter

                // For regular transactions, find which of from/to is tracked
                const fromOwn = row.fromAddress && ownAddressesSet.has(row.fromAddress.toUpperCase())
                const toOwn = row.toAddress && ownAddressesSet.has(row.toAddress.toUpperCase())

                // If filtering by a specific wallet, ensure this transaction belongs to it
                if (fromOwn && row.fromAddress.toUpperCase() === normalizedFilter) return true
                if (toOwn && row.toAddress.toUpperCase() === normalizedFilter) return true
                return false
            })
        }

        // 2. Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(row => {
                const asset = 'assetName' in row ? row.assetName : (row.sentCurrency || row.receivedCurrency)
                const notes = row.notes || row.description || ''
                const type = row.manualClassification || row.classification || 'Trade'
                return (
                    asset?.toLowerCase().includes(q) ||
                    notes?.toLowerCase().includes(q) ||
                    type?.toLowerCase().includes(q) ||
                    row.txHash.toLowerCase().includes(q)
                )
            })
        }

        // 2. Sort
        filtered.sort((a, b) => {
            let valA: any, valB: any

            if (sortField === 'timestamp') {
                valA = a.timestamp
                valB = b.timestamp
            } else if (sortField === 'amount') {
                valA = 'amount' in a ? a.amount : (a.sentAmount || a.receivedAmount)
                valB = 'amount' in b ? b.amount : (b.sentAmount || b.receivedAmount)
            } else if (sortField === 'classification') {
                valA = a.manualClassification || a.classification || 'Trade'
                valB = b.manualClassification || b.classification || 'Trade'
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1
            return 0
        })

        return filtered
    }, [processedRows, searchQuery, sortField, sortDirection])

    const totalPages = Math.ceil(displayRows.length / pageSize)
    const paginatedRows = displayRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    const toggleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('desc')
        }
        setCurrentPage(1)
    }

    const handleDownload = () => {
        const csv = toKoinlyCSV(processedRows)
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', `koinly_export_${financialYear}_${Date.now()}.csv`)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    if (loading) {
        return (
            <div className="empty-state">
                <div className="loading-spinner" />
                <p>Analyzing transactions...</p>
            </div>
        )
    }

    return (
        <div className="koinly-export">
            <div className="page-header">
                <h2>Koinly Export</h2>
                <p>Minimize your transaction count and export to Koinly-compatible CSV.</p>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
                <div className="card">
                    <div className="card-title">Final Count</div>
                    <div className="card-value text-accent">{processedRows.length}</div>
                    <div className="card-subtitle">Transactions to export</div>
                </div>
                <div className="card">
                    <div className="card-title">Filtered Out</div>
                    <div className="card-value text-loss">
                        {stats.total - stats.exported}
                    </div>
                    <div className="card-subtitle">Dust, opt-ins, internal, etc.</div>
                </div>
                <div className="card">
                    <div className="card-title">Swaps Merged</div>
                    <div className="card-value text-info">{stats.mergedSwaps || 0}</div>
                    <div className="card-subtitle">Pairs collapsed to single rows</div>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-lg mb-lg">
                {/* Options Panel */}
                <div className="card md:col-span-1">
                    <div className="card-header">
                        <h3 className="h4">Export Options</h3>
                    </div>
                    <div className="flex flex-col gap-md">
                        <div className="input-group">
                            <label>Dust Threshold (ALGO)</label>
                            <div className="flex items-center gap-sm">
                                <input
                                    type="range"
                                    min="0"
                                    max="0.1"
                                    step="0.001"
                                    value={options.dustThreshold}
                                    onChange={(e) => setOptions({ ...options, dustThreshold: parseFloat(e.target.value) })}
                                    style={{ flex: 1 }}
                                />
                                <span className="text-mono xsmall">{options.dustThreshold}</span>
                            </div>
                        </div>

                        <label className="flex items-center gap-sm cursor-pointer p-sm bg-primary-light rounded border border-primary">
                            <input
                                type="checkbox"
                                checked={options.exportAllHistory}
                                onChange={(e) => setOptions({ ...options, exportAllHistory: e.target.checked })}
                            />
                            <div className="flex flex-col">
                                <span className="text-sm font-bold">Export All History</span>
                                <span className="xsmall opacity-80">Ignore FY {financialYear} filter</span>
                            </div>
                        </label>

                        <label className="flex items-center gap-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.excludeOwnTransfers}
                                onChange={(e) => setOptions({ ...options, excludeOwnTransfers: e.target.checked })}
                            />
                            <span className="text-sm">Exclude Internal Transfers</span>
                        </label>

                        <label className="flex items-center gap-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.excludeOptIns}
                                onChange={(e) => setOptions({ ...options, excludeOptIns: e.target.checked })}
                            />
                            <span className="text-sm">Exclude ASA Opt-ins</span>
                        </label>

                        <label className="flex items-center gap-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.excludeASAs}
                                onChange={(e) => setOptions({ ...options, excludeASAs: e.target.checked })}
                            />
                            <div className="flex flex-col">
                                <span className="text-sm">Exclude ASA (non-ALGO) Transactions</span>
                                <span className="xsmall text-muted">Hides micro-transactions/rewards in tokens</span>
                            </div>
                        </label>

                        <label className="flex items-center gap-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.excludeNFTs}
                                onChange={(e) => setOptions({ ...options, excludeNFTs: e.target.checked })}
                            />
                            <span className="text-sm">Exclude NFT Activity</span>
                        </label>

                        <label className="flex items-center gap-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={options.excludeZeroAmount}
                                onChange={(e) => setOptions({ ...options, excludeZeroAmount: e.target.checked })}
                            />
                            <span className="text-sm">Exclude Other Zero-Amount</span>
                        </label>

                        <button className="btn btn-primary mt-md" onClick={handleDownload}>
                            <span>📥</span> Download Koinly CSV
                        </button>
                    </div>
                </div>

                {/* Filter Summary */}
                <div className="card md:col-span-2">
                    <div className="card-header">
                        <h3 className="h4">Filtering Details</h3>
                    </div>
                    <div className="flex flex-col gap-sm">
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">Dust Transactions ({'<'} {options.dustThreshold} ALGO)</span>
                            <span className="text-loss font-bold">{stats.excludedDust}</span>
                        </div>
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">Internal (Own Wallet) Transfers</span>
                            <span className="text-loss font-bold">{stats.excludedOwnTransfers}</span>
                        </div>
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">ASA Opt-ins / Zero-val transfers</span>
                            <span className="text-loss font-bold">{stats.excludedOptIns + stats.excludedZeroAmount}</span>
                        </div>
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">Standard App Calls (no value moved)</span>
                            <span className="text-loss font-bold">{stats.excludedAppCalls}</span>
                        </div>
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">ASA (non-ALGO) Transactions</span>
                            <span className="text-loss font-bold">{stats.excludedASAs}</span>
                        </div>
                        <div className="flex justify-between items-center p-sm bg-surface rounded">
                            <span className="text-sm">NFT Transactions</span>
                            <span className="text-loss font-bold">{stats.excludedNFTs}</span>
                        </div>
                    </div>

                    {/* Excluded ASAs List */}
                    {options.excludeASAs && Object.keys(stats.excludedASAMapping).length > 0 && (
                        <div className="mt-lg">
                            <h4 className="h5 mb-sm">Filtered Assets (ASAs)</h4>
                            <p className="xsmall text-muted mb-md">These were excluded. Choose assets to include in the export anyway.</p>

                            {/* Major Assets Quick Add */}
                            <div className="mb-md">
                                <span className="xsmall font-bold opacity-60 uppercase tracking-wider block mb-sm">Major Assets</span>
                                <div className="flex flex-wrap gap-xs">
                                    {([
                                        { name: 'USDC', id: KNOWN_ASSETS.USDC as number },
                                        { name: 'gALGO', id: KNOWN_ASSETS.gALGO as number },
                                        { name: 'xALGO', id: KNOWN_ASSETS.xALGO as number },
                                        { name: 'goBTC', id: KNOWN_ASSETS.goBTC as number },
                                        { name: 'goETH', id: KNOWN_ASSETS.goETH as number }
                                    ] as const).map(asset => {
                                        const isWhitelisted = options.whitelistedAssetIds.includes(asset.id)
                                        const count = stats.excludedASAMapping[asset.id.toString()]?.count || 0

                                        if (isWhitelisted) return null

                                        return (
                                            <button
                                                key={asset.id}
                                                className="btn btn-secondary btn-sm flex items-center gap-xs"
                                                onClick={() => {
                                                    setOptions((prev: KoinlyExportOptions) => ({
                                                        ...prev,
                                                        whitelistedAssetIds: [...prev.whitelistedAssetIds, asset.id]
                                                    }))
                                                }}
                                            >
                                                <span>+</span>
                                                <span>{asset.name}</span>
                                                {count > 0 && <span className="opacity-60 xsmall">({count})</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Other Assets Collapsible */}
                            <div>
                                <button
                                    className="btn-text xsmall flex items-center gap-xs mb-sm"
                                    onClick={() => setShowOtherAsas(!showOtherAsas)}
                                >
                                    <span>{showOtherAsas ? '▼' : '▶'}</span>
                                    <span>Other Filtered Assets ({Object.keys(stats.excludedASAMapping).length})</span>
                                </button>

                                {showOtherAsas && (
                                    <div className="flex flex-wrap gap-xs p-sm bg-surface-light rounded">
                                        {Object.entries(stats.excludedASAMapping)
                                            .filter(([id]) => !Object.values(KNOWN_ASSETS).includes(parseInt(id)))
                                            .sort(([, a], [, b]) => b.count - a.count)
                                            .map(([id, info]) => (
                                                <div key={id} className="chip flex items-center gap-xs">
                                                    <span className="xsmall font-bold">{info.name || id}</span>
                                                    <span className="xsmall opacity-60">({info.count})</span>
                                                    <button
                                                        className="btn-icon-sm"
                                                        title="Include this asset"
                                                        onClick={() => {
                                                            const assetId = id === 'ALGO' ? 'ALGO' : parseInt(id)
                                                            setOptions((prev: KoinlyExportOptions) => ({
                                                                ...prev,
                                                                whitelistedAssetIds: [...prev.whitelistedAssetIds, assetId]
                                                            }))
                                                        }}
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Whitelisted ASAs List */}
                    {options.whitelistedAssetIds.length > 0 && (
                        <div className="mt-md pt-md border-top">
                            <h4 className="h5 mb-sm">Whitelisted Assets</h4>
                            <div className="flex flex-wrap gap-xs">
                                {options.whitelistedAssetIds.map(id => {
                                    const name = assetNames[id] || id
                                    return (
                                        <div key={id} className="chip chip-accent flex items-center gap-xs" style={{ padding: '2px 8px' }}>
                                            <span className="xsmall font-bold">{name}</span>
                                            <button
                                                className="btn-icon-sm"
                                                title={`Remove ${name} (${id}) from whitelist`}
                                                onClick={() => {
                                                    setOptions((prev: KoinlyExportOptions) => ({
                                                        ...prev,
                                                        whitelistedAssetIds: prev.whitelistedAssetIds.filter(w => w !== id)
                                                    }))
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <div className="alert alert-info mt-lg">
                        <p><strong>Tip:</strong> Koinly counts transactions. Reducing this number saves you money on their annual plans.</p>
                    </div>
                </div>
            </div>

            {/* Preview Table */}
            <div className="table-container">
                <div className="table-toolbar flex flex-col md:flex-row justify-between gap-md items-start md:items-center">
                    <h3 className="h4">Export Preview ({displayRows.length} total)</h3>

                    <div className="flex flex-wrap gap-sm w-full md:w-auto">
                        <div className="flex items-center gap-xs">
                            <span className="xsmall opacity-60">Wallet:</span>
                            <select
                                className="input xsmall"
                                value={walletFilter}
                                onChange={(e) => {
                                    setWalletFilter(e.target.value)
                                    setCurrentPage(1)
                                }}
                                style={{ padding: '2px 4px', maxWidth: '150px' }}
                            >
                                <option value="all">All Wallets</option>
                                {wallets.map(w => (
                                    <option key={w.address} value={w.address}>
                                        {w.label || `${w.address.slice(0, 6)}...`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <input
                            type="text"
                            className="input xsmall"
                            placeholder="Search preview..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setCurrentPage(1)
                            }}
                            style={{ maxWidth: '200px' }}
                        />

                        <div className="flex items-center gap-xs">
                            <span className="xsmall opacity-60">Show:</span>
                            <select
                                className="input xsmall"
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(parseInt(e.target.value))
                                    setCurrentPage(1)
                                }}
                                style={{ padding: '2px 4px', width: '70px' }}
                            >
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="500">500</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table>
                        <thead>
                            <tr>
                                <th onClick={() => toggleSort('timestamp')} className="cursor-pointer">
                                    Date {sortField === 'timestamp' && (sortDirection === 'asc' ? '↑' : '↓')}
                                </th>
                                <th>Wallet</th>
                                <th onClick={() => toggleSort('amount')} className="cursor-pointer">
                                    Sent/Received {sortField === 'amount' && (sortDirection === 'asc' ? '↑' : '↓')}
                                </th>
                                <th>Fee</th>
                                <th onClick={() => toggleSort('classification')} className="cursor-pointer">
                                    Label {sortField === 'classification' && (sortDirection === 'asc' ? '↑' : '↓')}
                                </th>
                                <th>Description</th>
                                <th>TxHash</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center p-xl opacity-60">
                                        No transactions match your search/filters
                                    </td>
                                </tr>
                            ) : (
                                paginatedRows.map((row, idx) => {
                                    const isMerged = 'sentAmount' in row
                                    const date = new Date(row.timestamp * 1000).toLocaleDateString('en-AU', {
                                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                    })

                                    if (isMerged) {
                                        const walletAddr = row.walletAddress
                                        const walletName = wallets.find(w => w.address === walletAddr)?.label || (walletAddr ? `${walletAddr.slice(0, 4)}...` : 'Unknown')

                                        return (
                                            <tr key={idx}>
                                                <td className="xsmall">{date}</td>
                                                <td className="xsmall" title={walletAddr}>{walletName}</td>
                                                <td>
                                                    <div className="flex flex-col">
                                                        <span className="text-loss text-mono xsmall">-{row.sentAmount.toFixed(4)} {row.sentCurrency}</span>
                                                        <span className="text-gain text-mono xsmall">+{row.receivedAmount.toFixed(4)} {row.receivedCurrency}</span>
                                                    </div>
                                                </td>
                                                <td className="text-muted text-mono xsmall">{row.feeAmount.toFixed(4)} ALGO</td>
                                                <td><span className="badge badge-info">Trade</span></td>
                                                <td className="xsmall">{row.description}</td>
                                                <td className="text-mono xsmall" title={row.txHash}>
                                                    <a
                                                        href={`https://allo.info/tx/${row.txHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-accent hover:underline"
                                                    >
                                                        {row.txHash.slice(0, 8)}...
                                                    </a>
                                                </td>
                                            </tr>
                                        )
                                    }

                                    const classification = row.manualClassification ?? row.classification
                                    const isOut = ['sell', 'transfer_out', 'nft_sale', 'lp_add'].includes(classification)
                                    const isIn = ['buy', 'transfer_in', 'nft_purchase', 'nft_mint', 'staking_reward', 'governance_reward', 'airdrop', 'income_other', 'lp_remove'].includes(classification)

                                    // Correctly identify owned address
                                    const fromOwn = row.fromAddress && ownAddressesSet.has(row.fromAddress.toUpperCase())
                                    const toOwn = row.toAddress && ownAddressesSet.has(row.toAddress.toUpperCase())
                                    const walletAddr = fromOwn ? row.fromAddress : (toOwn ? row.toAddress : row.fromAddress)
                                    const walletName = wallets.find(w => w.address === walletAddr)?.label || `${walletAddr?.slice(0, 4)}...`

                                    return (
                                        <tr key={row.id}>
                                            <td className="xsmall">{date}</td>
                                            <td className="xsmall" title={walletAddr}>{walletName}</td>
                                            <td className="text-mono xsmall">
                                                {isOut && <span className="text-loss">-{row.amount.toFixed(4)} {row.assetName}</span>}
                                                {isIn && <span className="text-gain">+{row.amount.toFixed(4)} {row.assetName}</span>}
                                                {!isOut && !isIn && '—'}
                                            </td>
                                            <td className="text-muted text-mono xsmall">{row.feeAlgo > 0 ? `${row.feeAlgo.toFixed(4)} ALGO` : '—'}</td>
                                            <td>
                                                <span className={`badge ${isIn ? 'badge-gain' : 'badge-neutral'}`}>
                                                    {classification}
                                                </span>
                                            </td>
                                            <td className="xsmall" title={row.notes}>{row.notes || '—'}</td>
                                            <td className="text-mono xsmall" title={row.txHash}>
                                                <a
                                                    href={`https://allo.info/tx/${row.txHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-accent hover:underline"
                                                >
                                                    {row.txHash.slice(0, 8)}...
                                                </a>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-md p-sm bg-surface-light rounded">
                        <div className="xsmall opacity-60">
                            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, displayRows.length)} of {displayRows.length}
                        </div>
                        <div className="flex gap-xs">
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(prev => prev - 1)}
                            >
                                Previous
                            </button>
                            <div className="flex items-center px-sm xsmall font-bold">
                                Page {currentPage} of {totalPages}
                            </div>
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(prev => prev + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
