/**
 * FinFlow Pro v3.4
 * * UPDATES:
 * - FIX: Added Error Handling for Login (Enter App)
 * - CONFIG: Hybrid support for Environment Variables (Hosting) vs Global Config (Preview)
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken,
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  writeBatch 
} from 'firebase/firestore';
import { 
  Home, Layers, CreditCard, Calendar, TrendingUp, Plus, LogOut, 
  ChevronRight, AlertCircle, ArrowUpRight, ArrowDownRight, Settings, 
  Download, Upload, Trash2, Edit2, X, Wallet, Droplets, History, 
  MinusCircle, CheckCircle2, PieChart as PieIcon, ArrowUp, ArrowDown,
  ListFilter, Banknote, AlertTriangle
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

// --- Configuration Strategy ---
// 1. Try to use Environment Variables (Best for Vercel/Local)
// 2. Fallback to __firebase_config (For Canvas Preview)
let firebaseConfig;

try {
  // Check if we are in a Vite environment with Env Vars
  // Note: We use a safe check to prevent crashes in environments where import.meta is undefined
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) {
    firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    };
  } 
  // Fallback for Canvas/Preview Environment
  else if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
  } else {
    throw new Error("No Firebase Configuration Found");
  }
} catch (e) {
  console.warn("Config parsing error (this is expected during build if env vars aren't set yet):", e);
  // Default to empty to prevent immediate crash, app will show config error UI
  firebaseConfig = { apiKey: "", projectId: "" };
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Only init analytics if supported (prevents errors in some envs)
let analytics;
try { analytics = getAnalytics(app); } catch(e) {}

const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'finflow-v3.4';

// --- Constants ---
const TABS = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'buckets', icon: Layers, label: 'Buckets' },
  { id: 'expenses', icon: CreditCard, label: 'Plan' },
  { id: 'timeline', icon: Calendar, label: 'Timeline' },
  { id: 'settings', icon: Settings, label: 'Settings' }
];

const CURRENCY = "₹";
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

// --- Helpers ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const getMonthId = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatCurrency = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const formatDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// --- GROSS ALLOCATION ENGINE ---
const calculateFinancialState = (months, buckets) => {
  let grossPool = 0; // Historical Income - Expenses
  let totalWithdrawals = 0;
  let accumulatedInvestments = { sip: 0, liquid: 0, byName: {} };
  let stats = { income: 0, fixed: 0, variable: 0, sip: 0, liquid: 0, count: 0 };
  
  const currentMonthId = getMonthId(new Date());
  const sortedMonths = [...months].sort((a, b) => a.id.localeCompare(b.id));

  // 1. Process Monthly Data
  sortedMonths.forEach(m => {
    const income = parseFloat(m.income || 0);
    const fixed = parseFloat(m.fixedExpenses || 0);
    const variable = parseFloat(m.variableExpenses || 0);
    
    // SIP Handling (Legacy + Named)
    const legacySip = parseFloat(m.sip || 0);
    const sipEntries = Array.isArray(m.sipEntries) ? m.sipEntries : [];
    const namedSipTotal = sipEntries.reduce((sum, s) => sum + (parseFloat(s.amount)||0), 0);
    const totalSipForMonth = legacySip + namedSipTotal;
    
    // Aggregate Investments by Name (Global)
    if (legacySip > 0) {
        accumulatedInvestments.byName['General SIP'] = (accumulatedInvestments.byName['General SIP'] || 0) + legacySip;
    }
    sipEntries.forEach(s => {
        const name = s.name || 'Unnamed SIP';
        accumulatedInvestments.byName[name] = (accumulatedInvestments.byName[name] || 0) + (parseFloat(s.amount)||0);
    });

    const liquid = parseFloat(m.liquidFunds || 0);
    
    // Outflow Calculation
    const outflow = fixed + variable + totalSipForMonth + liquid;
    const surplus = income - outflow;

    if (m.id <= currentMonthId) {
        grossPool += surplus;
        accumulatedInvestments.sip += totalSipForMonth;
        accumulatedInvestments.liquid += liquid;
    }

    if (income > 0) { 
        stats.income += income; stats.fixed += fixed; stats.variable += variable;
        stats.sip += totalSipForMonth; stats.liquid += liquid; stats.count++;
    }
  });

  const monthlyAvgs = {
      surplus: stats.count ? (stats.income - (stats.fixed + stats.variable + stats.sip + stats.liquid)) / stats.count : 0,
      spending: stats.count ? (stats.fixed + stats.variable) / stats.count : 0,
      investing: stats.count ? (stats.sip + stats.liquid) / stats.count : 0
  };

  // 2. Waterfall Allocation
  const sortedBuckets = [...buckets].sort((a, b) => a.priority - b.priority);
  let remainingGross = grossPool;
  
  const processedBuckets = sortedBuckets.map(b => {
    const target = parseFloat(b.target || 0);
    const withdrawals = b.transactions ? b.transactions.reduce((sum, t) => sum + (parseFloat(t.amount)||0), 0) : 0;
    
    totalWithdrawals += withdrawals;

    let grossAllocated = 0;

    if (b.status === 'completed') {
        if (remainingGross >= target) {
            grossAllocated = target;
            remainingGross -= target;
        } else {
            grossAllocated = remainingGross;
            remainingGross = 0;
        }
    } else {
        if (remainingGross >= target) {
            grossAllocated = target;
            remainingGross -= target;
        } else if (remainingGross > 0) {
            grossAllocated = remainingGross;
            remainingGross = 0;
        } else {
            grossAllocated = 0;
        }
    }

    const currentBalance = grossAllocated - withdrawals;

    return { 
        ...b, 
        grossAllocated, 
        currentBalance, 
        totalSpent: withdrawals
    };
  });

  const realBalance = grossPool - totalWithdrawals;
  const netWorth = realBalance + accumulatedInvestments.sip + accumulatedInvestments.liquid;

  return {
    realBalance, // Liquid Cash
    netWorth,
    accumulatedInvestments,
    unallocatedCash: remainingGross, // Internal metric
    processedBuckets,
    monthlyAvgs
  };
};

// --- UI Components ---
const Card = ({ children, className = "", onClick }) => (
  <div onClick={onClick} className={`bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-sm transition-all ${className}`}>
    {children}
  </div>
);

const ProgressBar = ({ progress, color = "bg-blue-600" }) => (
  <div className="w-full bg-slate-950 rounded-full h-2 mt-3 overflow-hidden border border-slate-800/50">
    <div 
      className={`h-full rounded-full transition-all duration-700 ease-out ${color}`} 
      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
    />
  </div>
);

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden border border-slate-800 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
          <h3 className="font-bold text-lg text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-800 transition-colors text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [months, setMonths] = useState([]);
  const [buckets, setBuckets] = useState([]);

  // Auth Listener
  useEffect(() => {
    // Try to auto-login if token is provided (Canvas Environment)
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        try {
          await signInWithCustomToken(auth, __initial_auth_token);
        } catch (e) {
          console.error("Token Auth Failed", e);
        }
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Manual Login Handler
  const handleLogin = async () => {
    setAuthError(null);
    setLoading(true);
    try {
      await signInAnonymously(auth);
    } catch (err) {
      console.error("Login Failed:", err);
      // Friendly error mapping
      let msg = err.message;
      if (err.code === 'auth/operation-not-allowed') {
        msg = "Anonymous Auth is disabled in Firebase Console.";
      } else if (err.code === 'auth/api-key-not-valid') {
        msg = "Invalid Firebase API Key.";
      }
      setAuthError(msg);
      setLoading(false);
    }
  };

  // Data Sync
  useEffect(() => {
    if (!user) return;
    const unsubM = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'months'), s => setMonths(s.docs.map(d => ({id:d.id, ...d.data()}))));
    const unsubB = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'buckets'), s => { setBuckets(s.docs.map(d => ({id:d.id, ...d.data()}))); setLoading(false); });
    return () => { unsubM(); unsubB(); };
  }, [user]);

  const stats = useMemo(() => calculateFinancialState(months, buckets), [months, buckets]);

  const updateDB = (coll, id, data) => user && setDoc(doc(db, 'artifacts', appId, 'users', user.uid, coll, id), { ...data, updatedAt: Date.now() }, { merge: true });
  const deleteDB = (coll, id) => user && deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, coll, id));
  
  const updatePriorities = async (newOrder) => {
      if (!user) return;
      const batch = writeBatch(db);
      newOrder.forEach((b, index) => {
          const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'buckets', b.id);
          batch.update(ref, { priority: index + 1 });
      });
      await batch.commit();
  };

  const handleImport = async (json) => {
    try {
      const { months: m, buckets: b } = JSON.parse(json);
      const batch = writeBatch(db);
      m.forEach(x => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'months', x.id), x));
      b.forEach(x => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'buckets', x.id), x));
      await batch.commit();
      alert('Restored!');
    } catch(e) { alert('Error'); }
  };

  if (loading) return (
    <div className="h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 rounded-full animate-spin border-t-transparent"></div>
    </div>
  );
  
  if (!user) return (
    <div className="h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
      <div className="bg-blue-600 p-4 rounded-2xl mb-6 shadow-xl shadow-blue-500/20 rotate-3">
        <Wallet className="w-10 h-10 text-white" />
      </div>
      <h1 className="text-3xl font-bold mb-2">FinFlow</h1>
      <p className="text-slate-400 mb-8 max-w-xs text-center text-sm">Your secure, offline-first financial dashboard.</p>
      
      {authError && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-xl flex gap-3 text-red-200 text-xs max-w-xs text-left">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-bold">Access Denied</p>
            <p className="opacity-80">{authError}</p>
          </div>
        </div>
      )}

      <button onClick={handleLogin} className="bg-white text-slate-900 px-8 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors">
        Enter App
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 font-sans selection:bg-blue-900">
      <header className="px-6 py-4 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-30 flex justify-between items-center">
        <h1 className="text-xl font-black tracking-tight text-blue-500">FinFlow<span className="text-slate-100">.</span></h1>
        <div className={`text-xs font-bold px-2 py-1 rounded ${stats.realBalance >= 0 ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
          {stats.realBalance >= 0 ? 'Positive Balance' : 'Negative Balance'}
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        {activeTab === 'home' && <HomeView stats={stats} setActiveTab={setActiveTab} />}
        {activeTab === 'expenses' && <ExpensesView months={months} onUpdate={(id, d) => updateDB('months', id, d)} />}
        {activeTab === 'buckets' && <BucketsView buckets={buckets} processedBuckets={stats.processedBuckets} onUpdate={(id, d) => updateDB('buckets', id, d)} onDelete={(id) => deleteDB('buckets', id)} onReorder={updatePriorities} />}
        {activeTab === 'timeline' && <TimelineView stats={stats} />}
        {activeTab === 'settings' && <SettingsView months={months} buckets={buckets} onImport={handleImport} onSignOut={() => signOut(auth)} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-lg border-t border-slate-800 px-6 py-2 flex justify-between items-center z-40 pb-safe">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1 p-2 transition-all duration-300 ${activeTab === tab.id ? 'text-blue-500 -translate-y-1' : 'text-slate-500 hover:text-slate-300'}`}>
            <tab.icon size={22} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
            <span className="text-[10px] font-bold uppercase tracking-tight">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// --- Views ---

const HomeView = ({ stats, setActiveTab }) => {
  const { monthlyAvgs, processedBuckets, realBalance, netWorth, accumulatedInvestments, unallocatedCash } = stats;
  const [showBreakdown, setShowBreakdown] = useState(false);

  const pieData = [
    { name: 'Fixed Exp', value: monthlyAvgs.spending, color: '#ef4444' },
    { name: 'Investments', value: monthlyAvgs.investing, color: '#10b981' },
    { name: 'Buckets', value: (monthlyAvgs.surplus), color: '#3b82f6' },
  ].filter(d => d.value > 0);

  // Group buckets for breakdown
  const bucketsWithCash = processedBuckets.filter(b => b.currentBalance > 0);
  const totalInBuckets = bucketsWithCash.reduce((sum, b) => sum + b.currentBalance, 0);
  const unallocatedReal = realBalance - totalInBuckets;

  return (
    <div className="space-y-6">
      <Card onClick={() => setShowBreakdown(true)} className="bg-gradient-to-br from-blue-900 to-slate-900 border-blue-800/50 cursor-pointer active:scale-95">
        <div className="flex justify-between items-start mb-4">
          <span className="text-xs opacity-70 uppercase tracking-widest font-bold">Net Worth</span>
          <Banknote className="w-4 h-4 text-blue-400" />
        </div>
        <div className="text-4xl font-black mb-1 tracking-tight text-white">{formatCurrency(netWorth)}</div>
        <div className="text-xs text-blue-200/60 font-medium flex items-center gap-1">
            Click to see breakdown <ChevronRight size={12} />
        </div>
      </Card>

      <Modal isOpen={showBreakdown} onClose={() => setShowBreakdown(false)} title="Net Worth Breakdown">
          <div className="space-y-6">
              {/* Liquid Cash Section */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center mb-3">
                      <h4 className="text-sm font-bold text-blue-400 flex items-center gap-2"><Wallet size={14}/> Liquid Cash</h4>
                      <span className="font-mono font-bold text-slate-200">{formatCurrency(realBalance)}</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-slate-800 ml-1">
                       <div className="flex justify-between text-xs text-slate-400">
                          <span>Unallocated</span>
                          <span>{formatCurrency(unallocatedReal)}</span>
                       </div>
                       {bucketsWithCash.map(b => (
                           <div key={b.id} className="flex justify-between text-xs">
                               <span className="text-slate-500">{b.name}</span>
                               <span className="text-slate-400 font-mono">{formatCurrency(b.currentBalance)}</span>
                           </div>
                       ))}
                  </div>
              </div>

              {/* Investments Section */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center mb-3">
                      <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2"><TrendingUp size={14}/> Investments</h4>
                      <span className="font-mono font-bold text-slate-200">{formatCurrency(accumulatedInvestments.sip + accumulatedInvestments.liquid)}</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-slate-800 ml-1">
                       {Object.entries(accumulatedInvestments.byName).map(([name, amount]) => (
                           <div key={name} className="flex justify-between text-xs">
                               <span className="text-slate-500">{name}</span>
                               <span className="text-emerald-500/80 font-mono">{formatCurrency(amount)}</span>
                           </div>
                       ))}
                       {accumulatedInvestments.liquid > 0 && (
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Liquid Funds</span>
                                <span className="text-cyan-500/80 font-mono">{formatCurrency(accumulatedInvestments.liquid)}</span>
                            </div>
                       )}
                       {Object.keys(accumulatedInvestments.byName).length === 0 && accumulatedInvestments.liquid === 0 && (
                           <div className="text-xs text-slate-600 italic">No investments yet</div>
                       )}
                  </div>
              </div>
          </div>
      </Modal>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
        <h3 className="text-xs font-bold uppercase text-slate-500 mb-2 w-full text-left">Monthly Breakdown</h3>
        <div className="w-full h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(0,0,0,0)" />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} formatter={(val) => formatCurrency(val)} />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

