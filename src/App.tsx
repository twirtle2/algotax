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
                        className="select"
                        value={financialYear}
                        onChange={(e) => setFinancialYear(e.target.value)}
                    >
                        {FINANCIAL_YEARS.map((fy) => (
                            <option key={fy} value={fy}>FY {fy}</option>
                        ))}
                    </select>
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
