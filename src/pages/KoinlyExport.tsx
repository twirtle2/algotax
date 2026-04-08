import { useEffect, useState, useMemo } from 'react'
import { db } from '@/db'
import { useAppStore } from '@/store/appStore'
import ExportModal from '@/components/ExportModal'
import { exportCoinTracker, filterForKoinly, mergeSwapPairs, toKoinlyCSV, type ProcessedExportRow } from '@/services/koinly-export'
import { getFYBoundaries } from '@/utils/date-utils'
import { KNOWN_ASSETS, ASSET_ID_TO_NAME } from '@/services/defi-app-ids'
import type { UnifiedTransaction, KoinlyExportOptions } from '@/types'

export default function KoinlyExport() {
    const [transactions, setTransactions] = useState<UnifiedTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const financialYear = useAppStore((s) => s.financialYear)
    const region = useAppStore((s) => s.region)
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
    const [showExportModal, setShowExportModal] = useState(false)

    const isMergedRow = (row: ProcessedExportRow): row is Extract<ProcessedExportRow, { sentAmount: number }> => 'sentAmount' in row
    const isUnifiedTransaction = (row: ProcessedExportRow): row is UnifiedTransaction => 'assetName' in row

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
            const { start, end } = getFYBoundaries(financialYear, region)
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
                if (isMergedRow(row)) return row.walletAddress?.toUpperCase() === normalizedFilter

                // For regular transactions, find which of from/to is tracked
                const fromOwn = row.fromAddress && ownAddressesSet.has(row.fromAddress.toUpperCase())
                const toOwn = row.toAddress && ownAddressesSet.has(row.toAddress.toUpperCase())

                // If filtering by a specific wallet, ensure this transaction belongs to it
                if (fromOwn && row.fromAddress?.toUpperCase() === normalizedFilter) return true
                if (toOwn && row.toAddress?.toUpperCase() === normalizedFilter) return true
                return false
            })
        }

        // 2. Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(row => {
                const asset = isUnifiedTransaction(row) ? row.assetName : (row.sentCurrency || row.receivedCurrency)
                const notes = isUnifiedTransaction(row) ? (row.notes || '') : row.description
                const type = isUnifiedTransaction(row) ? (row.manualClassification || row.classification || 'Trade') : 'Trade'
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
                valA = isUnifiedTransaction(a) ? a.amount : (a.sentAmount || a.receivedAmount)
                valB = isUnifiedTransaction(b) ? b.amount : (b.sentAmount || b.receivedAmount)
            } else if (sortField === 'classification') {
                valA = isUnifiedTransaction(a) ? (a.manualClassification || a.classification || 'Trade') : 'Trade'
                valB = isUnifiedTransaction(b) ? (b.manualClassification || b.classification || 'Trade') : 'Trade'
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1
            return 0
        })

        return filtered
    }, [processedRows, searchQuery, sortField, sortDirection, walletFilter, ownAddressesSet])

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

    const triggerCSVDownload = (csv: string, filename: string) => {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', filename)

        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    const handleSelectFormat = (format: 'koinly' | 'cointracker') => {
        if (format === 'koinly') {
            const csv = toKoinlyCSV(processedRows)
            triggerCSVDownload(csv, `koinly_export_${region}_${financialYear}_${Date.now()}.csv`)
        } else {
            const csv = exportCoinTracker(filteredTxns)
            triggerCSVDownload(csv, 'cointracker-export.csv')
        }

        setShowExportModal(false)
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

            {/* Consolidated Export Options */}
            <div className="card mb-lg" style={{ maxWidth: '800px' }}>
                <div className="card-header" style={{ marginBottom: 'var(--space-lg)' }}>
                    <h3 className="h4">Export Options</h3>
                </div>

                <div className="flex flex-col">
                    {/* Dust Threshold */}
                    <div className="mb-lg pt-sm">
                        <div className="flex justify-between items-center mb-sm">
                            <label className="text-sm font-bold">Dust Threshold</label>
                            <span className="badge badge-neutral text-mono" style={{ background: 'rgba(91, 156, 245, 0.1)', color: 'var(--color-info)' }}>
                                {options.dustThreshold} ALGO
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="0.1"
                            step="0.001"
                            value={options.dustThreshold}
                            onChange={(e) => setOptions({ ...options, dustThreshold: parseFloat(e.target.value) })}
                            style={{ width: '100%', height: '4px', appearance: 'none', background: 'var(--color-bg-tertiary)', borderRadius: '2px', outline: 'none' }}
                        />
                    </div>

                    <div className="flex flex-col">
                        {/* Toggle Rows */}
                        {[
                            {
                                label: 'Exclude Internal Transfers',
                                desc: 'Moves between your own wallets with no tax event',
                                checked: options.excludeOwnTransfers,
                                count: stats.excludedOwnTransfers,
                                onChange: (val: boolean) => setOptions({ ...options, excludeOwnTransfers: val })
                            },
                            {
                                label: 'Exclude ASA Opt-ins',
                                desc: 'Zero-value transactions required to receive tokens',
                                checked: options.excludeOptIns,
                                count: stats.excludedOptIns + stats.excludedZeroAmount,
                                onChange: (val: boolean) => setOptions({ ...options, excludeOptIns: val })
                            },
                            {
                                label: 'Exclude NFT Activity',
                                desc: 'NFT mints, transfers, and marketplace interactions',
                                checked: options.excludeNFTs,
                                count: stats.excludedNFTs,
                                onChange: (val: boolean) => setOptions({ ...options, excludeNFTs: val })
                            },
                            {
                                label: 'Exclude Other Zero-Amount',
                                desc: 'App calls and contract interactions with no value moved',
                                checked: options.excludeZeroAmount,
                                count: stats.excludedAppCalls,
                                onChange: (val: boolean) => setOptions({ ...options, excludeZeroAmount: val })
                            }
                        ].map((row, i) => (
                            <div key={i} className="flex items-center justify-between py-md border-top">
                                <div className="flex items-center gap-md">
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={row.checked}
                                            onChange={(e) => row.onChange(e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold">{row.label}</span>
                                        <span className="xsmall text-muted">{row.desc}</span>
                                    </div>
                                </div>
                                <span className={`font-bold ${row.count > 0 ? 'text-loss' : 'opacity-40'} mono text-sm`}>
                                    {row.count}
                                </span>
                            </div>
                        ))}

                        {/* ASA Filter Row (Special) */}
                        <div className="py-md border-top">
                            <div className="flex items-center justify-between mb-md">
                                <div className="flex items-center gap-md">
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={options.excludeASAs}
                                            onChange={(e) => setOptions({ ...options, excludeASAs: e.target.checked })}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold">Filter Non-ALGO Token Transactions</span>
                                        <p className="xsmall text-muted">
                                            Hides micro-transactions and dust rewards in ASA tokens — <span className="font-bold text-primary">{stats.excludedASAs} removed</span>. Pin specific tokens below to keep them.
                                        </p>
                                    </div>
                                </div>
                                <span className={`font-bold ${stats.excludedASAs > 0 ? 'text-loss' : 'opacity-40'} mono text-sm`}>
                                    {stats.excludedASAs}
                                </span>
                            </div>

                            {options.excludeASAs && (
                                <div className="ml-xl pl-md">
                                    <div className="alert alert-info border-none mb-lg" style={{ background: 'rgba(91, 156, 245, 0.05)', borderRadius: 'var(--radius-md)' }}>
                                        <p className="xsmall">
                                            <strong className="text-info">How this works:</strong> All non-ALGO token transactions are excluded by default. Toggle individual tokens <span className="text-info font-bold">on</span> to include their transactions in the export anyway.
                                        </p>
                                    </div>

                                    {/* Whitelisted Tokens */}
                                    <div className="mb-lg">
                                        <span className="xsmall font-bold text-muted uppercase tracking-wider block mb-sm">Always include these tokens</span>
                                        <div className="flex flex-wrap gap-sm">
                                            {options.whitelistedAssetIds.map(id => {
                                                const name = assetNames[id] || id
                                                return (
                                                    <div
                                                        key={id}
                                                        className="token-chip whitelisted"
                                                        onClick={() => {
                                                            setOptions((prev: KoinlyExportOptions) => ({
                                                                ...prev,
                                                                whitelistedAssetIds: prev.whitelistedAssetIds.filter(w => w !== id)
                                                            }))
                                                        }}
                                                    >
                                                        <span className="legend-dot" style={{ background: 'var(--color-info)' }}></span>
                                                        {name}
                                                    </div>
                                                )
                                            })}
                                            {options.whitelistedAssetIds.length === 0 && (
                                                <span className="xsmall opacity-40 italic">No tokens pinned yet</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Other Filtered Tokens */}
                                    <div className="mb-md">
                                        <div className="flex items-center gap-sm mb-sm">
                                            <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }}></div>
                                            <span className="xsmall font-bold text-muted uppercase tracking-wider">
                                                Other Filtered Tokens ({Object.keys(stats.excludedASAMapping).length})
                                            </span>
                                            <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }}></div>
                                        </div>

                                        <span className="xsmall font-bold text-muted uppercase tracking-wider block mb-sm">Major Assets Detected</span>
                                        <div className="flex flex-wrap gap-sm mb-md">
                                            {/* Predefined Major Assets */}
                                            {([
                                                { name: 'USDC', id: 31566704 },
                                                { name: 'goBTC', id: 386192725 },
                                                { name: 'goETH', id: 386195940 },
                                                { name: 'gALGO', id: 793124631 },
                                                { name: 'xALGO', id: 1134696561 },
                                                { name: 'CHIPS', id: 388592191 },
                                                { name: 'VEST', id: 594511654 },
                                                { name: 'BANK', id: 900643714 }
                                            ] as const).map(asset => {
                                                const isWhitelisted = options.whitelistedAssetIds.includes(asset.id)
                                                if (isWhitelisted) return null

                                                const mapping = stats.excludedASAMapping[asset.id.toString()]
                                                // Only show if it's actually present in the excluded list or it's a "major" one we want to suggest
                                                if (!mapping && !isWhitelisted) {
                                                    // Optional: only show if it exists in the user's transactions? 
                                                    // For now follow mockup and show these common ones if they are "possible"
                                                }

                                                const isIncludedInExport = !!mapping && mapping.count > 0
                                                const stateClass = isIncludedInExport ? 'included' : 'excluded'
                                                const dotColor = isIncludedInExport ? 'var(--color-gain)' : 'var(--color-text-muted)'

                                                // If it's not in the mapping and not whitelisted, we still show it in grey if it's "Major"
                                                return (
                                                    <div
                                                        key={asset.id}
                                                        className={`token-chip ${stateClass}`}
                                                        onClick={() => {
                                                            setOptions((prev: KoinlyExportOptions) => ({
                                                                ...prev,
                                                                whitelistedAssetIds: [...prev.whitelistedAssetIds, asset.id]
                                                            }))
                                                        }}
                                                    >
                                                        <span className="legend-dot" style={{ background: dotColor }}></span>
                                                        {asset.name}
                                                        {mapping && mapping.count > 0 && <span className="chip-count">{mapping.count}</span>}
                                                    </div>
                                                )
                                            })}

                                            {/* More Toggle */}
                                            {!showOtherAsas && Object.keys(stats.excludedASAMapping).length > 8 && (
                                                <button
                                                    className="token-chip excluded"
                                                    onClick={() => setShowOtherAsas(true)}
                                                >
                                                    + {Object.keys(stats.excludedASAMapping).length - 8} more
                                                </button>
                                            )}
                                        </div>

                                        {showOtherAsas && (
                                            <div className="flex flex-wrap gap-sm p-md bg-surface rounded mb-md">
                                                {Object.entries(stats.excludedASAMapping)
                                                    .filter(([id]) => !Object.values(KNOWN_ASSETS).includes(parseInt(id)))
                                                    .sort(([, a], [, b]) => b.count - a.count)
                                                    .map(([id, info]) => {
                                                        const assetId = id === 'ALGO' ? 'ALGO' : parseInt(id)
                                                        const isWhitelisted = options.whitelistedAssetIds.includes(assetId as any)
                                                        if (isWhitelisted) return null

                                                        return (
                                                            <div
                                                                key={id}
                                                                className="token-chip excluded"
                                                                onClick={() => {
                                                                    setOptions((prev: KoinlyExportOptions) => ({
                                                                        ...prev,
                                                                        whitelistedAssetIds: [...prev.whitelistedAssetIds, assetId as any]
                                                                    }))
                                                                }}
                                                            >
                                                                <span className="legend-dot" style={{ background: 'var(--color-text-muted)' }}></span>
                                                                {info.name || id}
                                                                <span className="chip-count">{info.count}</span>
                                                            </div>
                                                        )
                                                    })}
                                                <button className="btn-text xsmall w-full text-center mt-sm" onClick={() => setShowOtherAsas(false)}>Show Less</button>
                                            </div>
                                        )}

                                        {/* Legend */}
                                        <div className="flex gap-lg mt-md pt-sm opacity-80">
                                            <div className="legend-item">
                                                <span className="legend-dot" style={{ background: 'var(--color-info)' }}></span>
                                                Always included
                                            </div>
                                            <div className="legend-item">
                                                <span className="legend-dot" style={{ background: 'var(--color-gain)' }}></span>
                                                Included this export
                                            </div>
                                            <div className="legend-item">
                                                <span className="legend-dot" style={{ background: 'var(--color-text-muted)' }}></span>
                                                Excluded
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Export All History (Moved here) */}
                        <div className="py-md border-top">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-md">
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={options.exportAllHistory}
                                            onChange={(e) => setOptions({ ...options, exportAllHistory: e.target.checked })}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold">Export All History</span>
                                        <span className="xsmall text-muted">Ignore {region} financial year {financialYear} filter</span>

                                    </div>
                                </div>
                            </div>
                        </div>

                        <button className="btn btn-primary mt-xl py-md w-full" onClick={() => setShowExportModal(true)} style={{ borderRadius: 'var(--radius-md)', fontWeight: '700' }}>
                            <span>📥</span> Export
                        </button>
                    </div>
                </div>
            </div>

            <ExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                onSelectFormat={handleSelectFormat}
            />


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
                                    const date = new Date(row.timestamp * 1000).toLocaleString(region === 'AU' ? 'en-AU' : 'en-US', {
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

                                    let classification = row.manualClassification ?? row.classification
                                    let isOut = ['sell', 'transfer_out', 'nft_sale', 'lp_add'].includes(classification)
                                    let isIn = ['buy', 'transfer_in', 'nft_purchase', 'nft_mint', 'staking_reward', 'governance_reward', 'airdrop', 'income_other', 'lp_remove'].includes(classification)

                                    // Correctly identify owned address
                                    const fromOwn = row.fromAddress ? ownAddressesSet.has(row.fromAddress.toUpperCase()) : false
                                    const toOwn = row.toAddress ? ownAddressesSet.has(row.toAddress.toUpperCase()) : false

                                    let walletAddr = row.fromAddress
                                    if (walletFilter !== 'all') {
                                        const normalizedFilter = walletFilter.toUpperCase()
                                        walletAddr = wallets.find(w => w.address.toUpperCase() === normalizedFilter)?.address || walletFilter

                                        // Force UI perspective based on the filtered wallet for standard transfers
                                        if (classification === 'transfer_in' || classification === 'transfer_out') {
                                            if (row.fromAddress?.toUpperCase() === normalizedFilter) {
                                                isOut = true
                                                isIn = false
                                                classification = 'transfer_out' as any
                                            } else if (row.toAddress?.toUpperCase() === normalizedFilter) {
                                                isOut = false
                                                isIn = true
                                                classification = 'transfer_in' as any
                                            }
                                        }
                                    } else {
                                        if (fromOwn && toOwn) {
                                            walletAddr = isIn ? row.toAddress : row.fromAddress
                                        } else if (fromOwn) {
                                            walletAddr = row.fromAddress
                                        } else if (toOwn) {
                                            walletAddr = row.toAddress
                                        }
                                    }

                                    const walletName = wallets.find(w => w.address === walletAddr)?.label || (walletAddr ? `${walletAddr.slice(0, 4)}...` : 'Unknown')

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
