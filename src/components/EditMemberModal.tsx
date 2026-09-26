import React, { useState } from "react";
import { MemberShare } from "../types";
import { X, Phone, User, Edit3 } from "lucide-react";

interface EditMemberModalProps {
  share: MemberShare;
  onClose: () => void;
  onSubmit: (shareId: string, memberName: string, phone: string) => void;
}

export const EditMemberModal: React.FC<EditMemberModalProps> = ({
  share,
  onClose,
  onSubmit,
}) => {
  const [memberName, setMemberName] = useState(share.member_name);
  // Clean phone number to 10 digits if +91 is present
  const cleanPhone = share.phone ? share.phone.replace(/^\+?91\s*/, "") : "";
  const [phone, setPhone] = useState(cleanPhone);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim()) return;
    const finalPhone = `+91${phone.trim()}`;
    onSubmit(share.share_id, memberName.trim(), finalPhone);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-sm">Edit Member Info</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tag Banner showing Tenant ID / Manager ID, Chitti ID, Share ID */}
        <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 text-[11px] font-mono text-slate-700 space-y-0.5">
          <div><strong className="text-slate-900">Tenant / Manager ID:</strong> {share.tenant_id}</div>
          <div><strong className="text-slate-900">Chitti ID:</strong> {share.chitti_id}</div>
          <div><strong className="text-slate-900">Share ID:</strong> {share.share_id}</div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Member Name</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number / WhatsApp</label>
            <div className="flex rounded-xl overflow-hidden border border-slate-300 bg-slate-50 focus-within:ring-2 focus-within:ring-sky-500">
              <div className="flex items-center gap-1.5 px-3 bg-slate-200 text-slate-700 font-bold text-xs select-none border-r border-slate-300">
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span>+91</span>
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
                required
                className="w-full px-3 py-2 bg-transparent text-slate-900 font-medium focus:outline-none text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
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
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

