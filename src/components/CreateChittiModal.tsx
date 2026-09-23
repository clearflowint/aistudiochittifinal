import React, { useState } from "react";
import { X, Layers, DollarSign } from "lucide-react";

interface CreateChittiModalProps {
  currentTenantId: string;
  onClose: () => void;
  onSubmit: (chittiData: {
    tenant_id: string;
    name: string;
    start_date: string;
    total_members: number;
    total_months: number;
    u_due: number;
    d_due: number;
    commission: number;
  }) => void;
}

export const CreateChittiModal: React.FC<CreateChittiModalProps> = ({
  currentTenantId,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [totalMembers, setTotalMembers] = useState("20");
  const [totalMonths, setTotalMonths] = useState("20");
  const [uDue, setUDue] = useState("5000");
  const [dDue, setDDue] = useState("6000");
  const [commission, setCommission] = useState("2000");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      tenant_id: currentTenantId,
      name: name.trim(),
      start_date: startDate,
      total_members: Number(totalMembers) || 20,
      total_months: Number(totalMonths) || 20,
      u_due: Number(uDue) || 5000,
      d_due: Number(dDue) || 6000,
      commission: Number(commission) || 2000,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-sm">Create New Chitti Scheme</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Chitti Scheme Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apex Diamond 20-Month Chit"
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Chitti Start Date / Chitti Cycle Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-0.5">
              Supports ongoing or previously running chittis (e.g., started years ago).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Total Members (N)</label>
              <input
                type="number"
                value={totalMembers}
                onChange={(e) => setTotalMembers(e.target.value)}
                min="5"
                max="100"
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Total Months</label>
              <input
                type="number"
                value={totalMonths}
                onChange={(e) => setTotalMonths(e.target.value)}
                min="5"
                max="100"
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Undrawn Due (U) in ₹</label>
              <input
                type="number"
                value={uDue}
                onChange={(e) => setUDue(e.target.value)}
                step="500"
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Drawn Due (D) in ₹</label>
              <input
                type="number"
                value={dDue}
                onChange={(e) => setDDue(e.target.value)}
                step="500"
                required
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Flat Monthly Commission (F) in ₹</label>
            <input
              type="number"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              step="500"
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Used in payout formula: Payout_t = [(t-1) * (D - U)] + (N * U) - F
            </p>
          </div>

          <div className="flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 rounded-xl text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-1/2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-semibold py-2.5 rounded-xl text-xs transition shadow-sm"
            >
              Create Chitti
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
