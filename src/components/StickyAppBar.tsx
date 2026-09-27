import React from "react";
import { MathTemplate, ChittiMaster } from "../types";
import { Mail, FunctionSquare, Layers, Calendar, DollarSign, AlertTriangle, Zap, Database } from "lucide-react";

interface StickyAppBarProps {
  currentTenantId: string;
  mathTemplates: MathTemplate[];
  currentFormulaId: string;
  onSelectFormula: (formulaId: string) => void;
  chittis: ChittiMaster[];
  currentChittiId: string;
  onSelectChitti: (chittiId: string) => void;
  activeMonth: number;
  totalMonths: number;
  monthPayout: number;
  totalPending: number;
  onOpenCreateChitti: () => void;
  onOpenNocoDB: () => void;
}

export const StickyAppBar: React.FC<StickyAppBarProps> = ({
  currentTenantId,
  mathTemplates,
  currentFormulaId,
  onSelectFormula,
  chittis,
  currentChittiId,
  onSelectChitti,
  activeMonth,
  totalMonths,
  monthPayout,
  totalPending,
  onOpenCreateChitti,
  onOpenNocoDB,
}) => {
  // Filter chittis based on selected math engine template
  const filteredChittis = (chittis || []).filter(
    (c) => !currentFormulaId || c.formula_id === currentFormulaId
  );

  const uniqueMathTemplates = Array.from(
    new Map((mathTemplates || []).map(m => [m.formula_id, m])).values()
  );
  const uniqueFilteredChittis = Array.from(
    new Map((filteredChittis || []).map(c => [c.chitti_id, c])).values()
  );

  return (
    <header className="relative bg-slate-900 text-white shadow-lg border-b border-slate-800">
      {/* Top Branding Bar */}
      <div className="bg-slate-950 px-3 py-1 flex items-center justify-between border-b border-slate-800/80 text-[11px]">
        <span className="font-bold tracking-wide text-slate-300 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenNocoDB}
            className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-md hover:bg-emerald-500/20 transition font-medium cursor-pointer"
          >
            <Database className="w-3 h-3" /> DB Connected
          </button>
          <span className="text-slate-400 hidden sm:flex items-center gap-1 font-medium">
            <Zap className="w-3 h-3 text-amber-400" /> ClearFlow Automations
          </span>
        </div>
      </div>

      {/* 3-Tier Hierarchy App Bar: Manager Name -> Math Formula -> Chitti Group */}
      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-slate-800 text-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Tier 1: Manager Isolated ID (Static Display) */}
          <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700">
            <Mail className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium">Manager:</span>
            <span className="text-white font-semibold truncate max-w-[200px]">
              {currentTenantId || "Not Logged In"}
            </span>
          </div>

          <button
            onClick={onOpenCreateChitti}
            className="shrink-0 bg-sky-600 hover:bg-sky-500 text-white px-2.5 py-1.5 rounded-lg font-medium text-xs transition shadow-sm"
          >
            + New Chitti
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Tier 2: Math Formula Template Filter */}
          <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700">
            <FunctionSquare className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium shrink-0">Math Engine:</span>
            <select
              value={currentFormulaId}
              onChange={(e) => onSelectFormula(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer w-full truncate"
            >
              {uniqueMathTemplates.map((m, idx) => (
                <option key={`${m.formula_id}-${idx}`} value={m.formula_id} className="bg-slate-800 text-white">
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tier 3: Filtered Chitti Group / Scheme Level */}
          <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700">
            <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium shrink-0">Chitti Group:</span>
            <select
              value={currentChittiId}
              onChange={(e) => onSelectChitti(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer w-full truncate"
            >
              {uniqueFilteredChittis.length > 0 ? (
                uniqueFilteredChittis.map((c, idx) => (
                  <option key={`${c.chitti_id}-${idx}`} value={c.chitti_id} className="bg-slate-800 text-white">
                    {c.name} ({c.chitti_id})
                  </option>
                ))
              ) : (
                <option value="" disabled className="bg-slate-800 text-slate-400">
                  No chittis for this engine
                </option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Key Metrics Ticker (3-column horizontal pill) */}
      <div className="grid grid-cols-3 gap-1 p-2 bg-slate-950/60 text-center">
        {/* Calendar Derived Active Month */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-1.5 flex flex-col items-center justify-center">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-0.5">
            <Calendar className="w-3 h-3 text-sky-400" /> Active Month
          </span>
          <span className="text-sm font-bold text-sky-400 mt-0.5">
            M{activeMonth}<span className="text-xs text-slate-500 font-normal">/{totalMonths}</span>
          </span>
        </div>

        {/* Month Payout */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-1.5 flex flex-col items-center justify-center">
          <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold flex items-center gap-0.5">
            <DollarSign className="w-3 h-3" /> Payout M{activeMonth}
          </span>
          <span className="text-sm font-bold text-emerald-300 mt-0.5">
            ₹{monthPayout?.toLocaleString("en-IN") || 0}
          </span>
        </div>

        {/* Total Pending / Arrears */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-1.5 flex flex-col items-center justify-center">
          <span className="text-[10px] text-rose-400 uppercase tracking-wider font-semibold flex items-center gap-0.5">
            <AlertTriangle className="w-3 h-3" /> Arrears
          </span>
          <span className="text-sm font-bold text-rose-300 mt-0.5">
            ₹{totalPending?.toLocaleString("en-IN") || 0}
          </span>
        </div>
      </div>
    </header>
  );
};
