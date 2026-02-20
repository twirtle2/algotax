# AlgoTax - Algorand Tax Helper for Koinly

[AlgoTax](https://twirtle2.github.io/algotax) is a specialized tool designed to help Algorand users optimize their transaction history for tax reporting, specifically targeting the [Koinly](https://koinly.io/) platform.

## Why this app?

Koinly pricing is tiered based on your transaction count. For active users on fast, low-cost blockchains like Algorand—where staking rewards, DeFi interactions, and micro-transactions occur frequently—this can quickly inflate your tax software bill.

**AlgoTax helps by:**
1. **Fetching and Organizing**: Connecting to your Algorand wallets to retrieve your full transaction history.
2. **Merging Swaps**: Intelligently merging sent and received transactions from DEXs (like Tinyman, Pact, etc.) into single, clean "Swap" trades instead of multiple separate deposits and withdrawals.
3. **ASA Whitelisting (Spam Filtering)**: Algorand wallets often receive spam tokens. AlgoTax allows you to explicitly whitelist ASAs you care about, hiding all the 0-value spam drops from your export.
4. **Generating Tax-Ready CSVs**: Exporting a clean Universal Koinly CSV format that minimizes your total transaction count while keeping your capital gains calculations perfectly accurate.

## Features
- **Wallet and Date Filtering**: Filter by specific wallets or Australian Financial Years (e.g., FY 2023-24).
- **Transaction Previews**: See exactly how many transactions you are saving before exporting. Includes direct links to Allo.info for transaction verification.
- **Local First**: Your data stays local. The app communicates directly with Algorand nodes (Powered by Nodely) and doesn't store your wallet addresses or transaction history on any external servers.

## Tech Stack
- Frontend: React (Vite)
- State Management: Zustand
- Data Storage: Dexie.js (IndexedDB)
- Algorand API: Nodely via standard REST

## Getting Started Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```
