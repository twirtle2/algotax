import { Routes, Route, NavLink } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import Transactions from '@/pages/Transactions'
import KoinlyExport from '@/pages/KoinlyExport'
import Settings from '@/pages/Settings'

const FINANCIAL_YEARS = ['2023-24', '2024-25', '2025-26', '2026-27']

export default function App() {
    const financialYear = useAppStore((s) => s.financialYear)
    const setFinancialYear = useAppStore((s) => s.setFinancialYear)

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-logo">
                    <div>
                        <h1>AlgoTax</h1>
                        <span>Koinly Export Helper</span>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
                        <span className="nav-icon">📤</span>
                        Koinly Export
                    </NavLink>
                    <NavLink to="/transactions" className={({ isActive }) => isActive ? 'active' : ''}>
                        <span className="nav-icon">📋</span>
                        Transactions
                    </NavLink>
                    <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
                        <span className="nav-icon">⚙️</span>
                        Settings
                    </NavLink>
                </nav>

                <div className="sidebar-fy">
                    <select
                        className="select mb-md"
                        value={financialYear}
                        onChange={(e) => setFinancialYear(e.target.value)}
                    >
                        {FINANCIAL_YEARS.map((fy) => (
                            <option key={fy} value={fy}>FY {fy}</option>
                        ))}
                    </select>

                    <a
                        href="https://github.com/twirtle2/algotax"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-github w-full mb-md"
                    >
                        <svg className="github-icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                        </svg>
                        View on GitHub
                    </a>
                    <div className="sidebar-footer">
                        <a
                            href="http://nodely.io/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="nodely-link"
                        >
                            Powered by Nodely
                        </a>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <Routes>
                    <Route path="/" element={<KoinlyExport />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </main>
        </div>
    )
}