const BucketsView = ({ buckets, processedBuckets, onUpdate, onDelete, onReorder }) => {
  const [modalMode, setModalMode] = useState(null);
  const [selectedBucketId, setSelectedBucketId] = useState(null);
  const [isReordering, setIsReordering] = useState(false);
  
  const [form, setForm] = useState({ name: '', target: '', priority: '', deadline: '' });
  const [withdrawForm, setWithdrawForm] = useState({ amount: '', note: '' });

  const selectedBucket = useMemo(() => processedBuckets.find(b => b.id === selectedBucketId), [processedBuckets, selectedBucketId]);
  
  const activeList = useMemo(() => processedBuckets.filter(b => b.status !== 'completed'), [processedBuckets]);
  const completedList = useMemo(() => processedBuckets.filter(b => b.status === 'completed'), [processedBuckets]);

  // Reorder Handler (Arrows)
  const moveItem = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= activeList.length) return;
    
    const copy = [...activeList];
    const item = copy[index];
    copy.splice(index, 1);
    copy.splice(newIndex, 0, item);
    onReorder(copy);
  };

  const openEdit = (b) => {
    setModalMode('edit');
    setSelectedBucketId(b ? b.id : null);
    setForm(b ? { name: b.name, target: b.target, priority: b.priority, deadline: b.deadline || '' } : { name: '', target: '', priority: buckets.length + 1, deadline: '' });
  };

  const openTxn = (b) => {
    setModalMode('txn');
    setSelectedBucketId(b.id);
    setWithdrawForm({ amount: '', note: '' });
  };

  const toggleComplete = (b, e) => {
    e.stopPropagation();
    onUpdate(b.id, { status: b.status === 'completed' ? 'active' : 'completed' });
  };

  const submitBucket = (e) => {
    e.preventDefault();
    const id = selectedBucketId || generateId();
    const priority = selectedBucket ? selectedBucket.priority : activeList.length + 1;
    onUpdate(id, { ...form, target: parseFloat(form.target), priority, status: selectedBucket ? selectedBucket.status : 'active' });
    setModalMode(null);
  };

  const submitWithdraw = (e) => {
    e.preventDefault();
    if (!withdrawForm.amount) return;
    const newTxn = { id: generateId(), amount: parseFloat(withdrawForm.amount), note: withdrawForm.note || 'Withdrawal', date: new Date().toISOString() };
    const txns = selectedBucket?.transactions || [];
    onUpdate(selectedBucketId, { transactions: [newTxn, ...txns] });
    setWithdrawForm({ amount: '', note: '' });
  };

  const renderBucketCard = (b, isCompleted, index) => {
    const fillPercent = (b.currentBalance / b.target) * 100;
    return (
        <Card key={b.id} className={`relative group overflow-hidden border ${isCompleted ? 'border-emerald-900/50 bg-slate-900/50 opacity-60' : 'border-slate-800'}`}>
          <div className="flex justify-between items-start mb-2 relative z-10">
            <div className="flex items-center gap-3">
              {isReordering && !isCompleted ? (
                  <div className="flex flex-col gap-1">
                      <button onClick={(e) => {e.stopPropagation(); moveItem(index, -1)}} disabled={index === 0} className="p-1 bg-slate-800 rounded disabled:opacity-30"><ArrowUp size={12}/></button>
                      <button onClick={(e) => {e.stopPropagation(); moveItem(index, 1)}} disabled={index === activeList.length - 1} className="p-1 bg-slate-800 rounded disabled:opacity-30"><ArrowDown size={12}/></button>
                  </div>
              ) : (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded ${isCompleted ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>P{b.priority}</span>
              )}
              
              <div>
                <h3 className={`font-bold text-lg leading-tight ${isCompleted ? 'text-emerald-400 line-through' : 'text-slate-100'}`}>{b.name}</h3>
                <div className="text-xs text-slate-500 mt-0.5">{b.deadline ? `Due: ${b.deadline}` : 'No deadline'}</div>
              </div>
            </div>
            {!isReordering && (
                <div className="flex gap-1">
                <button onClick={(e) => toggleComplete(b, e)} className={`p-2 rounded-lg transition-colors ${isCompleted ? 'text-emerald-400 bg-emerald-900/20' : 'text-slate-600 hover:text-emerald-400 hover:bg-slate-800'}`}>
                    {isCompleted ? <CheckCircle2 size={16} /> : <div className="w-4 h-4 rounded-full border-2 border-slate-600" />}
                </button>
                <button onClick={() => openTxn(b)} className="p-2 text-slate-600 hover:text-blue-400 hover:bg-slate-800 rounded-lg"><Wallet size={16} /></button>
                <button onClick={() => openEdit(b)} className="p-2 text-slate-600 hover:text-slate-300 hover:bg-slate-800 rounded-lg"><Edit2 size={16} /></button>
                </div>
            )}
          </div>
          <div className="flex justify-between text-sm mb-1 relative z-10">
            <span className={`font-bold ${isCompleted ? 'text-emerald-500' : 'text-slate-200'}`}>{formatCurrency(b.currentBalance)}</span>
            <span className="text-slate-500">{formatCurrency(b.target)}</span>
          </div>
          <ProgressBar progress={fillPercent} color={isCompleted ? 'bg-emerald-600' : 'bg-blue-600'} />
          <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-800/50">
              {b.totalSpent > 0 && <span className="text-[10px] text-slate-500 flex items-center gap-1"><History size={10} /> Spent: {formatCurrency(b.totalSpent)}</span>}
              {b.currentBalance < 0 && <span className="text-[10px] text-red-400 flex items-center gap-1"><AlertCircle size={10} /> Overdrawn</span>}
          </div>
        </Card>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-100">Active Goals</h2>
            <div className="flex gap-2">
                <button onClick={() => setIsReordering(!isReordering)} className={`p-2 rounded-full ${isReordering ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    <ListFilter size={20} />
                </button>
                <button onClick={() => openEdit(null)} className="bg-blue-600 text-white p-2 rounded-full shadow-lg shadow-blue-500/20 active:scale-95"><Plus size={20} /></button>
            </div>
        </div>
        <div className="space-y-4">
            {activeList.length === 0 && <div className="text-center py-8 text-slate-500 border border-dashed border-slate-800 rounded-xl">No active goals. Add one!</div>}
            {activeList.map((b, i) => renderBucketCard(b, false, i))}
        </div>
      </div>

      {completedList.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-500 uppercase mb-4">Completed</h2>
            <div className="space-y-4 opacity-75">
                {completedList.map((b, i) => renderBucketCard(b, true, i))}
            </div>
          </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={modalMode === 'edit'} onClose={() => setModalMode(null)} title={selectedBucket ? "Edit Bucket" : "New Bucket"}>
        <form onSubmit={submitBucket} className="space-y-4">
          <input required className="w-full bg-slate-950 p-3 rounded-lg border border-slate-800 focus:border-blue-500 outline-none" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Name" />
          <input required type="number" className="w-full bg-slate-950 p-3 rounded-lg border border-slate-800 focus:border-blue-500 outline-none" value={form.target} onChange={e => setForm({...form, target: e.target.value})} placeholder="Target Amount" />
          <div className="grid grid-cols-2 gap-3">
             <input type="month" className="w-full bg-slate-950 p-3 rounded-lg border border-slate-800 focus:border-blue-500 outline-none" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} />
             <div className="flex items-center justify-center text-slate-500 text-xs">Priority Auto-assigned</div>
          </div>
          {selectedBucket && <button type="button" onClick={() => { onDelete(selectedBucketId); setModalMode(null); }} className="w-full text-red-500 text-sm py-2">Delete Bucket</button>}
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl mt-2">Save</button>
        </form>
      </Modal>

      {/* Transactions Modal */}
      <Modal isOpen={modalMode === 'txn'} onClose={() => setModalMode(null)} title="Spend from Bucket">
         <div className="space-y-6">
             <div className="bg-slate-950 p-4 rounded-xl text-center border border-slate-800">
                 <p className="text-xs text-slate-500 uppercase font-bold">Balance</p>
                 <p className="text-2xl font-black text-blue-500">{formatCurrency(selectedBucket?.currentBalance || 0)}</p>
             </div>
             <form onSubmit={submitWithdraw} className="space-y-3">
                 <div className="flex gap-2">
                     <input required type="number" placeholder="Amt" className="w-24 bg-slate-950 p-3 rounded-lg border border-slate-800 outline-none" value={withdrawForm.amount} onChange={e => setWithdrawForm({...withdrawForm, amount: e.target.value})} />
                     <input placeholder="Note" className="flex-1 bg-slate-950 p-3 rounded-lg border border-slate-800 outline-none" value={withdrawForm.note} onChange={e => setWithdrawForm({...withdrawForm, note: e.target.value})} />
                     <button type="submit" className="bg-red-900/50 text-red-400 p-3 rounded-lg border border-red-900"><MinusCircle size={20} /></button>
                 </div>
             </form>
             <div className="border-t border-slate-800 pt-4">
                 <p className="text-xs font-bold text-slate-500 uppercase mb-3">History</p>
                 <div className="space-y-2 max-h-40 overflow-y-auto">
                     {selectedBucket?.transactions?.map((t) => (
                         <div key={t.id} className="flex justify-between items-center text-sm p-2 bg-slate-950/50 rounded-lg">
                             <div><div className="font-medium text-slate-300">{t.note}</div><div className="text-[10px] text-slate-500">{formatDate(t.date)}</div></div>
                             <div className="font-mono text-red-400">-{formatCurrency(t.amount)}</div>
                         </div>
                     ))}
                 </div>
             </div>
         </div>
      </Modal>
    </div>
  );
};

const ExpensesView = ({ months, onUpdate }) => {
  const [selectedMonth, setSelectedMonth] = useState(getMonthId());
  const monthData = useMemo(() => {
    const found = months.find(m => m.id === selectedMonth);
    if (found) return found;
    const sorted = [...months].sort((a, b) => b.id.localeCompare(a.id));
    const last = sorted.find(m => m.id < selectedMonth);
    return { 
        id: selectedMonth, 
        income: last?.income || 0, 
        fixedExpenses: last?.fixedExpenses || 0, 
        sip: 0, 
        sipEntries: last?.sipEntries || [], 
        liquidFunds: last?.liquidFunds || 0, 
        variableExpenses: 0, 
        transactions: [] 
    };
  }, [months, selectedMonth]);

  const update = (f, v) => onUpdate(selectedMonth, { ...monthData, [f]: parseFloat(v) || 0 });
  const navigate = (d) => { const [y, m] = selectedMonth.split('-').map(Number); setSelectedMonth(getMonthId(new Date(y, m - 1 + d, 1))); };
  
  // Variable Spend Form
  const [txForm, setTxForm] = useState({desc:'', amt:''});
  const addTx = (e) => {
      e.preventDefault(); if(!txForm.amt) return;
      const amt = parseFloat(txForm.amt);
      const newTx = [...(monthData.transactions||[]), {id:generateId(), desc:txForm.desc, amount:amt}];
      onUpdate(selectedMonth, { ...monthData, variableExpenses: (monthData.variableExpenses||0)+amt, transactions: newTx });
      setTxForm({desc:'', amt:''});
  };
  const delTx = (id, amt) => {
      onUpdate(selectedMonth, { ...monthData, variableExpenses: (monthData.variableExpenses||0)-amt, transactions: monthData.transactions.filter(t=>t.id!==id) });
  };

  // SIP Form
  const [sipForm, setSipForm] = useState({name:'', amt:''});
  const addSip = (e) => {
      e.preventDefault(); if(!sipForm.amt) return;
      const amt = parseFloat(sipForm.amt);
      const entries = [...(monthData.sipEntries||[]), {id:generateId(), name:sipForm.name || 'SIP', amount:amt}];
      onUpdate(selectedMonth, { ...monthData, sipEntries: entries });
      setSipForm({name:'', amt:''});
  };
  const delSip = (id) => {
      onUpdate(selectedMonth, { ...monthData, sipEntries: monthData.sipEntries.filter(s=>s.id!==id) });
  };
  
  const sipTotal = (monthData.sip||0) + (monthData.sipEntries?.reduce((s,i)=>s+(i.amount||0),0)||0);
  const net = (monthData.income||0) - ((monthData.fixedExpenses||0)+(monthData.variableExpenses||0)+sipTotal+(monthData.liquidFunds||0));

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between bg-slate-900 p-2 rounded-xl border border-slate-800">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-800 rounded-lg"><ChevronRight className="rotate-180 w-5 h-5 text-slate-400" /></button>
        <div className="text-center">
          <div className="font-bold text-lg text-slate-200">{selectedMonth}</div>
          <div className={`text-xs font-bold ${net >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{net >= 0 ? '+' : ''}{formatCurrency(net)}</div>
        </div>
        <button onClick={() => navigate(1)} className="p-2 hover:bg-slate-800 rounded-lg"><ChevronRight className="w-5 h-5 text-slate-400" /></button>
      </div>

      <Card>
        <div className="space-y-4">
          <Input label="Income" val={monthData.income} fn={v=>update('income',v)} color="text-blue-500" icon={ArrowDownRight} />
          <Input label="Fixed Expenses" val={monthData.fixedExpenses} fn={v=>update('fixedExpenses',v)} color="text-red-500" icon={ArrowUpRight} />
          <Input label="Liquid Funds" val={monthData.liquidFunds} fn={v=>update('liquidFunds',v)} color="text-cyan-500" icon={Droplets} />
        </div>
      </Card>
      
      {/* SIP Section */}
      <div>
         <div className="flex justify-between items-center mb-2 px-1">
             <span className="text-xs font-bold uppercase text-emerald-500 flex items-center gap-1"><TrendingUp size={12}/> Investments (SIP)</span>
             <span className="text-emerald-500 font-mono font-bold">{formatCurrency(sipTotal)}</span>
        </div>
        <form onSubmit={addSip} className="flex gap-2 mb-4">
            <input placeholder="SIP Name (e.g. Axis Bluechip)" className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-sm outline-none" value={sipForm.name} onChange={e=>setSipForm({...sipForm, name:e.target.value})} />
            <input type="number" placeholder="Amt" className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-3 text-sm outline-none" value={sipForm.amt} onChange={e=>setSipForm({...sipForm, amt:e.target.value})} />
            <button className="bg-emerald-900/30 text-emerald-500 p-3 rounded-lg"><Plus size={20} /></button>
        </form>
        <div className="space-y-2 mb-6">
            {monthData.sip > 0 && (
                <div className="flex justify-between p-3 bg-slate-900/50 border border-slate-800 rounded-xl text-sm">
                    <span className="text-slate-400">Legacy/General SIP</span>
                    <span className="font-mono text-emerald-500">{formatCurrency(monthData.sip)}</span>
                </div>
            )}
            {monthData.sipEntries?.map(s => (
                <div key={s.id} className="flex justify-between p-3 bg-slate-900 border border-slate-800 rounded-xl text-sm">
                    <span className="text-slate-300">{s.name}</span>
                    <div className="flex gap-3"><span className="font-mono text-emerald-500">{formatCurrency(s.amount)}</span><button onClick={()=>delSip(s.id)} className="text-slate-600 hover:text-red-500"><X size={14}/></button></div>
                </div>
            ))}
        </div>
      </div>

      {/* Variable Section */}
      <div>
        <div className="flex justify-between items-center mb-2 px-1">
             <span className="text-xs font-bold uppercase text-slate-500">Variable Spends</span>
             <span className="text-orange-500 font-mono font-bold">{formatCurrency(monthData.variableExpenses)}</span>
        </div>
        <form onSubmit={addTx} className="flex gap-2 mb-4">
            <input placeholder="Coffee..." className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-sm outline-none" value={txForm.desc} onChange={e=>setTxForm({...txForm, desc:e.target.value})} />
            <input type="number" placeholder="500" className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-3 text-sm outline-none" value={txForm.amt} onChange={e=>setTxForm({...txForm, amt:e.target.value})} />
            <button className="bg-orange-600/20 text-orange-500 p-3 rounded-lg"><Plus size={20} /></button>
        </form>
        <div className="space-y-2">
            {monthData.transactions?.map(t => (
                <div key={t.id} className="flex justify-between p-3 bg-slate-900 border border-slate-800 rounded-xl text-sm">
                    <span className="text-slate-300">{t.desc}</span>
                    <div className="flex gap-3"><span className="font-mono text-orange-400">{t.amount}</span><button onClick={()=>delTx(t.id, t.amount)} className="text-slate-600 hover:text-red-500"><X size={14}/></button></div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

const Input = ({ label, val, fn, color, icon: Icon }) => (
    <div>
        <label className={`text-[10px] uppercase font-bold mb-1 flex items-center gap-1 ${color}`}><Icon size={10} /> {label}</label>
        <input type="number" value={val} onChange={e=>fn(e.target.value)} className="w-full bg-slate-950 border-b border-slate-800 focus:border-blue-500 text-lg font-bold py-1 outline-none" />
    </div>
);

const TimelineView = ({ stats }) => {
    const { monthlyAvgs, processedBuckets } = stats;
    let accMonths = 0;
    return (
        <div className="space-y-6">
            <Card>
                <div className="flex gap-3">
                    <Calendar className="text-blue-500 shrink-0" />
                    <p className="text-sm text-slate-400">At <strong className="text-emerald-500">{formatCurrency(monthlyAvgs.surplus)}</strong>/mo surplus, here is your roadmap.</p>
                </div>
            </Card>
            <div className="border-l-2 border-slate-800 ml-4 pl-6 space-y-8">
                {processedBuckets.filter(b=>b.status!=='completed').map(b => {
                    const need = b.target - b.currentBalance;
                    const months = Math.max(0, need / monthlyAvgs.surplus);
                    accMonths += months;
                    const date = new Date(); date.setMonth(date.getMonth() + Math.ceil(accMonths));
                    return (
                        <div key={b.id} className="relative">
                             <div className="absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-slate-900 border-4 border-blue-600"></div>
                             <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                 <div className="flex justify-between">
                                     <h4 className="font-bold">{b.name}</h4>
                                     <span className="text-xs bg-slate-800 px-2 py-1 rounded text-blue-400">{date.toLocaleString('default',{month:'short', year:'numeric'})}</span>
                                 </div>
                                 <div className="text-xs text-slate-500 mt-1">Needs {formatCurrency(need)}</div>
                             </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const SettingsView = ({ months, buckets, onImport, onSignOut }) => {
    const ref = useRef(null);
    const exp = () => {
        const json = JSON.stringify({ months, buckets }, null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `finflow-${Date.now()}.json`; a.click();
    };
    return (
        <div className="space-y-6">
            <Card>
                <button onClick={exp} className="w-full flex items-center justify-center gap-3 p-4 bg-slate-950 rounded-xl hover:bg-slate-800 font-bold mb-4"><Download size={20}/> Backup Data</button>
                <input type="file" ref={ref} onChange={e=>{if(e.target.files[0]){const r=new FileReader(); r.onload=x=>onImport(x.target.result); r.readAsText(e.target.files[0]);}}} className="hidden" />
                <button onClick={()=>ref.current.click()} className="w-full flex items-center justify-center gap-3 p-4 bg-slate-950 rounded-xl hover:bg-slate-800 font-bold"><Upload size={20}/> Restore Data</button>
            </Card>
            <button onClick={onSignOut} className="w-full text-red-500 font-bold py-4">Sign Out</button>
        </div>
    );
};


