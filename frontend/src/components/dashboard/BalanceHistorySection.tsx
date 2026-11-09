import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Info,
  RefreshCw,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface BalanceHistoryItem {
  id: number
  date: string
  timestamp: string
  trading_balance: number
  clear_balance: number
  unsettled_amount: number
  collateral: number
  realized_pnl: number
  unrealized_pnl: number
  utilised_margin: number
  opening_balance: number
  net_change: number
  snapshot_type: string
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(val)
}

function formatDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    }
    return dateStr
  } catch {
    return dateStr
  }
}

type PresetRange = '7D' | '30D' | '90D' | 'ALL' | 'CUSTOM'

export function BalanceHistorySection() {
  const [history, setHistory] = useState<BalanceHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [rangePreset, setRangePreset] = useState<PresetRange>('ALL')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false)

  const fetchHistory = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/auth/balance-history?days=all', { credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success' && Array.isArray(data.data)) {
        setHistory(data.data)
      }
    } catch (_err) {
      // silently handle
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Filter items by range preset or custom date range
  const filteredHistory = useMemo(() => {
    if (!history.length) return []

    // If custom date filter is active
    if (startDate || endDate) {
      return history.filter((item) => {
        if (startDate && item.date < startDate) return false
        if (endDate && item.date > endDate) return false
        return true
      })
    }

    if (rangePreset === '7D') return history.slice(-7)
    if (rangePreset === '30D') return history.slice(-30)
    if (rangePreset === '90D') return history.slice(-90)
    return history // 'ALL'
  }, [history, rangePreset, startDate, endDate])

  // Aggregate stats & True Period Growth
  const stats = useMemo(() => {
    if (!filteredHistory.length) return null
    const first = filteredHistory[0]
    const last = filteredHistory[filteredHistory.length - 1]

    // Effective Capital = latest settled cash + any profit pending T+1 settlement
    // This guarantees weekend settlement batches don't falsely make Period Growth look negative!
    const effectiveLatestCapital = Math.max(
      last.trading_balance,
      last.clear_balance + last.unsettled_amount
    )
    const baseOpeningCapital = first.opening_balance > 0 ? first.opening_balance : first.clear_balance

    const totalGrowth = effectiveLatestCapital - baseOpeningCapital
    const pctGrowth = baseOpeningCapital > 0 ? (totalGrowth / baseOpeningCapital) * 100 : 0

    return {
      currentBalance: last.trading_balance,
      settledBalance: last.clear_balance,
      unsettledAmount: last.unsettled_amount,
      effectiveCapital: effectiveLatestCapital,
      baseOpening: baseOpeningCapital,
      startDate: first.date,
      totalGrowth,
      pctGrowth,
    }
  }, [filteredHistory])

  // SVG Chart computation
  const chartPoints = useMemo(() => {
    if (filteredHistory.length < 2) return null

    // Plot effective equity values
    const balances = filteredHistory.map((h) =>
      Math.max(h.trading_balance, h.clear_balance + h.unsettled_amount)
    )
    const minVal = Math.min(...balances) * 0.95
    const maxVal = Math.max(...balances) * 1.05
    const range = maxVal - minVal || 1

    const width = 800
    const height = 220
    const padding = 35

    const pts = filteredHistory.map((item, idx) => {
      const val = Math.max(item.trading_balance, item.clear_balance + item.unsettled_amount)
      const x = padding + (idx / (filteredHistory.length - 1)) * (width - 2 * padding)
      const y = height - padding - ((val - minVal) / range) * (height - 2 * padding)
      return { x, y, item, val }
    })

    const pathD = pts.reduce(
      (acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`),
      ''
    )

    const areaD = `${pathD} L ${pts[pts.length - 1].x} ${height - padding} L ${pts[0].x} ${height - padding} Z`

    return { pts, pathD, areaD, minVal, maxVal, width, height, padding }
  }, [filteredHistory])

  const handlePresetClick = (preset: PresetRange) => {
    setRangePreset(preset)
    if (preset !== 'CUSTOM') {
      setStartDate('')
      setEndDate('')
      setShowDatePicker(false)
    } else {
      setShowDatePicker(true)
    }
  }

  const handleClearCustomDates = () => {
    setStartDate('')
    setEndDate('')
    setRangePreset('ALL')
    setShowDatePicker(false)
  }

  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg md:text-xl font-bold flex items-center gap-2">
                Cash Balance & Capital History
              </CardTitle>
              <p className="text-xs md:text-sm text-muted-foreground">
                Settled cash, live trading equity, and SEBI T+1 clearing pipeline
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Preset Toggle Pills */}
            <div className="flex rounded-md bg-muted p-1 text-xs">
              {(['7D', '30D', '90D', 'ALL'] as PresetRange[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePresetClick(p)}
                  className={cn(
                    'px-2.5 py-1 rounded-sm font-medium transition-colors',
                    rangePreset === p && !startDate && !endDate
                      ? 'bg-background shadow-xs text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handlePresetClick('CUSTOM')}
                className={cn(
                  'px-2.5 py-1 rounded-sm font-medium transition-colors flex items-center gap-1',
                  showDatePicker || startDate || endDate
                    ? 'bg-background shadow-xs text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Calendar className="h-3 w-3" />
                <span>Date Range</span>
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={fetchHistory}
              disabled={isLoading}
              className="h-8 px-2.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Date Selection Filter Bar */}
        {(showDatePicker || startDate || endDate) && (
          <div className="flex flex-wrap items-center gap-2.5 pt-3 mt-1 pb-1 border-t border-border/30 bg-muted/20 px-3 py-2 rounded-md">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Filter by Date:</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="bal-start-date" className="text-muted-foreground">From:</label>
              <input
                id="bal-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setRangePreset('CUSTOM')
                }}
                className="bg-background border border-border/80 rounded px-2 py-1 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="bal-end-date" className="text-muted-foreground">To:</label>
              <input
                id="bal-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setRangePreset('CUSTOM')
                }}
                className="bg-background border border-border/80 rounded px-2 py-1 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>
            {(startDate || endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCustomDates}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3 mr-1" />
                Clear Filter
              </Button>
            )}
          </div>
        )}

        {/* Summary Stat Pills */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
            <div className="bg-muted/40 rounded-lg p-2.5 border border-border/30">
              <span className="text-xs text-muted-foreground">Trading Capital</span>
              <p className="text-base font-bold text-foreground">
                {formatCurrency(stats.effectiveCapital)}
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2.5 border border-border/30">
              <span className="text-xs text-muted-foreground">Settled Cash</span>
              <p className="text-base font-bold text-foreground">
                {formatCurrency(stats.settledBalance)}
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2.5 border border-border/30">
              <span className="text-xs text-muted-foreground">Pending T+1</span>
              <p className="text-base font-bold text-amber-500">
                {formatCurrency(stats.unsettledAmount)}
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2.5 border border-border/30">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Period Growth</span>
                <span
                  className="text-[10px] text-muted-foreground/70"
                  title="Net gain from starting opening capital to current total equity"
                >
                  <Info className="h-3 w-3 inline opacity-60" />
                </span>
              </div>
              <p
                className={cn(
                  'text-base font-bold flex items-center gap-1',
                  stats.totalGrowth >= 0 ? 'text-green-500' : 'text-red-500'
                )}
              >
                {stats.totalGrowth >= 0 ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {formatCurrency(stats.totalGrowth)} ({stats.pctGrowth > 0 ? '+' : ''}
                {stats.pctGrowth.toFixed(1)}%)
              </p>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-4 space-y-6">
        {/* Equity Curve Chart */}
        {chartPoints ? (
          <div className="rounded-xl border border-border/50 bg-background/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Account Equity Curve</span>
              </div>
              <span className="text-xs text-muted-foreground">
                Showing {filteredHistory.length} trading day{filteredHistory.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartPoints.width} ${chartPoints.height}`}
                className="w-full h-44 overflow-visible"
              >
                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary, #3b82f6)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="var(--primary, #3b82f6)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal gridlines */}
                <line
                  x1={chartPoints.padding}
                  y1={chartPoints.padding}
                  x2={chartPoints.width - chartPoints.padding}
                  y2={chartPoints.padding}
                  stroke="currentColor"
                  strokeOpacity="0.08"
                  strokeDasharray="4 4"
                />
                <line
                  x1={chartPoints.padding}
                  y1={chartPoints.height / 2}
                  x2={chartPoints.width - chartPoints.padding}
                  y2={chartPoints.height / 2}
                  stroke="currentColor"
                  strokeOpacity="0.08"
                  strokeDasharray="4 4"
                />
                <line
                  x1={chartPoints.padding}
                  y1={chartPoints.height - chartPoints.padding}
                  x2={chartPoints.width - chartPoints.padding}
                  y2={chartPoints.height - chartPoints.padding}
                  stroke="currentColor"
                  strokeOpacity="0.15"
                />

                {/* Filled area */}
                <path d={chartPoints.areaD} fill="url(#balanceGradient)" />

                {/* Balance line */}
                <path
                  d={chartPoints.pathD}
                  fill="none"
                  stroke="var(--primary, #3b82f6)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data point dots & labels */}
                {chartPoints.pts.map((pt, idx) => (
                  <g key={pt.item.id || idx}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="4.5"
                      className="fill-background stroke-primary stroke-[2.5]"
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 10}
                      textAnchor="middle"
                      className="text-[10px] font-semibold fill-foreground"
                    >
                      {formatCurrency(pt.val)}
                    </text>
                    <text
                      x={pt.x}
                      y={chartPoints.height - 10}
                      textAnchor="middle"
                      className="text-[10px] fill-muted-foreground"
                    >
                      {formatDate(pt.item.date).slice(0, 6)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
            <History className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No matching balance records found</p>
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-md mx-auto">
              Try adjusting your date range or selecting &quot;ALL&quot;.
            </p>
          </div>
        )}

        {/* Ledger Table */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Daily Ledger Breakdown
            </h3>
            <span className="text-xs text-muted-foreground">
              {filteredHistory.length} record{filteredHistory.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="border border-border/50 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead className="bg-muted/60 text-muted-foreground border-b border-border/50 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Opening Bal</th>
                    <th className="py-2.5 px-3">Day P&L</th>
                    <th className="py-2.5 px-3">Settled Cash</th>
                    <th className="py-2.5 px-3">Trading Capital</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredHistory.length > 0 ? (
                    filteredHistory
                      .slice()
                      .reverse()
                      .map((row) => {
                        const dayPnl = row.realized_pnl
                        const isSettled = row.unsettled_amount <= 0
                        const totalEquity = Math.max(row.trading_balance, row.clear_balance + row.unsettled_amount)
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                              {formatDate(row.date)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">
                              {formatCurrency(row.opening_balance)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-semibold">
                              <span
                                className={cn(
                                  dayPnl > 0
                                    ? 'text-green-500'
                                    : dayPnl < 0
                                      ? 'text-red-500'
                                      : 'text-muted-foreground'
                                )}
                              >
                                {dayPnl > 0 ? '+' : ''}
                                {formatCurrency(dayPnl)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {formatCurrency(row.clear_balance)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-bold text-foreground">
                              {formatCurrency(totalEquity)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {isSettled ? (
                                <Badge
                                  variant="secondary"
                                  className="gap-1 text-[11px] font-normal text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Settled
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="gap-1 text-[11px] font-normal text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10"
                                >
                                  <Clock className="h-3 w-3" />
                                  Pending T+1
                                </Badge>
                              )}
                            </td>
                          </tr>
                        )
                      })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                        No balance records found for the selected date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
