import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured } from './supabase';
import { Activity, Banknote, Clock3, LogOut, Plus, RefreshCw, ShieldCheck, Table2, Wallet } from 'lucide-react';

type Profile = { id: string; full_name: string; role: 'owner' | 'staff'; active: boolean };
type TableRow = { id: string; table_number: number; label: string; active: boolean; hourly_rate_paise: number };
type PlaySession = { id: string; table_id: string; started_at: string; ended_at: string | null; status: string; started_by: string; ended_by: string | null; amount_paise: number | null; billable_minutes: number | null; hourly_rate_paise: number };
type Payment = { id: string; session_id: string; amount_paise: number; method: 'cash' | 'upi'; invoice_no: string; paid_at: string; received_by: string };
type Audit = { id: string; action: string; details: any; created_at: string; actor_id: string };
type Expense = { id: string; amount_paise: number; description: string; created_at: string };

const money = (paise: number) => '₹' + (paise / 100).toFixed(2);
const elapsed = (start: string) => Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000));
const charge = (minutes: number, ratePaise: number) => Math.ceil(minutes * ratePaise / 60);
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [openingCash, setOpeningCash] = useState('0');
  const [countedCash, setCountedCash] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'tables' | 'reports' | 'audit'>('tables');
  const [now, setNow] = useState(Date.now());
  const [newExpense, setNewExpense] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!supabase || !session) return;
    const [p, t, s, pay, a, ex] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('snooker_tables').select('*').eq('active', true).order('table_number'),
      supabase.from('play_sessions').select('*').order('started_at', { ascending: false }).limit(300),
      supabase.from('payments').select('*').order('paid_at', { ascending: false }).limit(300),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(150),
      supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(200)
    ]);
    if (p.error) throw p.error;
    if (t.error) throw t.error;
    if (s.error) throw s.error;
    if (pay.error) throw pay.error;
    if (a.error) throw a.error;
    if (ex.error) throw ex.error;
    setProfile(p.data as Profile); setTables(t.data as TableRow[]);
    setSessions(s.data as PlaySession[]); setPayments(pay.data as Payment[]);
    setAudits(a.data as Audit[]); setExpenses(ex.data as Expense[]);
  }, [session]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    refresh().catch(e => setError(e.message));
    const channel = supabase!.channel('club-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => refresh().catch(e => setError(e.message)))
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [session, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeByTable = useMemo(() => {
    const map = new Map<string, PlaySession>();
    sessions.filter(s => s.status === 'running').forEach(s => map.set(s.table_id, s));
    return map;
  }, [sessions]);

  const todayPayments = payments.filter(p => new Date(p.paid_at).toDateString() === new Date().toDateString());
  const cashToday = todayPayments.filter(p => p.method === 'cash').reduce((n,p) => n + p.amount_paise, 0);
  const upiToday = todayPayments.filter(p => p.method === 'upi').reduce((n,p) => n + p.amount_paise, 0);
  const todayExpenses = expenses.filter(e => new Date(e.created_at).toDateString() === new Date().toDateString()).reduce((n,e) => n + e.amount_paise, 0);
  const expectedCash = Math.round(Number(openingCash || 0) * 100) + cashToday - todayExpenses;

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function startTable(table: TableRow) {
    if (!supabase || !profile) return;
    setBusy(true); setError(''); setNotice('');
    const { error } = await supabase.rpc('start_play_session', { p_table_id: table.id });
    if (error) setError(error.message); else { setNotice(`${table.label} session started.`); await refresh(); }
    setBusy(false);
  }

  async function endTable(table: TableRow) {
    if (!supabase || !profile) return;
    setBusy(true); setError(''); setNotice('');
    const { error } = await supabase.rpc('end_play_session', { p_table_id: table.id });
    if (error) setError(error.message); else { setNotice(`${table.label} session ended. Bill is ready.`); await refresh(); }
    setBusy(false);
  }

  async function receivePayment(s: PlaySession, method: 'cash' | 'upi') {
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const { error } = await supabase.rpc('receive_session_payment', { p_session_id: s.id, p_method: method });
    if (error) setError(error.message); else { setNotice(`Payment recorded as ${method.toUpperCase()}.`); await refresh(); }
    setBusy(false);
  }

  async function addTable() {
    if (!supabase || profile?.role !== 'owner') return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('add_snooker_table');
    if (error) setError(error.message); else { setNotice('New table added.'); await refresh(); }
    setBusy(false);
  }

  async function updateTableRate(table: TableRow) {
    if (!supabase || profile?.role !== 'owner') return;
    const rupees = Number(rateDrafts[table.id] ?? (table.hourly_rate_paise / 100).toString());
    if (!Number.isFinite(rupees) || rupees <= 0) { setError('Enter a valid hourly rate greater than zero.'); return; }
    setBusy(true); setError(''); setNotice('');
    const { error } = await supabase.rpc('update_table_rate', { p_table_id: table.id, p_hourly_rate_paise: Math.round(rupees * 100) });
    if (error) setError(error.message); else { setNotice(`${table.label} rate updated to ${money(Math.round(rupees * 100))} per hour.`); await refresh(); }
    setBusy(false);
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const rupees = Number(newExpense);
    if (!(rupees > 0) || !expenseNote.trim()) { setError('Enter a valid expense and description.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.from('expenses').insert({ amount_paise: Math.round(rupees * 100), description: expenseNote.trim() });
    if (error) setError(error.message); else { setNotice('Expense recorded.'); setNewExpense(''); setExpenseNote(''); await refresh(); }
    setBusy(false);
  }

  async function reconcile(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || profile?.role !== 'owner') return;
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) { setError('Enter a valid counted cash amount.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.rpc('record_cash_reconciliation', { p_opening_cash_paise: Math.round(Number(openingCash || 0)*100), p_counted_cash_paise: Math.round(amount*100) });
    if (error) setError(error.message); else { setNotice('Cash reconciliation saved to the audit log.'); await refresh(); }
    setBusy(false);
  }

  async function signOut() { await supabase!.auth.signOut(); }

  if (!configured) return <Setup />;
  if (!session) return <main className="login-wrap"><div className="login-card"><div className="brand-mark">GP</div><p className="eyebrow">GREEN POCKET SNOOKER ZONE</p><h1>Club management</h1><p className="muted">Sign in with your club account.</p><form onSubmit={signIn} className="stack"><label>Email<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required /></label><label>Password<input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>{error && <p className="error">{error}</p>}<p className="tiny">Accounts are created by the owner in Supabase Auth. Public registration is disabled.</p></div></main>;

  if (!profile) return <main className="login-wrap"><div className="login-card"><p>Loading club profile…</p>{error && <p className="error">{error}</p>}</div></main>;

  const unpaid = sessions.filter(s => s.status === 'ended' && !payments.some(p => p.session_id === s.id));
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark small">GP</div><div><strong>GREEN POCKET</strong><span>SNOOKER ZONE</span></div></div><div className="user-area"><span className="role-pill">{profile.role}</span><span className="user-name">{profile.full_name}</span><button className="icon-btn" onClick={signOut} title="Sign out"><LogOut size={18}/></button></div></header>
    <main className="content">
      <section className="welcome"><div><p className="eyebrow">CLUB OVERVIEW</p><h1>Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}</h1><p className="muted">Manage table sessions, billing and daily collections.</p></div><button className="secondary" onClick={()=>refresh()} disabled={busy}><RefreshCw size={16}/> Refresh</button></section>
      <section className="metrics">
        <Metric icon={<Table2/>} label="Active tables" value={`${activeByTable.size} / ${tables.length}`}/>
        <Metric icon={<Banknote/>} label="Cash collected today" value={money(cashToday)}/>
        <Metric icon={<Wallet/>} label="UPI collected today" value={money(upiToday)}/>
        <Metric icon={<Clock3/>} label="Bills awaiting payment" value={String(unpaid.length)}/>
      </section>
      <nav className="tabs"><button className={tab==='tables'?'selected':''} onClick={()=>setTab('tables')}>Tables & billing</button>{profile.role==='owner' && <><button className={tab==='reports'?'selected':''} onClick={()=>setTab('reports')}>Cash & reports</button><button className={tab==='audit'?'selected':''} onClick={()=>setTab('audit')}>Audit log</button></>}</nav>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {tab==='tables' && <>
        <div className="section-heading"><div><h2>Table status</h2><p className="muted">Each table has its own hourly rate. Billing is calculated by the minute and rounded up to the next minute.</p></div>{profile.role==='owner' && <button className="secondary" onClick={addTable} disabled={busy}><Plus size={16}/> Add table</button>}</div>
        <div className="table-grid">{tables.map(t=>{
          const running=activeByTable.get(t.id);
          const minutes=running?elapsed(running.started_at):0;
          const ratePaise = running?.hourly_rate_paise ?? t.hourly_rate_paise;
          const bill=running?charge(minutes, ratePaise):0;
          return <article className={`table-card ${running?'occupied':''}`} key={t.id}><div className="table-card-head"><span className="table-label">{t.label}</span><span className={`status ${running?'busy':'free'}`}>{running?'IN USE':'AVAILABLE'}</span></div><div className="table-rate">₹{(ratePaise/100).toFixed(0)} / hour{running ? ' (session rate)' : ''}</div>{running?<><div className="timer">{Math.floor(minutes/60).toString().padStart(2,'0')}:{(minutes%60).toString().padStart(2,'0')}</div><div className="started">Started {fmtTime(running.started_at)}</div><div className="estimate"><span>Current estimate</span><strong>{money(bill)}</strong></div><button className="danger full" disabled={busy} onClick={()=>endTable(t)}>End session & create bill</button></>:<><div className="empty-state"><div className="table-icon"><Table2 size={26}/></div><strong>Ready for next game</strong><span>No active session</span></div><button className="primary full" disabled={busy} onClick={()=>startTable(t)}>Start session</button></>}{profile.role==='owner' && <div className="rate-editor"><label>Hourly rate (₹)<input type="number" min="1" step="1" value={rateDrafts[t.id] ?? String(t.hourly_rate_paise/100)} onChange={e=>setRateDrafts(prev=>({...prev,[t.id]:e.target.value}))}/></label><button className="small-btn" disabled={busy} onClick={()=>updateTableRate(t)}>Save rate</button></div>}</article>
        })}</div>
        <section className="panel"><div className="section-heading"><div><h2>Pending bills</h2><p className="muted">Record payment only after confirming cash received or the merchant UPI transaction.</p></div></div>{unpaid.length===0?<p className="muted">No pending bills.</p>:<div className="table-scroll"><table><thead><tr><th>Table</th><th>Duration</th><th>Amount</th><th>Ended</th><th>Payment</th></tr></thead><tbody>{unpaid.map(s=><tr key={s.id}><td>{tables.find(t=>t.id===s.table_id)?.label || 'Table'}</td><td>{s.billable_minutes} min</td><td><strong>{money(s.amount_paise||0)}</strong></td><td>{s.ended_at?fmtTime(s.ended_at):'—'}</td><td><div className="actions"><button className="small-btn" disabled={busy} onClick={()=>receivePayment(s,'cash')}>Cash</button><button className="small-btn upi" disabled={busy} onClick={()=>receivePayment(s,'upi')}>UPI</button></div></td></tr>)}</tbody></table></div>}</section>
      </>}
      {tab==='reports' && profile.role==='owner' && <div className="report-grid">
        <section className="panel"><h2>Today's collection</h2><div className="report-line"><span>Cash received</span><strong>{money(cashToday)}</strong></div><div className="report-line"><span>UPI received</span><strong>{money(upiToday)}</strong></div><div className="report-line"><span>Total collected</span><strong>{money(cashToday+upiToday)}</strong></div><div className="report-line"><span>Authorised expenses</span><strong>{money(todayExpenses)}</strong></div></section>
        <section className="panel"><h2>Cash reconciliation</h2><form className="stack" onSubmit={reconcile}><label>Opening cash float (₹)<input type="number" min="0" step="0.01" value={openingCash} onChange={e=>setOpeningCash(e.target.value)}/></label><div className="report-line"><span>Expected closing cash</span><strong>{money(expectedCash)}</strong></div><label>Actual cash counted (₹)<input type="number" min="0" step="0.01" value={countedCash} onChange={e=>setCountedCash(e.target.value)} required/></label>{countedCash!==''&&<div className="report-line"><span>Difference</span><strong className={Math.round(Number(countedCash)*100)-expectedCash===0?'good':'warning'}>{money(Math.round(Number(countedCash)*100)-expectedCash)}</strong></div>}<button className="primary" disabled={busy}>Save reconciliation</button></form></section>
        <section className="panel"><h2>Record an expense</h2><form className="stack" onSubmit={addExpense}><label>Amount (₹)<input type="number" min="0.01" step="0.01" value={newExpense} onChange={e=>setNewExpense(e.target.value)} required/></label><label>Description<input value={expenseNote} onChange={e=>setExpenseNote(e.target.value)} placeholder="e.g. table maintenance" required/></label><button className="primary" disabled={busy}>Add expense</button></form></section>
        <section className="panel"><h2>Recent payments</h2>{payments.slice(0,8).map(p=><div className="report-line" key={p.id}><span>{p.invoice_no} · {p.method.toUpperCase()}</span><strong>{money(p.amount_paise)}</strong></div>)}</section>
      </div>}
      {tab==='audit' && profile.role==='owner' && <section className="panel"><div className="section-heading"><div><h2>Activity history</h2><p className="muted">Records are written by database functions and protected from staff edits.</p></div><ShieldCheck/></div>{audits.length===0?<p className="muted">No activity recorded yet.</p>:<div className="audit-list">{audits.map(a=><div className="audit-item" key={a.id}><span className="audit-dot"/><div><strong>{a.action.replaceAll('_',' ')}</strong><p>{JSON.stringify(a.details)}</p><small>{fmtTime(a.created_at)}</small></div></div>)}</div>}</section>}
      <footer>Green Pocket Snooker Zone · Table-specific hourly rates · <span>Cloud-synchronised</span></footer>
    </main>
  </div>;
}

function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) { return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>; }

function Setup() { return <main className="login-wrap"><div className="login-card"><div className="brand-mark">GP</div><p className="eyebrow">GREEN POCKET SNOOKER ZONE</p><h1>Connect your club database</h1><p className="muted">The app files are ready. Complete the Supabase setup in the included README, then add your project URL and public anon key to a <code>.env</code> file.</p><p className="tiny">Do not put a Supabase service-role key in this app. It must remain private.</p></div></main>; }
