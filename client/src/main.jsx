import React from 'react'
import Chart from 'chart.js/auto'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom'
import './index.css'

// In dev (Vite on port 5173), use proxy; otherwise call backend directly
const apiBase = (typeof window !== 'undefined' && window.location && window.location.port === '5173') ? '/api' : 'http://localhost:4000/api';

// ---- Auth Context ----
const AuthContext = React.createContext(null)

function useAuth() {
  const [token, setToken] = React.useState(localStorage.getItem('token'))
  const [user, setUser] = React.useState(null)
  const [booted, setBooted] = React.useState(false)

  React.useEffect(() => {
    try {
      if (!token) { setUser(null); setBooted(true); return }
      const payload = JSON.parse(atob(token.split('.')[1]))
      setUser(payload)
    } catch {
      setUser(null)
    } finally {
      setBooted(true)
    }
  }, [token])

  const login = (t) => { setToken(t); localStorage.setItem('token', t); setBooted(false) }
  const logout = () => { setToken(null); localStorage.removeItem('token'); setBooted(true) }

  return { token, user, login, logout, booted }
}

function AuthProvider({ children }) {
  const value = useAuth()
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuthCtx() { return React.useContext(AuthContext) }

function Authed({ roles, children }) {
  const { user, booted, token } = useAuthCtx()
  // Hold rendering briefly if a token exists but auth payload not decoded yet
  if (!booted && token) return <div style={{ padding: 16 }}>Checking permission…</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

// Basic error boundary to avoid full-blank screens on runtime errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <h3>Something went wrong.</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

function Layout() {
  const { user, logout } = useAuthCtx()
  const api = useApi()
  const [unread, setUnread] = React.useState(0)
  const [apiUp, setApiUp] = React.useState(true)
  const [theme, setTheme] = React.useState(() => (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  React.useEffect(() => {
    const apply = (mode) => {
      const root = document.documentElement
      const body = document.body
      if (mode === 'dark') { root.classList.add('dark'); body.classList.add('dark') }
      else { root.classList.remove('dark'); body.classList.remove('dark') }
      root.style.colorScheme = mode
    }
    apply(theme)
  }, [theme])
  React.useEffect(() => {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // Poll unread notifications for admins
  React.useEffect(() => {
    if (!user || user.role !== 'admin') { setUnread(0); return }
    let stop = false
    const load = async () => {
      try {
        const list = await api.get('/admin/notifications?unreadOnly=true')
        if (!stop) setUnread(Array.isArray(list) ? list.length : 0)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 15000)
    return () => { stop = true; clearInterval(t) }
  }, [user?.role])
  // Lightweight API health indicator
  React.useEffect(() => {
    let stop = false
    const ping = async () => {
      try {
        const r = await fetch(`${apiBase}/health`, { cache: 'no-store' })
        if (!stop) setApiUp(r.ok)
      } catch {
        if (!stop) setApiUp(false)
      }
    }
    ping()
    const t = setInterval(ping, 10000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300">
      <header className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shadow-sm transition-colors duration-300">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/" className="text-brand-600 dark:text-brand-500 font-bold text-lg">HAMS</Link>
          {user && (
            <nav className="flex gap-3 text-sm text-gray-700 dark:text-gray-200">
              <Link className="hover:text-brand-600" to="/rooms">Rooms</Link>
              <Link className="hover:text-brand-600" to="/bookings">My Bookings</Link>
              <Link className="hover:text-brand-600" to="/passes">My Passes</Link>
              <Link className="hover:text-brand-600" to="/notices">Notices</Link>
              <Link className="hover:text-brand-600" to="/complaints">Complaints</Link>
              <Link className="hover:text-brand-600" to="/profile">Profile</Link>
              {user?.role === 'admin' && (
                <Link className="hover:text-brand-600 inline-flex items-center gap-1" to="/admin">
                  Admin
                  {unread > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-none">
                      {unread}
                    </span>
                  )}
                </Link>
              )}
            </nav>
          )}
          <div className="ml-auto">
            {user ? (
              <div className="flex items-center gap-3">
                {!apiUp && (<span className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">API down</span>)}
                <span className="text-sm text-gray-600 dark:text-gray-300">Hi, {user.name || user.email}</span>
                <button className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-sm" onClick={logout}>Logout</button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <Link className="hover:text-brand-600" to="/login">Login</Link>
                <span className="text-gray-400">/</span>
                <Link className="hover:text-brand-600" to="/signup">Signup</Link>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <Routes>
          <Route path="/" element={<RedirectRoot />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/rooms" element={<Authed roles={['student','admin']}><Rooms /></Authed>} />
          <Route path="/bookings" element={<Authed roles={['student']}><MyBookings /></Authed>} />
          <Route path="/profile" element={<Authed roles={['student','admin']}><Profile /></Authed>} />
          <Route path="/passes" element={<Authed roles={['student']}><MyPasses /></Authed>} />
          <Route path="/notices" element={<Authed roles={['student','admin']}><Notices /></Authed>} />
          <Route path="/complaints" element={<Authed roles={['student']}><Complaints /></Authed>} />
          <Route path="/admin" element={<Authed roles={['admin']}><ErrorBoundary><Admin /></ErrorBoundary></Authed>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <footer className="text-center text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 py-4 transition-colors duration-300">© {new Date().getFullYear()} HAMS</footer>
    </div>
  )
}

function RedirectRoot() {
  const { user } = useAuthCtx()
  return user ? <Navigate to="/rooms" /> : <Navigate to="/login" />
}

function Login() {
  const { login } = useAuthCtx()
  const nav = useNavigate()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const submit = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      const res = await fetch(`${apiBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) {
        let msg = 'Login failed'
        if (typeof data.error === 'string') msg = data.error
        else if (data?.error?.fieldErrors) {
          const fe = data.error.fieldErrors
          const firstKey = Object.keys(fe)[0]
          const firstMsg = Array.isArray(fe[firstKey]) && fe[firstKey][0] ? fe[firstKey][0] : ''
          msg = firstKey ? `${firstKey}: ${firstMsg}` : 'Validation failed'
        } else if (Array.isArray(data?.error?.formErrors) && data.error.formErrors.length) {
          msg = data.error.formErrors[0]
        }
        alert(msg)
        return
      }
      login(data.token)
      nav('/rooms')
    } catch (err) {
      alert('Network error. Please check connection and try again.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
  <div className="w-full max-w-sm bg-white dark:bg-gray-950 shadow-lg rounded-xl p-6 border border-gray-100 dark:border-gray-800 transition-colors duration-300">
        <h3 className="text-2xl font-semibold text-center text-brand-600 dark:text-brand-400 mb-6">Welcome to HAMS</h3>
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-md py-2">{loading ? 'Logging in…' : 'Login'}</button>
        </form>
        <p className="text-center text-sm text-gray-600 dark:text-gray-300 mt-4">New here? <Link className="text-brand-600 dark:text-brand-400 hover:underline" to="/signup">Create an account</Link></p>
      </div>
    </div>
  )
}

function Signup() {
  const { login } = useAuthCtx()
  const nav = useNavigate()
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [rollNumber, setRoll] = React.useState('')
  const [department, setDept] = React.useState('')
  const [year, setYear] = React.useState('')
  const [role, setRole] = React.useState('student')
  const [adminCode, setAdminCode] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const payload = { name, email, password, role }
    if (role === 'student') {
      if (rollNumber) payload.rollNumber = rollNumber
      if (department) payload.department = department
      if (year) payload.year = Number(year)
    } else if (role === 'admin') {
      if (adminCode) payload.adminCode = adminCode
    }
    try {
      setLoading(true)
      const res = await fetch(`${apiBase}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) {
        let msg = 'Signup failed'
        if (typeof data.error === 'string') msg = data.error
        else if (data?.error?.fieldErrors) {
          const fe = data.error.fieldErrors
          const firstKey = Object.keys(fe)[0]
          const firstMsg = Array.isArray(fe[firstKey]) && fe[firstKey][0] ? fe[firstKey][0] : ''
          msg = firstKey ? `${firstKey}: ${firstMsg}` : 'Validation failed'
        } else if (Array.isArray(data?.error?.formErrors) && data.error.formErrors.length) {
          msg = data.error.formErrors[0]
        }
        alert(msg)
        return
      }
      login(data.token)
      nav('/rooms')
    } catch (err) {
      alert('Network error. Please check connection and try again.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
  <div className="w-full max-w-sm bg-white dark:bg-gray-950 shadow-lg rounded-xl p-6 border border-gray-100 dark:border-gray-800 transition-colors duration-300">
        <h3 className="text-2xl font-semibold text-center text-brand-600 dark:text-brand-400 mb-6">Create your account</h3>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300">Role
            <select className="mt-1 w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" value={role} onChange={e=>setRole(e.target.value)}>
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} />
          <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          {role === 'student' && (
            <>
              <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Roll number" value={rollNumber} onChange={e=>setRoll(e.target.value)} />
              <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Department" value={department} onChange={e=>setDept(e.target.value)} />
              <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Year (1-6)" type="number" min={1} max={6} value={year} onChange={e=>setYear(e.target.value)} />
            </>
          )}
          {role === 'admin' && (
            <>
                <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Admin Code" value={adminCode} onChange={e=>setAdminCode(e.target.value)} required />
            </>
          )}
          <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-md py-2">{loading ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="text-center text-sm text-gray-600 dark:text-gray-300 mt-4">Already have an account? <Link className="text-brand-600 dark:text-brand-400 hover:underline" to="/login">Login</Link></p>
      </div>
    </div>
  )
}

function useApi() {
  const { token } = useAuthCtx()
  return React.useMemo(() => {
    const extractMessage = (payload) => {
      if (!payload) return 'Request failed'
      if (typeof payload.error === 'string') return payload.error
      if (payload.error && typeof payload.error === 'object') {
        const fe = payload.error.fieldErrors || {}
        const parts = []
        for (const k of Object.keys(fe)) {
          const msgs = fe[k]
          if (Array.isArray(msgs) && msgs.length) parts.push(`${k}: ${msgs[0]}`)
        }
        const form = payload.error.formErrors
        if (Array.isArray(form) && form.length) parts.push(form[0])
        return parts.join('\n') || 'Validation failed'
      }
      return typeof payload === 'string' ? payload : 'Request failed'
    }
    const handle = async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = new Error(extractMessage(data))
        err.payload = data
        throw err
      }
      return data
    }
    return {
      async get(path) {
        const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: token ? `Bearer ${token}` : undefined } })
        return handle(res)
      },
      async post(path, body) {
        const res = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : undefined }, body: JSON.stringify(body) })
        return handle(res)
      },
      async put(path, body) {
        const res = await fetch(`${apiBase}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : undefined }, body: JSON.stringify(body) })
        return handle(res)
      },
      async del(path) {
        const res = await fetch(`${apiBase}${path}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : undefined } })
        return handle(res)
      }
    }
  }, [token])
}

function Rooms() {
  const api = useApi()
  const [rooms, setRooms] = React.useState([])
  const [amount, setAmount] = React.useState(50000) // fallback if price not set
  const [blockFilter, setBlockFilter] = React.useState('all')
  const [floorFilter, setFloorFilter] = React.useState('all')
  React.useEffect(() => { api.get('/rooms').then(setRooms).catch(console.error) }, [])
  const book = async (room, payNow = true) => {
    try {
      const payload = { roomId: room.id }
      // server uses room.price_cents if set; still pass amount for safety if missing
      if (typeof room.price_cents !== 'number') payload.amountCents = amount
      const { bookingId } = await api.post('/bookings', payload)
      if (payNow) {
        const pay = await api.post(`/bookings/${bookingId}/pay`)
        alert(`Paid! Receipt: ${pay.receipt.bookingId}`)
      } else {
        alert('Room held. Complete payment from My Bookings before the timer expires.')
      }
      setRooms(await api.get('/rooms'))
    } catch (e) { alert(e.error || 'Failed') }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold">Rooms</h3>
        <label className="text-sm text-gray-700">Default amount (cents) for rooms without price:
          <input className="ml-2 w-36 border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500" type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} />
        </label>
      </div>
      <div className="flex items-center gap-3 mb-3 text-sm">
        <label className="inline-flex items-center gap-2">Block
          <select className="border border-gray-300 rounded px-2 py-1" value={blockFilter} onChange={e=>setBlockFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2">Floor
          <select className="border border-gray-300 rounded px-2 py-1" value={floorFilter} onChange={e=>setFloorFilter(e.target.value)}>
            <option value="all">All</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(f => <option key={f} value={String(f)}>{f}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {rooms
          .filter(r => blockFilter === 'all' ? true : String(r.block || 1) === blockFilter)
          .filter(r => floorFilter === 'all' ? true : String(r.floor) === floorFilter)
          .map(r => (
          <div key={r.id} className="bg-white dark:bg-gray-950 rounded-lg shadow p-4 border border-gray-100 dark:border-gray-800 transition-colors duration-300">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Block {r.block || 1}, Floor {r.floor}, Room {r.number}</div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">cap {r.capacity}</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 space-x-2">
              {r.type && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">{r.type}</span>}
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">price {typeof r.price_cents==='number' ? r.price_cents : 'N/A'}</span>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs">available {r.available}</span>
            </div>
            <div className="mt-4 flex gap-2">
              {r.available > 0 ? (
                <>
                  <button className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-md py-1.5 text-sm" onClick={()=>book(r, true)}>Pay Now</button>
                  <button className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md py-1.5 text-sm" onClick={()=>book(r, false)}>Hold & Pay Later</button>
                </>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">No availability</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-4">Go to <Link className="text-brand-600 dark:text-brand-400 hover:underline" to="/bookings">My Bookings</Link> to complete payment.</p>
    </div>
  )
}

function MyPasses() {
  const api = useApi()
  const [list, setList] = React.useState([])
  const [type, setType] = React.useState('outpass')
  const [reason, setReason] = React.useState('')
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const load = () => api.get('/my/passes').then(setList)
  React.useEffect(() => { load() }, [])
  const submit = async (e) => {
    e.preventDefault()
    await api.post('/passes', { type, reason, fromDate, toDate })
    setReason(''); setFromDate(''); setToDate('')
    load()
  }
  return (
    <div>
      <h3 className="text-xl font-semibold mb-3">My Passes</h3>
  <div className="bg-white dark:bg-gray-950 rounded-lg shadow p-4 mb-4 border border-gray-100 dark:border-gray-800 transition-colors duration-300">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <select className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" value={type} onChange={e=>setType(e.target.value)}>
            <option value="outpass">Outpass</option>
            <option value="latepass">Late pass</option>
          </select>
          <input className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
          <input className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" type="date" value={toDate} onChange={e=>setToDate(e.target.value)} />
          <input className="sm:col-span-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Reason" value={reason} onChange={e=>setReason(e.target.value)} />
          <div className="sm:col-span-2">
            <button type="submit" className="w-full sm:w-auto bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2 px-4">Request</button>
          </div>
        </form>
      </div>
      <div className="space-y-2">
        {list.map(p => (
          <div key={p.id} className="bg-white dark:bg-gray-950 rounded-lg shadow p-3 flex items-center justify-between border border-gray-100 dark:border-gray-800 transition-colors duration-300">
            <div className="text-sm text-gray-800 dark:text-gray-200">
              <span className="font-medium mr-2 capitalize">{p.type}</span>
              <span className="text-gray-600 dark:text-gray-300">{p.from_date} → {p.to_date}</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${p.status==='requested' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : p.status==='approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Notices() {
  const [list, setList] = React.useState([])
  React.useEffect(() => { fetch(`${apiBase}/notices`).then(r=>r.json()).then(setList) }, [])
  return (
    <div>
      <h3 className="text-xl font-semibold mb-3">Notices</h3>
      <div className="space-y-2">
        {list.map(n => (
          <div key={n.id} className="bg-white dark:bg-gray-950 rounded-lg shadow p-3 border border-gray-100 dark:border-gray-800 transition-colors duration-300">
            <div className="flex items-center gap-2">
              {n.pinned ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">Pinned</span> : null}
              <div className="font-medium">{n.title}</div>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300">{n.body}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">by {n.author_name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Complaints() {
  const api = useApi()
  const [list, setList] = React.useState([])
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const load = () => api.get('/my/complaints').then(setList).catch(()=>setList([]))
  React.useEffect(()=>{ load() }, [])
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/complaints', { title, body })
      setTitle(''); setBody('')
      load()
      alert('Complaint submitted')
    } catch (err) { alert(err?.message || err?.error || 'Failed') }
  }
  return (
    <div>
      <h3 className="text-xl font-semibold mb-3">Complaints</h3>
      <div className="bg-white dark:bg-gray-950 rounded-lg shadow p-4 mb-4 border border-gray-100 dark:border-gray-800 transition-colors duration-300 max-w-xl">
        <form onSubmit={submit} className="grid gap-2">
          <input className="border p-2 rounded" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} required />
          <textarea className="border p-2 rounded" placeholder="Details (optional)" rows={4} value={body} onChange={e=>setBody(e.target.value)} />
          <button className="bg-brand-600 text-white rounded py-2 px-4 w-36" type="submit">Submit</button>
        </form>
      </div>
      <div className="space-y-2">
        {list.map(c=> {
          const status = c.status || (c.resolved ? 'completed' : 'pending')
          const badge = status === 'pending' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : status === 'rejected' ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          return (
            <div key={c.id} className="bg-white dark:bg-gray-950 rounded-lg shadow p-3 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="font-medium flex-1">{c.title}</div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${badge}`}>{status}</span>
              </div>
              {c.body && <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">{c.body}</div>}
              <div className="text-xs text-gray-500 mt-1">{c.created_at}{c.resolved_at ? ` → resolved ${c.resolved_at}` : ''}</div>
            </div>
          )
        })}
        {!list.length && <div className="text-sm text-gray-500">No complaints</div>}
      </div>
    </div>
  )
}

function Admin() {
  const api = useApi()
  const { user } = useAuthCtx()
  const [block, setBlock] = React.useState(1)
  const [floor, setFloor] = React.useState(1)
  const [number, setNumber] = React.useState('101')
  const [capacity, setCapacity] = React.useState(2)
  const [rooms, setRooms] = React.useState([])
  const [passes, setPasses] = React.useState([])
  const [users, setUsers] = React.useState([])
  const [notes, setNotes] = React.useState([])
  const [complaints, setComplaints] = React.useState([])
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [bulkText, setBulkText] = React.useState('')
  const [priceCents, setPrice] = React.useState('0')
  const [type, setType] = React.useState('')
  const [pinned, setPinned] = React.useState(false)
  const [publishAt, setPublishAt] = React.useState('')
  const donutRef = React.useRef(null)
  const barRef = React.useRef(null)
  const charts = React.useRef({})
  const [metrics, setMetrics] = React.useState(null)
  const [showRequestedOnly, setShowRequestedOnly] = React.useState(true)
  const roomsRef = React.useRef(null)
  const passesRef = React.useRef(null)
  const noticesRef = React.useRef(null)
  const load = async () => {
    const [r, p] = await Promise.allSettled([api.get('/rooms'), api.get('/passes')])
    if (r.status==='fulfilled') setRooms(r.value)
    if (p.status==='fulfilled') setPasses(p.value)
    try { setMetrics(await api.get('/admin/metrics')) } catch (e) { console.warn('metrics load failed', e) }
    try { setUsers(await api.get('/admin/users')) } catch (e) { console.warn('users load failed', e) }
    try { setNotes(await api.get('/admin/notifications?unreadOnly=true')) } catch (e) { console.warn('notes load failed', e) }
    try { setComplaints(await api.get('/admin/complaints')) } catch (e) { console.warn('complaints load failed', e) }
  }
  React.useEffect(() => { load() }, [])
  React.useEffect(() => {
    if (!metrics) return
    try {
      // Destroy previous charts if exist
      try { charts.current.donut?.destroy() } catch {}
      try { charts.current.bar?.destroy() } catch {}
      // Donut: bookings by status
      const d = metrics.bookingsByStatus || { pending:0, paid:0, cancelled:0 }
      const donutCtx = donutRef.current?.getContext('2d')
      if (donutCtx) {
        charts.current.donut = new Chart(donutCtx, {
          type: 'doughnut',
          data: {
            labels: ['Pending','Paid','Cancelled'],
            datasets: [{ data: [d.pending||0, d.paid||0, d.cancelled||0], backgroundColor: ['#fbbf24','#10b981','#ef4444'] }]
          },
          options: { plugins: { legend: { position: 'bottom' } } }
        })
      }
      // Bar: occupancy by floor
      const floors = (metrics.occupancyByFloor||[]).map(x=>`F${x.floor}`)
      const used = (metrics.occupancyByFloor||[]).map(x=>x.used)
      const beds = (metrics.occupancyByFloor||[]).map(x=>x.beds)
      const barCtx = barRef.current?.getContext('2d')
      if (barCtx) {
        charts.current.bar = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: floors,
            datasets: [
              { label: 'Used', data: used, backgroundColor: '#60a5fa' },
              { label: 'Beds', data: beds, backgroundColor: '#cbd5e1' }
            ]
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        })
      }
    } catch (err) {
      console.error('Chart render failed', err)
    }
  }, [metrics])
  const addRoom = async (e) => { e.preventDefault(); await api.post('/rooms', { block: Number(block), floor: Number(floor), number, capacity: Number(capacity), priceCents: Number(priceCents||'0'), type: type || undefined }); load() }
  const decide = async (id, decision) => { await api.post(`/passes/${id}/decision`, { decision }); load() }
  const publish = async (e) => { e.preventDefault(); await api.post('/notices', { title, body, pinned, publishAt: publishAt ? new Date(publishAt).toISOString() : undefined }); setTitle(''); setBody(''); setPinned(false); setPublishAt('') }
  const seedMerge = async () => { await api.post('/admin/seed-rooms', {}); await load() }
  const seedReset = async () => { if (!confirm('This will reset rooms to standard layout. Continue?')) return; await api.post('/admin/seed-rooms', { force: true }); await load() }
  const markAllRead = async () => { await api.post('/admin/notifications/read-all', {}); setNotes([]) }
  const markRead = async (id) => { await api.post(`/admin/notifications/${id}/read`, {}); setNotes(prev => prev.filter(n=>n.id!==id)) }
  const resolveComplaint = async (id) => { await api.post(`/admin/complaints/${id}/resolve`, {}); setComplaints(prev => prev.map(c => c.id===id ? { ...c, resolved: true, resolved_at: new Date().toISOString() } : c)) }
  const deleteComplaint = async (id) => { if (!confirm('Delete complaint?')) return; await api.del(`/admin/complaints/${id}`); setComplaints(prev => prev.filter(c=>c.id!==id)) }
  const setComplaintStatus = async (id, status) => { await api.post(`/admin/complaints/${id}/status`, { status }); setComplaints(prev => prev.map(c => c.id===id ? { ...c, status, updated_at: new Date().toISOString(), resolved: status==='completed', resolved_at: status==='completed' ? new Date().toISOString() : c.resolved_at } : c)) }
  const updateRoom = async (r, patch) => { await api.put(`/rooms/${r.id}`, patch); await load() }
  const deleteRoom = async (r) => { if (!confirm('Delete this room? (must have no active bookings)')) return; await api.del(`/rooms/${r.id}`); await load() }
  const totalBeds = rooms.reduce((a,r)=>a+(Number(r.capacity)||0),0)
  const availableBeds = rooms.reduce((a,r)=>a+(Number(r.available)||0),0)
  const pendingPasses = passes.filter(p=>p.status==='requested').length
  const filteredPasses = showRequestedOnly ? passes.filter(p=>p.status==='requested') : passes
  return <div>
    <h3>Admin</h3>
    <section style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa' }}>
        <b>Welcome, {user?.name || user?.email}</b>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6 }}>Rooms: {rooms.length}</div>
          <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6 }}>Beds: {availableBeds}/{totalBeds} available</div>
          <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6 }}>Pending passes: {pendingPasses}</div>
          <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6 }}>Users: {users.length}</div>
          <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6 }}>Unread alerts: {notes.length}</div>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={()=>roomsRef.current?.scrollIntoView({ behavior: 'smooth' })}>Go to Rooms</button>
          <button onClick={()=>passesRef.current?.scrollIntoView({ behavior: 'smooth' })}>Go to Passes</button>
          <button onClick={()=>noticesRef.current?.scrollIntoView({ behavior: 'smooth' })}>Publish Notice</button>
          <button onClick={load}>Refresh</button>
          <button onClick={seedMerge}>Seed rooms (merge)</button>
          <button onClick={seedReset}>Reset rooms (force)</button>
        </div>
        {metrics && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
            <div>
              <h5 style={{ margin: '6px 0' }}>Bookings status</h5>
              <canvas ref={donutRef} height="160" />
            </div>
            <div>
              <h5 style={{ margin: '6px 0' }}>Occupancy by floor</h5>
              <canvas ref={barRef} height="160" />
            </div>
            <div style={{ gridColumn: '1 / span 2' }}>
              <h5 style={{ margin: '6px 0' }}>Recent payments</h5>
              <ul>
                {(metrics.recentPayments || []).map(r => (
                  <li key={r.id}>{r.paid_at} — {r.user?.name || r.user?.email} — Room {r.room?.floor}-{r.room?.number} — {r.amount_cents}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
    <section>
      <h4 ref={roomsRef}>Create Room</h4>
      <form onSubmit={addRoom} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="number" value={block} min={1} max={4} onChange={e=>setBlock(e.target.value)} placeholder="Block (1-4)" />
        <input type="number" value={floor} onChange={e=>setFloor(e.target.value)} placeholder="Floor" />
        <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Number" />
        <input type="number" value={capacity} onChange={e=>setCapacity(e.target.value)} placeholder="Capacity" />
        <input type="number" value={priceCents} onChange={e=>setPrice(e.target.value)} placeholder="Price (cents)" />
        <input value={type} onChange={e=>setType(e.target.value)} placeholder="Type (e.g., Double)" />
        <button type="submit">Add</button>
      </form>
      <details style={{ marginTop: 8 }}>
        <summary>Bulk import (CSV). Supported per line: floor,number,capacity,priceCents,type OR block,floor,number,capacity,priceCents,type</summary>
        <textarea rows={6} style={{ width: '100%', maxWidth: 540 }} value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={'# without block\n1,101,2,50000,Double\n1,102,2,50000,Double\n\n# with block\n1,1,100,2,50000,Double\n2,1,110,2,50000,Double'} />
        <div>
          <button onClick={async()=>{ await api.post('/rooms/bulk', { text: bulkText }); setBulkText(''); load() }}>Import</button>
        </div>
      </details>
      <ul>
        {rooms.map(r => (
          <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
            <span>Block {r.block || 1}, Floor {r.floor}, Room {r.number}</span>
            <label>cap <input type="number" style={{ width: 70 }} defaultValue={r.capacity} onBlur={e=>updateRoom(r, { capacity: Number(e.target.value) })} /></label>
            <label>price <input type="number" style={{ width: 90 }} defaultValue={typeof r.price_cents==='number'?r.price_cents:''} onBlur={e=>updateRoom(r, { priceCents: Number(e.target.value||'0') })} /></label>
            <label>type <input type="text" style={{ width: 110 }} defaultValue={r.type||''} onBlur={e=>updateRoom(r, { type: e.target.value || undefined })} /></label>
            <button onClick={()=>deleteRoom(r)}>Delete</button>
            <span style={{ fontSize: 12, color: '#555' }}>available {r.available}</span>
          </li>
        ))}
      </ul>
    </section>
    <section>
      <h4 ref={passesRef}>Passes</h4>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={showRequestedOnly} onChange={e=>setShowRequestedOnly(e.target.checked)} /> Show only pending
      </label>
      <ul>
        {filteredPasses.map(p => (
          <li key={p.id}>
            {p.name} ({p.email}) — {p.type} {p.from_date}→{p.to_date} — {p.status}
            {p.status === 'requested' && (
              <>
                <button onClick={()=>decide(p.id,'approved')} style={{ marginLeft: 8 }}>Approve</button>
                <button onClick={()=>decide(p.id,'rejected')} style={{ marginLeft: 8 }}>Reject</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
    <section>
      <h4 ref={noticesRef}>Publish Notice</h4>
      <form onSubmit={publish} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
        <input placeholder="Body" value={body} onChange={e=>setBody(e.target.value)} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} /> Pinned
        </label>
        <input type="datetime-local" value={publishAt} onChange={e=>setPublishAt(e.target.value)} placeholder="Publish At" />
        <button type="submit">Publish</button>
        <button type="button" onClick={()=>window.open('/api/reports/bookings.csv','_blank')}>Export Bookings CSV</button>
      </form>
    </section>
    <section>
      <h4>Notifications</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={markAllRead} disabled={!notes.length}>Mark all read</button>
        <button onClick={()=>api.get('/admin/notifications').then(setNotes)}>Reload</button>
      </div>
      <ul>
        {notes.map(n => (
          <li key={n.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{n.created_at} — {n.message}</span>
            <button onClick={()=>markRead(n.id)}>Read</button>
          </li>
        ))}
        {!notes.length && <li>No unread notifications</li>}
      </ul>
    </section>
    <section>
      <h4>Complaints</h4>
      <ul>
        {complaints.map(c => {
          const status = c.status || (c.resolved ? 'completed' : 'pending')
          const badgeStyle = status === 'pending' ? { background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 12, fontSize: 11 } : status === 'rejected' ? { background: '#ffe4e6', color: '#be123c', padding: '2px 8px', borderRadius: 12, fontSize: 11 } : { background: '#d1fae5', color: '#047857', padding: '2px 8px', borderRadius: 12, fontSize: 11 }
          return (
            <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 10, borderBottom: '1px solid #eee', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>{c.title}</div>
                  <span style={badgeStyle}>{status}</span>
                </div>
                {c.body && <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{c.body}</div>}
                <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{c.created_at} — {c.user?.name || c.user?.email}{c.updated_at ? ` • updated ${c.updated_at}` : ''}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button disabled={status==='pending'} onClick={()=>setComplaintStatus(c.id,'pending')}>Pending</button>
                <button disabled={status==='rejected'} onClick={()=>setComplaintStatus(c.id,'rejected')}>Reject</button>
                <button disabled={status==='completed'} onClick={()=>setComplaintStatus(c.id,'completed')}>Complete</button>
                <button onClick={()=>deleteComplaint(c.id)} style={{ marginTop: 4 }}>Delete</button>
              </div>
            </li>
          )
        })}
        {!complaints.length && <li>No complaints</li>}
      </ul>
    </section>
    <section>
      <h4>Users</h4>
      <ul>
        {users.map(u => (
          <li key={u.id}>{u.name || u.email} — {u.email} — {u.role} — joined {u.created_at}{u.last_login ? ` — last login ${u.last_login}` : ''}</li>
        ))}
      </ul>
    </section>
  </div>
}

function MyBookings() {
  const api = useApi()
  const [list, setList] = React.useState([])
  const tick = React.useRef()
  const load = async () => { setList(await api.get('/my/bookings')) }
  React.useEffect(() => { load(); tick.current = setInterval(load, 10000); return () => clearInterval(tick.current) }, [])
  const pay = async (id) => {
    try { const res = await api.post(`/bookings/${id}/pay`); alert(`Paid ${res.receipt.amountCents} at ${res.receipt.paidAt}`); load() } catch (e) { alert(e.error || 'Failed') }
  }
  const cancel = async (id) => { try { await api.del(`/bookings/${id}`); load() } catch (e) { alert(e.error || 'Failed') } }
  const remaining = (expires_at) => {
    if (!expires_at) return null
    const ms = new Date(expires_at).getTime() - Date.now()
    if (ms <= 0) return 'Expired'
    const m = Math.floor(ms / 60000), s = Math.floor((ms%60000)/1000)
    return `${m}m ${s}s`
  }
  return (
    <div>
      <h3 className="text-xl font-semibold mb-3">My Bookings</h3>
      <div className="space-y-2">
        {list.map(b => (
          <div key={b.id} className="bg-white dark:bg-gray-950 rounded-lg shadow p-3 flex items-center justify-between border border-gray-100 dark:border-gray-800 transition-colors duration-300">
            <div className="text-sm text-gray-800 dark:text-gray-200">
              <div className="font-medium">Block {b.block || 1} — Room {b.floor}-{b.number}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{b.expires_at && b.status==='pending' ? <>expires in <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">{remaining(b.expires_at)}</span></> : null}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${b.status==='pending' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : b.status==='paid' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{b.status}</span>
              {b.status === 'pending' && (
                <>
                  <button className="bg-brand-600 hover:bg-brand-700 text-white rounded-md px-3 py-1 text-xs" onClick={()=>pay(b.id)}>Pay Now</button>
                  <button className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md px-3 py-1 text-xs" onClick={()=>cancel(b.id)}>Cancel</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Profile() {
  const api = useApi()
  const [form, setForm] = React.useState({ name: '', rollNumber: '', department: '', year: 1 })
  React.useEffect(() => { api.get('/me').then(u => setForm({ name: u.name || '', rollNumber: u.roll_number || '', department: u.department || '', year: u.year || 1 })) }, [])
  const submit = async (e) => {
    e.preventDefault()
    const body = { ...form, year: Number(form.year) }
    try { await api.put('/me', body); alert('Profile updated') } catch (e) { alert(e.error || 'Failed') }
  }
  const set = (k,v)=>setForm(prev=>({ ...prev, [k]: v }))
  return (
    <div>
      <h3 className="text-xl font-semibold mb-3">My Profile</h3>
  <form onSubmit={submit} className="bg-white dark:bg-gray-950 rounded-lg shadow p-4 grid gap-3 max-w-md border border-gray-100 dark:border-gray-800 transition-colors duration-300">
        <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Full name" value={form.name} onChange={e=>set('name', e.target.value)} />
        <input className="w-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-md px-3 py-2" placeholder="Roll number" value={form.rollNumber} readOnly disabled />
        <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Department" value={form.department} onChange={e=>set('department', e.target.value)} />
        <input className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Year" type="number" min={1} max={6} value={form.year} onChange={e=>set('year', e.target.value)} />
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2">Save</button>
      </form>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
