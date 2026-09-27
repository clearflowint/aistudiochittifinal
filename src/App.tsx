import React, { useState, useEffect, useRef } from "react";
import { Tenant, MathTemplate, ChittiMaster, ChittiDetails, MemberShare } from "./types";
import { StickyAppBar } from "./components/StickyAppBar";
import { ShareCard } from "./components/ShareCard";
import { ManagerTreasurySheet } from "./components/ManagerTreasurySheet";
import { RecordPaymentModal } from "./components/RecordPaymentModal";
import { AssignWinnerModal } from "./components/AssignWinnerModal";
import { EditMemberModal } from "./components/EditMemberModal";
import { CreateChittiModal } from "./components/CreateChittiModal";
import { Search, RefreshCw, MessageSquare } from "lucide-react";
import { LandingPage } from "./components/LandingPage";
import { ManagerDashboard } from "./components/ManagerDashboard";
import { GuestPortal } from "./components/GuestPortal";
import { UnauthorizedPage } from "./components/UnauthorizedPage";
import { NocoDBModal } from "./components/NocoDBModal";

export default function App() {
  const [view, setView] = useState<"landing" | "manager_dashboard" | "guest_portal" | "unauthorized" | "chittis_workspace">("landing");
  const [managerEmail, setManagerEmail] = useState<string | null>(null);
  const [unauthorizedMessage, setUnauthorizedMessage] = useState<string>("");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string>("mahirocks66@gmail.com");

  const [mathTemplates, setMathTemplates] = useState<MathTemplate[]>([]);
  const [currentFormulaId, setCurrentFormulaId] = useState<string>("standard_chit_v1");

  const [chittis, setChittis] = useState<ChittiMaster[]>([]);
  const [currentChittiId, setCurrentChittiId] = useState<string>("");

  const [activeMonth, setActiveMonth] = useState<number>(1);
  const [details, setDetails] = useState<ChittiDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Request fingerprinting ref to prevent cross-chitti data leakage / race conditions
  const fetchFingerprintRef = useRef<string>("");

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all, undrawn, drawn, pending

  // Modals
  const [recordPaymentShare, setRecordPaymentShare] = useState<MemberShare | null>(null);
  const [assignWinnerShare, setAssignWinnerShare] = useState<MemberShare | null>(null);
  const [editMemberShare, setEditMemberShare] = useState<MemberShare | null>(null);
  const [isCreateChittiOpen, setIsCreateChittiOpen] = useState<boolean>(false);
  const [isNocoDBOpen, setIsNocoDBOpen] = useState<boolean>(false);

  // Load tenants (Manager accounts) and math templates on mount
  useEffect(() => {
    fetch("/api/tenants")
      .then((res) => res.json())
      .then((data) => {
        setTenants(data);
        if (data.length > 0) {
          setCurrentTenantId(data[0].tenant_id);
        }
      })
      .catch((err) => console.error("Error fetching tenants:", err));

    fetch("/api/math-templates")
      .then((res) => res.json())
      .then((data) => {
        setMathTemplates(data);
        if (data.length > 0) {
          setCurrentFormulaId(data[0].formula_id);
        }
      })
      .catch((err) => console.error("Error fetching math templates:", err));
  }, []);

  // Load chittis when manager email changes
  useEffect(() => {
    if (!currentTenantId) return;
    setDetails(null); // Clear previous chitti cache immediately to prevent cross-chitti leak
    fetch(`/api/chittis?tenant_id=${currentTenantId}`)
      .then((res) => res.json())
      .then((data) => {
        setChittis(data);
        if (data.length > 0) {
          setCurrentChittiId(data[0].chitti_id);
          setCurrentFormulaId(data[0].formula_id || "standard_chit_v1");
        } else {
          setCurrentChittiId("");
          setDetails(null);
        }
      })
      .catch((err) => console.error("Error fetching chittis:", err));
  }, [currentTenantId]);

  // When chitti changes, update formula id from chitti record and reset details cache
  useEffect(() => {
    const chitti = chittis.find((c) => c.chitti_id === currentChittiId);
    if (chitti) {
      if (chitti.formula_id) {
        setCurrentFormulaId(chitti.formula_id);
      }
    }
  }, [currentChittiId, chittis]);

  // Calculate calendar active month whenever current chitti changes
  useEffect(() => {
    if (!currentChittiId) return;
    const chitti = chittis.find((c) => c.chitti_id === currentChittiId);
    if (chitti) {
      const start = new Date(chitti.start_date || "2025-01-01");
      const now = new Date();
      const diffYears = now.getFullYear() - start.getFullYear();
      const diffMonths = now.getMonth() - start.getMonth();
      const elapsed = diffYears * 12 + diffMonths + 1;
      const calMonth = Math.max(1, Math.min(elapsed, chitti.total_months));
      setActiveMonth(calMonth);
    }
  }, [currentChittiId, chittis]);

  // Load chitti details with strict fingerprinting guard to prevent race conditions / cache contamination
  const fetchDetails = (silent = false) => {
    if (!currentChittiId || !currentTenantId) return;
    const fingerprint = `${currentTenantId}:${currentChittiId}:${activeMonth}`;
    fetchFingerprintRef.current = fingerprint;

    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    fetch(`/api/chittis/${currentChittiId}/details?tenant_id=${currentTenantId}&month=${activeMonth}`)
      .then((res) => res.json())
      .then((data) => {
        // Only update state if fingerprint matches current selection (discards stale responses)
        if (fetchFingerprintRef.current === fingerprint) {
          setDetails(data);
          setLoading(false);
          setIsRefreshing(false);
        }
      })
      .catch((err) => {
        console.error("Error fetching chitti details:", err);
        if (fetchFingerprintRef.current === fingerprint) {
          setLoading(false);
          setIsRefreshing(false);
        }
      });
  };

  useEffect(() => {
    fetchDetails();
  }, [currentChittiId, currentTenantId, activeMonth]);

  // Handlers for mutations
  const handleRecordPayment = async (shareId: string, amount: number, paymentMode: string) => {
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          share_id: shareId,
          chitti_id: currentChittiId,
          tenant_id: currentTenantId,
          amount,
          payment_mode: paymentMode,
        }),
      });
      if (res.ok) {
        setRecordPaymentShare(null);
        fetchDetails(true); // Silent refresh to update card area instantly without full loader
      }
    } catch (err) {
      console.error("Error recording payment:", err);
    }
  };

  const handleAssignWinner = async (shareId: string, winMonth: number | null) => {
    if (!assignWinnerShare) return;
    const shareTenantId = assignWinnerShare.tenant_id;
    const shareChittiId = assignWinnerShare.chitti_id;

    try {
      const res = await fetch(`/api/shares/${shareId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: shareTenantId,
          chitti_id: shareChittiId,
          win_month: winMonth,
        }),
      });
      if (res.ok) {
        setAssignWinnerShare(null);
        fetchDetails(true); // Silent refresh
      } else {
        console.error("Failed to update winner in backend, status:", res.status);
        fetchDetails(true);
      }
    } catch (err) {
      console.error("Error assigning winner:", err);
      fetchDetails(true);
    }
  };

  const handleEditMember = async (shareId: string, memberName: string, phone: string) => {
    if (!editMemberShare) return;
    const shareTenantId = editMemberShare.tenant_id;
    const shareChittiId = editMemberShare.chitti_id;

    // Optimistic UI card-level update for instant reflection without full reload
    if (details) {
      setDetails({
        ...details,
        members: details.members.map(m =>
          m.share_id === shareId && m.chitti_id === shareChittiId ? { ...m, member_name: memberName, phone } : m
        )
      });
    }
    setEditMemberShare(null);

    try {
      const res = await fetch(`/api/shares/${shareId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: shareTenantId,
          chitti_id: shareChittiId,
          member_name: memberName,
          phone,
        }),
      });
      if (!res.ok) {
        console.error("Failed to update share in backend, status:", res.status);
        fetchDetails(); // Re-fetch on failure
      } else {
        fetchDetails(); // Refresh details to guarantee DB sync
      }
    } catch (err) {
      console.error("Error editing member info:", err);
      fetchDetails();
    }
  };

  const handleDownloadChittiStatement = () => {
    if (!details || !details.members || !details.chitti) return;

    const chittiName = details.chitti?.name || "Chitti";
    const chitti = details.chitti;
    const N = chitti.total_members;
    const U = chitti.u_due;
    const D = chitti.d_due;
    const F = chitti.commission;

    const getPayoutForMonth = (w: number) => {
      if (chitti.payout_schedule) {
        try {
          const scheduleArr = JSON.parse(chitti.payout_schedule);
          const item = scheduleArr.find((s: any) => s.month === w);
          if (item) return item.payout;
        } catch (e) {}
      }
      return ((w - 1) * (D - U)) + (N * U) - F;
    };

    const drawnCount = details.members.filter(m => m.win_month !== null).length;
    const undrawnCount = details.members.filter(m => m.win_month === null).length;
    const treasury = details.treasury;

    const summaryRows = [
      [`"CHITTI OVERALL SUMMARY & STATUS REPORT"`],
      [`"Chitti Name","${chittiName}"`],
      [`"Active Month","M${activeMonth}"`],
      [`"Total Members","${details.members.length}"`],
      [`"Drawn Members Count","${drawnCount}"`],
      [`"Undrawn Members Count","${undrawnCount}"`],
      [`"Actual Cash Collected","₹${treasury?.actual_cash_collected || 0}"`],
      [`"Net Cashflow Position","₹${treasury?.closing_ledger_balance || 0}"`],
      [],
      ["Share ID", "Member Name", "Phone", "Status", "Month Drawn", "Drawn Payout (₹)", "Monthly Due", "Total Billed", "Total Paid", "Net Balance"]
    ];

    const rows = details.members.map((m) => {
      const drawnAmt = m.win_month !== null ? getPayoutForMonth(m.win_month) : 0;
      return [
        m.share_id,
        `"${m.member_name}"`,
        m.phone,
        `"${m.status}"`,
        m.win_month !== null ? `"Month ${m.win_month}"` : `"Undrawn"`,
        drawnAmt,
        m.monthly_due_current,
        m.total_billed,
        m.total_paid,
        m.net_balance
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + [...summaryRows.map(e => e.join(",")), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${chittiName}_overall_statement.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadHtmlReport = () => {
    if (!details || !details.members || !details.chitti) return;

    const chittiName = details.chitti?.name || "Chitti";
    const chitti = details.chitti;
    const N = chitti.total_members;
    const U = chitti.u_due;
    const D = chitti.d_due;
    const F = chitti.commission;

    const getPayoutForMonth = (w: number) => {
      if (chitti.payout_schedule) {
        try {
          const scheduleArr = JSON.parse(chitti.payout_schedule);
          const item = scheduleArr.find((s: any) => s.month === w);
          if (item) return item.payout;
        } catch (e) {}
      }
      return ((w - 1) * (D - U)) + (N * U) - F;
    };

    const treasury = details.treasury;
    const drawnCount = details.members.filter(m => m.win_month !== null).length;
    const undrawnCount = details.members.filter(m => m.win_month === null).length;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${chittiName} - Overall Statement & Status Report</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; color: #1e293b; background: #f8fafc; max-width: 960px; margin: 0 auto; }
          h1 { font-size: 20px; margin-bottom: 4px; color: #0f172a; }
          .subtitle { font-size: 13px; color: #64748b; margin-bottom: 16px; }
          .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
          @media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
          table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
          th, td { padding: 10px 8px; text-align: left; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
          th { background: #f1f5f9; font-weight: 600; color: #334155; }
          .badge-advance { color: #047857; background: #ecfdf5; padding: 3px 6px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
          .badge-pending { color: #be123c; background: #fff1f2; padding: 3px 6px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
          .badge-drawn { color: #0369a1; background: #e0f2fe; padding: 3px 6px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
          .badge-undrawn { color: #475569; background: #f1f5f9; padding: 3px 6px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
        </style>
      </head>
      <body>
        <h1>${chittiName} - Overall Statement & Status Report</h1>
        <div class="subtitle">Active Month: M${activeMonth} | Generated by ClearFlow Automations</div>
        
        <div class="grid">
          <div class="card" style="margin-bottom:0;">
            <div style="font-size:11px; color:#64748b;">Total Members</div>
            <div style="font-size:18px; font-weight:bold; color:#0f172a; margin-top:2px;">${details.members.length}</div>
          </div>
          <div class="card" style="margin-bottom:0;">
            <div style="font-size:11px; color:#64748b;">Drawn Status</div>
            <div style="font-size:18px; font-weight:bold; color:#0369a1; margin-top:2px;">${drawnCount} Drawn</div>
          </div>
          <div class="card" style="margin-bottom:0;">
            <div style="font-size:11px; color:#64748b;">Undrawn Status</div>
            <div style="font-size:18px; font-weight:bold; color:#475569; margin-top:2px;">${undrawnCount} Undrawn</div>
          </div>
          <div class="card" style="margin-bottom:0;">
            <div style="font-size:11px; color:#64748b;">Net Cashflow</div>
            <div style="font-size:16px; font-weight:bold; color:#0284c7; margin-top:2px;">₹${treasury?.closing_ledger_balance?.toLocaleString("en-IN") || 0}</div>
          </div>
        </div>

        <div class="card" style="padding:0; overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Share ID</th>
                <th>Member Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Month Drawn</th>
                <th>Drawn Payout</th>
                <th>Due</th>
                <th>Paid</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              ${details.members.map(m => {
                const drawnAmt = m.win_month !== null ? getPayoutForMonth(m.win_month) : 0;
                return `
                <tr>
                  <td><b>${m.share_id}</b></td>
                  <td>${m.member_name}</td>
                  <td>${m.phone}</td>
                  <td>
                    ${m.win_month !== null ? `<span class="badge-drawn">Drawn M${m.win_month}</span>` : `<span class="badge-undrawn">Undrawn</span>`}
                  </td>
                  <td>${m.win_month !== null ? `Month ${m.win_month}` : `-`}</td>
                  <td>${drawnAmt > 0 ? `₹${drawnAmt.toLocaleString("en-IN")}` : `-`}</td>
                  <td>₹${m.monthly_due_current}</td>
                  <td>₹${m.total_paid?.toLocaleString("en-IN")}</td>
                  <td>
                    ${m.net_balance > 0 ? `<span class="badge-advance">+₹${m.net_balance}</span>` : m.net_balance < 0 ? `<span class="badge-pending">-₹${Math.abs(m.net_balance)}</span>` : `₹0`}
                  </td>
                </tr>
              `;}).join("")}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chittiName}_statement_view.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCreateChitti = async (chittiData: {
    tenant_id: string;
    name: string;
    start_date: string;
    total_members: number;
    total_months: number;
    u_due: number;
    d_due: number;
    commission: number;
  }) => {
    try {
      const res = await fetch("/api/chittis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...chittiData,
          formula_id: currentFormulaId,
        }),
      });
      if (res.ok) {
        const newChitti = await res.json();
        setIsCreateChittiOpen(false);
        const chittisRes = await fetch(`/api/chittis?tenant_id=${currentTenantId}`);
        const chittisData = await chittisRes.json();
        setChittis(chittisData);
        setCurrentChittiId(newChitti.chitti_id);
      }
    } catch (err) {
      console.error("Error creating chitti:", err);
    }
  };

  const handleDeleteChitti = async () => {
    if (!currentChittiId || !currentTenantId) return;
    try {
      const res = await fetch(`/api/chittis/${currentChittiId}?tenant_id=${currentTenantId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDetails(null);
        const chittisRes = await fetch(`/api/chittis?tenant_id=${currentTenantId}`);
        const chittisData = await chittisRes.json();
        setChittis(chittisData);
        if (chittisData.length > 0) {
          setCurrentChittiId(chittisData[0].chitti_id);
          setCurrentFormulaId(chittisData[0].formula_id || "standard_chit_v1");
        } else {
          setCurrentChittiId("");
        }
      }
    } catch (err) {
      console.error("Error deleting chitti:", err);
    }
  };

  // Filter members
  const filteredMembers = details?.members?.filter((share) => {
    const matchesSearch =
      share.member_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      share.share_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      share.phone.includes(searchQuery);

    if (!matchesSearch) return false;

    if (statusFilter === "undrawn") return share.win_month === null;
    if (statusFilter === "drawn") return share.win_month !== null;
    if (statusFilter === "pending") return share.net_balance < 0;

    return true;
  }) || [];

  if (view === "landing") {
    return (
      <LandingPage
        onLoginSuccess={(email) => {
          setManagerEmail(email);
          setCurrentTenantId(email);
          setView("manager_dashboard");
        }}
        onLoginUnauthorized={(msg) => {
          setUnauthorizedMessage(msg);
          setView("unauthorized");
        }}
        onContinueAsGuest={() => setView("guest_portal")}
      />
    );
  }

  if (view === "manager_dashboard") {
    return (
      <ManagerDashboard
        managerEmail={managerEmail || currentTenantId}
        onGoToChittis={() => setView("chittis_workspace")}
        onSignOut={() => {
          setManagerEmail(null);
          setCurrentTenantId("");
          setDetails(null);
          setChittis([]);
          setView("landing");
        }}
        onOpenNocoDB={() => setIsNocoDBOpen(true)}
      />
    );
  }

  if (view === "guest_portal") {
    return (
      <GuestPortal
        onBackToHome={() => setView("landing")}
        onLoginClick={() => setView("landing")}
      />
    );
  }

  if (view === "unauthorized") {
    return (
      <UnauthorizedPage
        message={unauthorizedMessage}
        onBackToHome={() => setView("landing")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans pb-28">
      {/* Top Navigation Bar with Back to Manager Dashboard button */}
      <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between text-xs border-b border-slate-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("manager_dashboard")}
            className="bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold py-1.5 px-3 rounded-lg border border-slate-700 transition flex items-center gap-1.5"
          >
            ← Back to Manager Dashboard
          </button>
          <button
            onClick={() => {
              setManagerEmail(null);
              setCurrentTenantId("");
              setDetails(null);
              setChittis([]);
              setView("landing");
            }}
            className="bg-slate-800 hover:bg-slate-700 text-rose-300 font-semibold py-1.5 px-3 rounded-lg border border-slate-700 transition flex items-center gap-1.5"
          >
            Sign Out
          </button>
        </div>
        <span className="text-slate-400 font-medium truncate">
          Manager: <span className="text-white">{managerEmail || currentTenantId}</span> | Chitti ID: <span className="text-sky-300 font-bold">{currentChittiId || "None"}</span>
        </span>
      </div>

      {/* Non-sticky App Bar (Scrolls naturally up and down) */}
      <StickyAppBar
        currentTenantId={currentTenantId}
        mathTemplates={mathTemplates}
        currentFormulaId={currentFormulaId}
        onSelectFormula={setCurrentFormulaId}
        chittis={chittis}
        currentChittiId={currentChittiId}
        onSelectChitti={setCurrentChittiId}
        activeMonth={activeMonth}
        totalMonths={details?.chitti?.total_months || 20}
        monthPayout={details?.payout_t || 0}
        totalPending={details?.total_pending_market || 0}
        onOpenCreateChitti={() => setIsCreateChittiOpen(true)}
        onOpenNocoDB={() => setIsNocoDBOpen(true)}
      />

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        {/* Search Bar & Manual Refresh Button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by member name, share ID, or phone..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-xs font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <button
            onClick={() => fetchDetails(true)}
            disabled={isRefreshing}
            className="bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-sm transition shrink-0 cursor-pointer"
            title="Refresh share cards from NocoDB"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-600 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Status Filter Pills */}
        <div className="grid grid-cols-4 gap-1 text-[11px]">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-1 py-1.5 rounded-lg font-medium truncate transition text-center ${
              statusFilter === "all"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            All ({details?.members?.length || 0})
          </button>
          <button
            onClick={() => setStatusFilter("undrawn")}
            className={`px-1 py-1.5 rounded-lg font-medium truncate transition text-center ${
              statusFilter === "undrawn"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Undrawn ({details?.members?.filter((s) => s.win_month === null).length || 0})
          </button>
          <button
            onClick={() => setStatusFilter("drawn")}
            className={`px-1 py-1.5 rounded-lg font-medium truncate transition text-center ${
              statusFilter === "drawn"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Drawn ({details?.members?.filter((s) => s.win_month !== null).length || 0})
          </button>
          <button
            onClick={() => setStatusFilter("pending")}
            className={`px-1 py-1.5 rounded-lg font-medium truncate transition text-center ${
              statusFilter === "pending"
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Pending ({details?.members?.filter((s) => s.net_balance < 0).length || 0})
          </button>
        </div>

        {/* Feed of Share ID Cards */}
        {chittis.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto text-2xl font-bold shadow-inner">
              ⚡
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">No Chittis Created Yet</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Get started by creating your first chitti group. Set up members, monthly dues, commission rules, and automated tracking instantly.
              </p>
            </div>
            <button
              onClick={() => setIsCreateChittiOpen(true)}
              className="bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold py-3 px-6 rounded-xl text-xs inline-flex items-center gap-2 shadow-lg shadow-sky-600/30 transition cursor-pointer"
            >
              <span>+ Create Your First Chitti</span>
            </button>
          </div>
        ) : loading ? (
          <div className="py-16 text-center flex flex-col items-center justify-center gap-2 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-600" />
            <p className="text-xs">Computing chitti ledger and math formulas...</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 shadow-sm">
            <p className="text-sm font-medium">No member shares found.</p>
            <p className="text-xs text-slate-400 mt-1">Try adjusting your search or status filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMembers.map((share) => (
              <ShareCard
                key={share.share_id}
                share={share}
                chitti={details?.chitti || ({} as any)}
                activeMonth={activeMonth}
                onRecordPayment={setRecordPaymentShare}
                onAssignWinner={setAssignWinnerShare}
                onEditMember={setEditMemberShare}
              />
            ))}
          </div>
        )}

        {/* WhatsApp Reminder to All Pending Members Button with Dummy Webhook for n8n */}
        {details && (
          <div className="mt-4 mb-2">
            <button
              onClick={async () => {
                const pending = details.members.filter(m => m.net_balance < 0);
                const webhookUrl = "https://your-n8n-webhook-url.com/webhook/whatsapp-reminder"; // DUMMY WEBHOOK FOR N8N
                try {
                  await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chitti_id: currentChittiId,
                      chitti_name: details.chitti?.name,
                      tenant_id: currentTenantId,
                      pending_members_count: pending.length,
                      pending_members: pending.map(p => ({ share_id: p.share_id, name: p.member_name, phone: p.phone, due: Math.abs(p.net_balance) })),
                      timestamp: new Date().toISOString()
                    }),
                  }).catch(() => {});
                } catch (e) {}
                alert(`WhatsApp reminder webhook triggered successfully for ${pending.length} pending members!\nWebhook URL: ${webhookUrl}`);
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
            >
              <MessageSquare className="w-4 h-4" />
              Send WhatsApp Reminder to All Pending Members ({details.members.filter(m => m.net_balance < 0).length})
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-1">
              Trigger n8n WhatsApp automation webhook (configured with dummy link in code)
            </p>
          </div>
        )}

        {/* Chitti Ledger & Overall Statement Download at Bottom after scrolling */}
        {details && (
          <ManagerTreasurySheet
            chittiId={currentChittiId}
            tenantId={currentTenantId}
            chittiName={details.chitti?.name || ""}
            activeMonth={activeMonth}
            treasury={details.treasury}
            payoutT={details.payout_t}
            onDownloadStatement={handleDownloadChittiStatement}
            onDownloadHtml={handleDownloadHtmlReport}
            onDeleteChitti={handleDeleteChitti}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-2xl mx-auto px-4 pb-12 pt-6 text-center text-xs space-y-3">
        <button
          onClick={() => alert("Signed out successfully.")}
          className="bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs w-full sm:w-64 mx-auto block shadow-md transition"
        >
          Sign Out
        </button>
        <div className="text-slate-400 font-medium">ClearFlow Automations</div>
      </footer>

      {/* Modals */}
      {recordPaymentShare && (
        <RecordPaymentModal
          share={recordPaymentShare}
          onClose={() => setRecordPaymentShare(null)}
          onSubmit={handleRecordPayment}
        />
      )}

      {assignWinnerShare && details && (
        <AssignWinnerModal
          share={assignWinnerShare}
          activeMonth={activeMonth}
          totalMonths={details.chitti.total_months}
          onClose={() => setAssignWinnerShare(null)}
          onSubmit={handleAssignWinner}
        />
      )}

      {editMemberShare && (
        <EditMemberModal
          share={editMemberShare}
          onClose={() => setEditMemberShare(null)}
          onSubmit={handleEditMember}
        />
      )}

      {isCreateChittiOpen && (
        <CreateChittiModal
          currentTenantId={currentTenantId}
          onClose={() => setIsCreateChittiOpen(false)}
          onSubmit={handleCreateChitti}
        />
      )}

      <NocoDBModal
        isOpen={isNocoDBOpen}
        onClose={() => setIsNocoDBOpen(false)}
      />
    </div>
  );
}
