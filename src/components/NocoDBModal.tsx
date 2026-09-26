import React, { useState, useEffect } from "react";
import { Database, CheckCircle2, AlertCircle, RefreshCw, X, ExternalLink, Server, Layers } from "lucide-react";

interface NocoDBModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NocoDBModal: React.FC<NocoDBModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ success?: boolean; base_id?: string; tables?: any[]; error?: string } | null>(null);

  const fetchNocoStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sync-nocodb");
      const data = await res.json();
      setStatus(data);
    } catch (err: any) {
      setStatus({ success: false, error: err.message || "Failed to connect to NocoDB" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNocoStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                NocoDB Cloud Connection
              </h3>
              <p className="text-xs text-slate-400">Real-time database sync & table bindings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5 overflow-y-auto space-y-4 flex-1">
          {/* Connection Endpoint & Base ID Card */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">NocoDB Instance URL</span>
              <a
                href="https://nocodbclearflow.duckdns.org"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-400 hover:underline flex items-center gap-1 font-mono"
              >
                nocodbclearflow.duckdns.org <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
              <span className="text-xs text-slate-400 font-medium">Workspace Base ID</span>
              <span className="text-xs font-mono bg-slate-800 px-2 py-1 rounded text-emerald-400">
                p4277q2gv93p704
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
              <span className="text-xs text-slate-400 font-medium">Sync Status</span>
              {loading ? (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Verifying Connection...
                </span>
              ) : status?.success ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected & Fully Synchronized
                </span>
              ) : (
                <span className="text-xs text-rose-400 flex items-center gap-1 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5" /> Connection Failed
                </span>
              )}
            </div>
          </div>

          {status?.error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              Error: {status.error}
            </div>
          )}

          {/* Synchronized Tables Section */}
          <div>
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" /> Synchronized NocoDB Tables ({status?.tables?.length || 6})
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { name: "tenants", desc: "Manager accounts & permissions" },
                { name: "mathTemplates", desc: "Python calculation modules" },
                { name: "chittis", desc: "Chitti fund master settings" },
                { name: "shares", desc: "Member shares & win months" },
                { name: "transactions", desc: "Payment records & ledgers" },
                { name: "chittiExpenses", desc: "Credits & debits tracking" },
              ].map((tbl) => {
                const found = status?.tables?.find(
                  (t: any) =>
                    t.table_name === tbl.name ||
                    t.title === tbl.name ||
                    t.table_name?.includes(tbl.name)
                );
                return (
                  <div
                    key={tbl.name}
                    className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white font-mono">{tbl.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {found ? "Active Table" : "Auto-Created"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{tbl.desc}</p>
                    {found && found.id && (
                      <span className="text-[10px] text-slate-500 font-mono mt-1">ID: {found.id}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={fetchNocoStatus}
            disabled={loading}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-xs font-medium flex items-center gap-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Test & Refresh Sync
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-600/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
