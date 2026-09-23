import React, { useState } from "react";
import { MemberShare, ChittiMaster } from "../types";
import { Phone, CheckCircle2, AlertCircle, Award, CreditCard, User, MessageSquare, Edit2, FileText } from "lucide-react";
import { ShareStatementModal } from "./ShareStatementModal";

interface ShareCardProps {
  share: MemberShare;
  chitti: ChittiMaster;
  activeMonth: number;
  onRecordPayment: (share: MemberShare) => void;
  onAssignWinner: (share: MemberShare) => void;
  onEditMember: (share: MemberShare) => void;
}

export const ShareCard: React.FC<ShareCardProps> = ({
  share,
  chitti,
  activeMonth,
  onRecordPayment,
  onAssignWinner,
  onEditMember,
}) => {
  const [isStatementOpen, setIsStatementOpen] = useState<boolean>(false);
  const isDrawn = share.win_month !== null;

  const handleSendReminder = () => {
    const pendingDue = share.net_balance < 0 ? Math.abs(share.net_balance) : 0;
    const message = encodeURIComponent(
      `Hello ${share.member_name}, payment reminder from ${chitti.name} for Share ID ${share.share_id}. Month Progress: ${activeMonth}/${chitti.total_months} months completed. Pending Due Amount: ₹${pendingDue.toLocaleString("en-IN")}. Please clear your dues at your earliest convenience. Thank you!`
    );

    const whatsappUrl = `https://wa.me/${share.phone.replace(/[^0-9]/g, "")}?text=${message}`;
    window.open(whatsappUrl, "_blank");
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-3.5 transition hover:shadow-md space-y-3">
        {/* Header: Share ID, Name, Top-Right: Pending / Advance Amount (Two Lines) */}
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 gap-3">
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <span className="bg-slate-100 text-slate-700 font-mono font-bold text-xs px-2.5 py-1 rounded-md border border-slate-200 shrink-0">
              {share.share_id}
            </span>
            <div className="truncate min-w-0">
              <h3 className="font-semibold text-slate-900 text-sm leading-tight flex items-center gap-1 truncate">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{share.member_name}</span>
              </h3>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 truncate">
                <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate">{share.phone}</span>
              </p>
            </div>
          </div>

          {/* Top Right: Pending / Advance Amount Badge in Two Lines (Amount on top, Label below) */}
          <div className="shrink-0 text-right">
            {share.net_balance > 0 ? (
              <div className="bg-emerald-50 text-emerald-700 font-semibold text-xs px-2.5 py-1 rounded-lg border border-emerald-200 flex flex-col items-end">
                <span className="font-bold text-emerald-800">+₹{share.net_balance.toLocaleString("en-IN")}</span>
                <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Advance
                </span>
              </div>
            ) : share.net_balance < 0 ? (
              <div className="bg-rose-50 text-rose-700 font-bold text-xs px-2.5 py-1 rounded-lg border border-rose-200 flex flex-col items-end animate-pulse">
                <span className="font-bold text-rose-800">-₹{Math.abs(share.net_balance).toLocaleString("en-IN")}</span>
                <span className="text-[10px] text-rose-600 flex items-center gap-0.5">
                  <AlertCircle className="w-3 h-3 text-rose-500" /> Pending
                </span>
              </div>
            ) : (
              <div className="bg-slate-100 text-slate-600 font-medium text-xs px-2.5 py-1 rounded-lg border border-slate-200 flex flex-col items-end">
                <span className="font-bold text-slate-800">₹0</span>
                <span className="text-[10px] text-slate-500">Clear</span>
              </div>
            )}
          </div>
        </div>

        {/* Financial Details (2x2 grid) */}
        <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs">
          <div>
            <span className="text-slate-500 block text-[11px]">Current Due</span>
            <span className="font-semibold text-slate-800">₹{share.monthly_due_current.toLocaleString("en-IN")}/m</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Total Billed</span>
            <span className="font-semibold text-slate-800">₹{share.total_billed.toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Cash Paid</span>
            <span className="font-semibold text-emerald-700">₹{share.total_paid.toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Monthly Due Type</span>
            <span className="font-medium text-slate-600">{isDrawn ? "Drawn (D)" : "Undrawn (U)"}</span>
          </div>
        </div>

        {/* Bottom Row: All buttons grouped starting from the left to prevent right-side miss-touches */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <button
            onClick={() => onEditMember(share)}
            className="text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 text-xs font-medium flex items-center gap-1 transition py-1.5 px-2 rounded-lg border border-slate-200"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
            Edit Info
          </button>
          
          <button
            onClick={() => setIsStatementOpen(true)}
            className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold px-2 py-1.5 rounded-lg flex items-center gap-1 transition"
            title="View full Share ID statement ledger"
          >
            <FileText className="w-3.5 h-3.5 text-sky-600" />
            <span>Statement</span>
          </button>

          <button
            onClick={() => onAssignWinner(share)}
            className={`text-xs font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition ${
              isDrawn
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
            }`}
            title="Click to change winner status"
          >
            <Award className="w-3.5 h-3.5" />
            {share.status}
          </button>

          <button
            onClick={handleSendReminder}
            className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
            title="Send WhatsApp payment reminder"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Reminder
          </button>

          <button
            onClick={() => onRecordPayment(share)}
            className="bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Record Payment
          </button>
        </div>
      </div>

      {/* Share ID Statement Modal */}
      {isStatementOpen && (
        <ShareStatementModal
          share={share}
          chitti={chitti}
          activeMonth={activeMonth}
          onClose={() => setIsStatementOpen(false)}
        />
      )}
    </>
  );
};
