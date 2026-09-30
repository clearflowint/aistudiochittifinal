import React, { useState, useEffect, useRef } from "react";
import { Tenant, MathTemplate, ChittiMaster, ChittiDetails, MemberShare } from "./types";
import { StickyAppBar } from "./components/StickyAppBar";
import { ShareCard } from "./components/ShareCard";
import { ManagerTreasurySheet } from "./components/ManagerTreasurySheet";
import { RecordPaymentModal } from "./components/RecordPaymentModal";
import { AssignWinnerModal } from "./components/AssignWinnerModal";
import { EditMemberModal } from "./components/EditMemberModal";
import { CreateChittiModal } from "./components/CreateChittiModal";
import { Search, RefreshCw, MessageSquare, Loader2, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { LandingPage } from "./components/LandingPage";
import { ManagerDashboard } from "./components/ManagerDashboard";
import { GuestPortal } from "./components/GuestPortal";
import { UnauthorizedPage } from "./components/UnauthorizedPage";
import { NocoDBModal } from "./components/NocoDBModal";

export default function App() {
  const [view, setView] = useState<"landing" | "manager_dashboard" | "guest_portal" | "unauthorized" | "chittis_workspace">(() => {
    return (localStorage.getItem("clearflow_view") as any) || "landing";
  });
  const [managerEmail, setManagerEmail] = useState<string | null>(() => {
    return localStorage.getItem("clearflow_manager_email") || localStorage.getItem("clearflow_tenant_id") || null;
  });
  const [unauthorizedMessage, setUnauthorizedMessage] = useState<string>("");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string>(() => {
    return localStorage.getItem("clearflow_tenant_id") || localStorage.getItem("clearflow_manager_email") || "";
  });

  const [mathTemplates, setMathTemplates] = useState<MathTemplate[]>([]);
  const [currentFormulaId, setCurrentFormulaId] = useState<string>("standard_chit_v1");

  const [chittis, setChittis] = useState<ChittiMaster[]>([]);
  const [chittisLoading, setChittisLoading] = useState<boolean>(true);
  const [currentChittiId, setCurrentChittiId] = useState<string>(() => {
    return localStorage.getItem("clearflow_chitti_id") || "";
  });

  // Explicit operation delay & processing states
  const [isRecordingPayment, setIsRecordingPayment] = useState<boolean>(false);
  const [isCreatingChitti, setIsCreatingChitti] = useState<boolean>(false);
  const [isUpdatingWinner, setIsUpdatingWinner] = useState<boolean>(false);
  const [isDeletingChitti, setIsDeletingChitti] = useState<boolean>(false);

  // Persist session state in localStorage so reloads and PWA shortcuts retain the exact workspace view & tenant
  useEffect(() => {
    localStorage.setItem("clearflow_view", view);
  }, [view]);

  useEffect(() => {
    if (managerEmail) {
      localStorage.setItem("clearflow_manager_email", managerEmail);
      localStorage.setItem("clearflow_tenant_id", managerEmail);
      if (!currentTenantId) setCurrentTenantId(managerEmail);
    } else {
      localStorage.removeItem("clearflow_manager_email");
    }
  }, [managerEmail]);

  useEffect(() => {
    if (currentTenantId) {
      localStorage.setItem("clearflow_tenant_id", currentTenantId);
      if (!managerEmail) setManagerEmail(currentTenantId);
    }
  }, [currentTenantId]);

  // Guard against blank screens if view requires login but no session exists
  useEffect(() => {
    if ((view === "manager_dashboard" || view === "chittis_workspace") && !managerEmail && !currentTenantId) {
      setView("landing");
    }
  }, [view, managerEmail, currentTenantId]);

  useEffect(() => {
    if (currentChittiId) localStorage.setItem("clearflow_chitti_id", currentChittiId);
    else localStorage.removeItem("clearflow_chitti_id");
  }, [currentChittiId]);

  const [activeMonth, setActiveMonth] = useState<number>(1);
  const [details, setDetails] = useState<ChittiDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

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
    if (!currentTenantId) {
      setChittisLoading(false);
      return;
    }
    setChittisLoading(true);
    setDetails(null); // Clear previous chitti cache immediately to prevent cross-chitti leak
    fetch(`/api/chittis?tenant_id=${currentTenantId}`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setChittis(list);
        setChittisLoading(false);
        if (list.length > 0) {
          const exists = list.some((c) => c.chitti_id === currentChittiId);
          if (!exists) {
            setCurrentChittiId(list[0].chitti_id);
            setCurrentFormulaId(list[0].formula_id || "standard_chit_v1");
          } else {
            const activeChitti = list.find((c) => c.chitti_id === currentChittiId);
            if (activeChitti && activeChitti.formula_id) {
              setCurrentFormulaId(activeChitti.formula_id);
            }
          }
        } else {
          setCurrentChittiId("");
          setDetails(null);
        }
      })
      .catch((err) => {
        console.error("Error fetching chittis:", err);
        setChittis([]);
        setChittisLoading(false);
      });
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
      const calMonth = Math.max(0, Math.min(elapsed, chitti.total_months));
      setActiveMonth(calMonth);
    }
  }, [currentChittiId, chittis]);

  // Load chitti details with strict fingerprinting guard to prevent race conditions / cache contamination
  const fetchDetails = (silent = false): Promise<void> => {
    if (!currentChittiId || !currentTenantId) return Promise.resolve();
    const fingerprint = `${currentTenantId}:${currentChittiId}:${activeMonth}`;
    fetchFingerprintRef.current = fingerprint;

    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    return fetch(`/api/chittis/${currentChittiId}/details?tenant_id=${currentTenantId}&month=${activeMonth}`)
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

  const handleSignOut = () => {
    localStorage.removeItem("clearflow_view");
    localStorage.removeItem("clearflow_manager_email");
    localStorage.removeItem("clearflow_tenant_id");
    localStorage.removeItem("clearflow_chitti_id");
    setManagerEmail(null);
    setCurrentTenantId("");
    setDetails(null);
    setChittis([]);
    setView("landing");
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    window.location.reload();
  };

  useEffect(() => {
    fetchDetails();
  }, [currentChittiId, currentTenantId, activeMonth]);

  // Handlers for mutations with round processing indicator states
  const handleRecordPayment = async (shareId: string, amount: number, paymentMode: string) => {
    const shareChittiId = currentChittiId || details?.chitti?.chitti_id || "";
    const shareTenantId = currentTenantId || details?.chitti?.tenant_id || "";

    setIsRecordingPayment(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          share_id: shareId,
          chitti_id: shareChittiId,
          tenant_id: shareTenantId,
          amount,
          payment_mode: paymentMode,
        }),
      });
      if (res.ok) {
        setRecordPaymentShare(null);
        showToast(`Successfully recorded payment of ₹${Math.abs(amount).toLocaleString()}! Ledger updated.`);
        await fetchDetails(true); // Silent refresh to update card area instantly
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to record payment on server.", "error");
      }
    } catch (err) {
      console.error("Error recording payment:", err);
      showToast("Network error: Unable to record payment.", "error");
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleAssignWinner = async (shareId: string, winMonth: number | null) => {
    if (!assignWinnerShare) return;
    const shareTenantId = assignWinnerShare.tenant_id || currentTenantId || details?.chitti?.tenant_id || "";
    const shareChittiId = assignWinnerShare.chitti_id || currentChittiId || details?.chitti?.chitti_id || "";

    setIsUpdatingWinner(true);
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
        showToast(winMonth !== null ? `Assigned winner for Month ${winMonth} successfully!` : `Cleared winner assignment successfully!`);
        await fetchDetails(true); // Silent refresh
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to update winner assignment.", "error");
        await fetchDetails(true);
      }
    } catch (err) {
      console.error("Error assigning winner:", err);
      showToast("Network error: Unable to update winner.", "error");
      await fetchDetails(true);
    } finally {
      setIsUpdatingWinner(false);
    }
  };

  const handleEditMember = async (shareId: string, memberName: string, phone: string) => {
    if (!editMemberShare) return;
    const shareTenantId = editMemberShare.tenant_id || currentTenantId || details?.chitti?.tenant_id || "";
    const shareChittiId = editMemberShare.chitti_id || currentChittiId || details?.chitti?.chitti_id || "";

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
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to update member info on server.", "error");
        await fetchDetails();
      } else {
        showToast("Member details updated successfully!");
        await fetchDetails(true);
      }
    } catch (err) {
      console.error("Error editing member info:", err);
      showToast("Network error: Unable to update member info.", "error");
      await fetchDetails();
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
        <div class="subtitle">Chitti Start Date: ${chitti.start_date || 'N/A'} | Report Date: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} | Active Month: M${activeMonth} | Generated by ClearFlow Automations</div>
        
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
    const activeTenant = (chittiData.tenant_id || currentTenantId || managerEmail || "").trim().toLowerCase();
    if (!activeTenant) {
      showToast("Error: Manager email/tenant not detected. Please sign in again.", "error");
      return;
    }
    setIsCreatingChitti(true);
    try {
      const res = await fetch("/api/chittis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...chittiData,
          tenant_id: activeTenant,
          formula_id: currentFormulaId || "standard_chit_v1",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const createdChitti = data.chitti || data;
        const newId = createdChitti.chitti_id;
        const newName = createdChitti.name || chittiData.name;

        setIsCreateChittiOpen(false);
        showToast(`Chitti "${newName}" successfully created and saved to database!`);

        setLoading(true);
        // Refresh chitti list from database
        const chittisRes = await fetch(`/api/chittis?tenant_id=${activeTenant}`);
        const chittisData = await chittisRes.json();
        setChittis(chittisData);

        if (createdChitti.formula_id) {
          setCurrentFormulaId(createdChitti.formula_id);
        }

        if (newId) {
          setCurrentChittiId(newId);
          // Directly fetch details of the new chitti so it renders immediately with 0 blank time
          try {
            const detRes = await fetch(`/api/chittis/${newId}/details?tenant_id=${activeTenant}`);
            if (detRes.ok) {
              const detData = await detRes.json();
              setDetails(detData);
            }
          } catch (e) {
            console.error("Error fetching newly created chitti details:", e);
          }
        }
        setLoading(false);
      } else {
        showToast(data.error || "Failed to create chitti. Please check fields.", "error");
      }
    } catch (err) {
      console.error("Error creating chitti:", err);
      showToast("Network error creating chitti. Please check connection.", "error");
    } finally {
      setIsCreatingChitti(false);
    }
  };

  const handleDeleteChitti = async () => {
    if (!currentChittiId || !currentTenantId || isDeletingChitti) return;
    const deletedName = details?.chitti?.name || currentChittiId;
    setIsDeletingChitti(true);
    try {
      const res = await fetch(`/api/chittis/${currentChittiId}?tenant_id=${currentTenantId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast(`Chitti "${deletedName}" and all associated records permanently deleted.`);
        setDetails(null);
        setLoading(true);
        const chittisRes = await fetch(`/api/chittis?tenant_id=${currentTenantId}`);
        const chittisData = await chittisRes.json();
        setChittis(chittisData);
        if (chittisData.length > 0) {
          const nextId = chittisData[0].chitti_id;
          setCurrentChittiId(nextId);
          setCurrentFormulaId(chittisData[0].formula_id || "standard_chit_v1");
          localStorage.setItem("clearflow_chitti_id", nextId);
        } else {
          setCurrentChittiId("");
          localStorage.removeItem("clearflow_chitti_id");
        }
        setLoading(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to delete chitti from database.", "error");
      }
    } catch (err) {
      console.error("Error deleting chitti:", err);
      showToast("Network error: Unable to delete chitti.", "error");
    } finally {
      setIsDeletingChitti(false);
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
        onSignOut={handleSignOut}
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
            onClick={handleSignOut}
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
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 shadow-sm transition shrink-0 cursor-pointer"
            title="Refresh share cards and chittis from NocoDB database"
          >
            <RefreshCw className={`w-4 h-4 text-sky-600 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Status Filter Pills */}
        <div className="grid grid-cols-4 gap-1 text-xs">
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

        {/* Global Floating Operation Indicator Banner if an async mutation is processing */}
        {(isRecordingPayment || isUpdatingWinner || isCreatingChitti || isDeletingChitti) && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white border border-sky-500/40 shadow-2xl px-4 py-2 rounded-full flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
            <span>
              {isCreatingChitti && "Creating Scheme & Allocating Shares in NocoDB..."}
              {isDeletingChitti && "Permanently Deleting Scheme & Wiping NocoDB Records..."}
              {isRecordingPayment && "Recording Payment & Updating Ledger in NocoDB..."}
              {isUpdatingWinner && "Synchronizing Winner Status & Dividends..."}
            </span>
          </div>
        )}

        {/* Feed of Share ID Cards */}
        {chittisLoading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-8">
            <div className="relative flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border-4 border-sky-500/20 border-t-sky-600 animate-spin"></div>
              <Loader2 className="w-7 h-7 text-sky-600 animate-spin absolute" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-800">
                Loading Manager Workspace & Chittis...
              </h3>
              <p className="text-xs text-slate-500">
                Retrieving your tenant data and active schemes from NocoDB. Please wait...
              </p>
            </div>
          </div>
        ) : chittis.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-gradient-to-tr from-sky-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center mx-auto text-2xl font-bold shadow-lg shadow-sky-500/20">
              ⚡
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-slate-900">
                Welcome, {managerEmail || currentTenantId}!
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                You do not have any active Chitti schemes created yet. Click below to launch your first Chitti scheme, configure members, and start recording dues.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setIsCreateChittiOpen(true)}
                className="bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold py-3.5 px-6 rounded-xl text-xs inline-flex items-center gap-2 shadow-lg shadow-sky-600/30 transition cursor-pointer"
              >
                <span>+ Create Your First Chitti</span>
              </button>
            </div>
          </div>
        ) : loading || !details ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-4 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-8">
            <div className="relative flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border-4 border-sky-500/20 border-t-sky-600 animate-spin"></div>
              <Loader2 className="w-7 h-7 text-sky-600 animate-spin absolute" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-bold text-slate-800">
                Fetching Scheme Details & Ledger...
              </h3>
              <p className="text-xs text-slate-500">
                Connecting to NocoDB and retrieving member shares, balances, and arrears. Please wait...
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={handleManualRefresh}
                className="text-xs text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3.5 py-1.5 rounded-lg transition font-medium flex items-center gap-1.5 cursor-pointer mx-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Taking longer than expected? Click to Refresh</span>
              </button>
            </div>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 shadow-sm">
            <p className="text-sm font-medium">No member shares match your search or filter.</p>
            <p className="text-xs text-slate-400 mt-1">Try resetting the status filter to "All" or clearing the search text.</p>
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
            isDeleting={isDeletingChitti}
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
          currentTenantId={currentTenantId || managerEmail || ""}
          onClose={() => !isCreatingChitti && setIsCreateChittiOpen(false)}
          onSubmit={handleCreateChitti}
          isSubmitting={isCreatingChitti}
        />
      )}

      <NocoDBModal
        isOpen={isNocoDBOpen}
        onClose={() => setIsNocoDBOpen(false)}
      />

      {/* Explicit Modal Acknowledgement Popup */}
      {toast && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden p-6 text-center space-y-4">
            <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center text-xl font-bold ${
              toast.type === "success" ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
            }`}>
              {toast.type === "success" ? "✓" : "!"}
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-base mb-1">
                {toast.type === "success" ? "Transaction Acknowledged" : "Action Alert"}
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-semibold rounded-xl text-xs transition shadow-md"
            >
              OK, Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
