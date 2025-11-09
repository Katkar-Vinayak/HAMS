import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const DB_FILE = process.env.DB_FILE || './data/hams.json';
const PENDING_HOLD_MINUTES = parseInt(process.env.PENDING_HOLD_MINUTES || '10', 10);
const ADMIN_SIGNUP_CODE = process.env.ADMIN_SIGNUP_CODE;

// Ensure data dir exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const adapter = new JSONFile(DB_FILE)
const defaultData = { users: [], rooms: [], bookings: [], passes: [], notices: [], notifications: [], complaints: [] }
const db = new Low(adapter, defaultData)
await db.read()
// Ensure data is initialized and persisted so the JSON file exists
if (!db.data || typeof db.data !== 'object') {
  db.data = { ...defaultData }
}
// Backfill missing top-level arrays for backward compatibility
for (const k of Object.keys(defaultData)) {
  if (!Array.isArray(db.data[k])) db.data[k] = []
}
await db.write()

function generateHostelRooms() {
  const out = []
  for (let f = 1; f <= 12; f++) {
    for (let b = 1; b <= 4; b++) {
      for (let r = 0; r <= 9; r++) {
        const num = String(f * 100 + (b - 1) * 10 + r)
        out.push({ id: uuidv4(), block: b, floor: f, number: num, capacity: 2 })
      }
    }
  }
  return out
}

function ensureHostelCompleteness() {
  const fresh = generateHostelRooms()
  const existingKey = new Set((db.data.rooms || []).map(r => `${r.block||1}|${r.floor}|${String(r.number)}`))
  let added = 0
  for (const r of fresh) {
    const key = `${r.block}|${r.floor}|${String(r.number)}`
    if (!existingKey.has(key)) {
      db.data.rooms.push({ id: uuidv4(), block: r.block, floor: r.floor, number: r.number, capacity: r.capacity, price_cents: 0, type: null })
      added++
    }
  }
  if (added > 0) db.write()
  return added
}

// Seed default admin only in non-production environments if no admin exists
if (process.env.NODE_ENV !== 'production') {
  const hasAdmin = (db.data.users || []).some(u => u.role === 'admin');
  if (!hasAdmin) {
    const adminEmail = 'admin@hams.local';
    const id = uuidv4();
    const password_hash = bcrypt.hashSync('admin123', 10);
    db.data.users.push({ id, email: adminEmail, name: 'Warden', password_hash, role: 'admin', created_at: new Date().toISOString() })
    await db.write()
    console.log('Seeded development admin user: admin@hams.local / admin123')
  }
}

// Seed hostel layout if none exist: 4 blocks x 12 floors, rooms per floor per block:
// For floor f (1..12), block b (1..4), room indices r (0..9)
// Room number = f*100 + (b-1)*10 + r
if (!db.data.rooms || db.data.rooms.length === 0) {
  const demo = []
  for (let f = 1; f <= 12; f++) {
    for (let b = 1; b <= 4; b++) {
      for (let r = 0; r <= 9; r++) {
        const num = String(f * 100 + (b - 1) * 10 + r)
        demo.push({ id: uuidv4(), block: b, floor: f, number: num, capacity: 2 })
      }
    }
  }
  db.data.rooms.push(...demo)
  await db.write()
}

// Always ensure the standard layout exists (merge-only, non-destructive)
const addedRooms = ensureHostelCompleteness()
if (addedRooms > 0) {
  console.log(`Added ${addedRooms} missing standard rooms to complete hostel layout`)
}

app.use(helmet());
// Enable CORS for all routes and handle preflight requests explicitly
app.use(cors());
app.options('*', cors());
app.use(express.json());
app.use(morgan('dev'));

function authMiddleware(requiredRole) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const token = auth.slice(7);
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) return res.status(403).json({ error: 'Forbidden' });
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function cleanupExpiredPendings() {
  const now = Date.now();
  let changed = false;
  for (const b of db.data.bookings) {
    if (b.status === 'pending' && b.expires_at) {
      const exp = new Date(b.expires_at).getTime();
      if (!Number.isNaN(exp) && exp < now) {
        b.status = 'cancelled';
        changed = true;
      }
    }
  }
  if (changed) db.write();
}

// Auth
app.post('/api/auth/register', (req, res) => {
  const bodySchema = z.object({
    email: z.string().email(),
    name: z.string().min(2),
    password: z.string().min(6),
    rollNumber: z.string().regex(/^[A-Za-z0-9\-]{4,20}$/).optional(),
    department: z.string().min(2).max(50).optional(),
    year: z.number().int().min(1).max(6).optional(),
    role: z.enum(['student','admin']).optional(),
    adminCode: z.string().optional()
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, name, password, rollNumber, department, year, role: requestedRole, adminCode } = parsed.data;
  const existing = db.data.users.find(u => u.email === email)
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  if (rollNumber) {
    const rollUsed = db.data.users.find(u => (u.roll_number||'').toLowerCase() === rollNumber.toLowerCase());
    if (rollUsed) return res.status(409).json({ error: 'Roll number already in use' });
  }
  let role = requestedRole || 'student';
  // Enforce admin code for admin registrations
  if (role === 'admin') {
    const code = (adminCode || '').trim();
    if (!ADMIN_SIGNUP_CODE) {
      return res.status(403).json({ error: 'Admin signups are disabled. Contact warden.' });
    }
    if (code !== ADMIN_SIGNUP_CODE) {
      return res.status(403).json({ error: 'Invalid admin code' });
    }
  }
  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  db.data.users.push({ id, email, name, password_hash, role, created_at: new Date().toISOString(), roll_number: rollNumber ?? null, department: department ?? null, year: year ?? null })
  db.write();
  const token = jwt.sign({ id, email, role, name }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token });
});

app.post('/api/auth/login', (req, res) => {
  const bodySchema = z.object({
    email: z.string().email(),
    password: z.string()
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;
  const user = db.data.users.find(u => u.email === email)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  // track last login
  user.last_login = new Date().toISOString()
  db.write()
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token });
});

// Me (profile)
app.get('/api/me', authMiddleware(), (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const { password_hash, ...safe } = user
  res.json(safe)
})

app.put('/api/me', authMiddleware(), (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(100),
    rollNumber: z.string().regex(/^[A-Za-z0-9\-]{4,20}$/),
    department: z.string().min(2).max(50),
    year: z.number().int().min(1).max(6)
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const user = db.data.users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const { name, rollNumber, department, year } = parsed.data
  const rollUsed = db.data.users.find(u => u.id !== user.id && (u.roll_number||'').toLowerCase() === rollNumber.toLowerCase())
  if (rollUsed) return res.status(409).json({ error: 'Roll number already in use' })
  user.name = name
  user.roll_number = rollNumber
  user.department = department
  user.year = year
  db.write()
  res.json({ ok: true })
})

// Rooms
app.get('/api/rooms', authMiddleware(), (req, res) => {
  cleanupExpiredPendings();
  const rooms = db.data.rooms
    .map(r => {
      const activeCount = db.data.bookings.filter(b => b.room_id === r.id && (b.status === 'pending' || b.status === 'paid')).length;
      const available = Math.max(0, (r.capacity || 1) - activeCount);
      return { ...r, booked: available === 0, available };
    })
    .sort((a,b)=> (a.block||0) - (b.block||0) || a.floor - b.floor || String(a.number).localeCompare(String(b.number)))
  res.json(rooms);
});

// Admin: update room
app.put('/api/rooms/:id', authMiddleware('admin'), (req, res) => {
  const schema = z.object({ capacity: z.number().int().min(1).optional(), priceCents: z.number().int().min(0).optional(), type: z.string().nullable().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const room = db.data.rooms.find(r => r.id === req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found' })
  const { capacity, priceCents, type } = parsed.data
  if (typeof capacity === 'number') room.capacity = capacity
  if (typeof priceCents === 'number') room.price_cents = priceCents
  if (typeof type !== 'undefined') room.type = type
  db.write()
  res.json({ ok: true })
})

// Admin: delete room (only if no active bookings)
app.delete('/api/rooms/:id', authMiddleware('admin'), (req, res) => {
  const room = db.data.rooms.find(r => r.id === req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found' })
  const hasActive = (db.data.bookings||[]).some(b => b.room_id === room.id && (b.status === 'pending' || b.status === 'paid'))
  if (hasActive) return res.status(400).json({ error: 'Cannot delete room with active bookings' })
  db.data.rooms = db.data.rooms.filter(r => r.id !== room.id)
  db.write()
  res.json({ ok: true })
})

// Admin: regenerate or merge standard hostel rooms layout
app.post('/api/admin/seed-rooms', authMiddleware('admin'), (req, res) => {
  const schema = z.object({ force: z.boolean().optional() })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { force } = parsed.data
  const fresh = generateHostelRooms()
  if (force) {
    db.data.rooms = fresh
  } else {
    for (const r of fresh) {
      const exists = db.data.rooms.find(x => (x.block||1) === (r.block||1) && x.floor === r.floor && String(x.number) === String(r.number))
      if (!exists) db.data.rooms.push(r)
    }
  }
  db.write()
  res.json({ ok: true, total: db.data.rooms.length })
})

app.post('/api/rooms', authMiddleware('admin'), (req, res) => {
  const schema = z.object({
    block: z.number().int().min(1).max(4),
    floor: z.number().int().min(1).max(12),
    number: z.string().min(1),
    capacity: z.number().int().min(1),
    priceCents: z.number().int().min(0).default(0),
    type: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { block, floor, number, capacity, priceCents, type } = parsed.data;
  const exists = db.data.rooms.find(r => (r.block||1) === block && r.floor === floor && r.number === number)
  if (exists) return res.status(409).json({ error: 'Room already exists' })
  const id = uuidv4();
  db.data.rooms.push({ id, block, floor, number, capacity, price_cents: priceCents, type: type ?? null })
  db.write();
  res.status(201).json({ id, block, floor, number, capacity, price_cents: priceCents, type: type ?? null });
});

// Bulk create rooms: supports either CSV text or structured array.
// CSV formats supported per line:
// - floor,number,capacity,priceCents,type
// - block,floor,number,capacity,priceCents,type
app.post('/api/rooms/bulk', authMiddleware('admin'), (req, res) => {
  const schema = z.union([
    z.object({ text: z.string().min(1) }),
    z.object({ rooms: z.array(z.object({ block: z.number().int().min(1).max(4).optional(), floor: z.number().int(), number: z.string(), capacity: z.number().int().min(1), priceCents: z.number().int().min(0).optional(), type: z.string().optional() })).min(1) })
  ]);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  let incoming = [];
  if ('text' in parsed.data) {
    const lines = parsed.data.text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(',').map(s=>s?.trim());
      let block, floor, number, capacity, priceCents, type
      if (parts.length >= 5) {
        // Try format with block
        const bMaybe = Number(parts[0]);
        const fMaybe = Number(parts[1]);
        if (Number.isInteger(bMaybe) && bMaybe>=1 && bMaybe<=4 && Number.isInteger(fMaybe)) {
          block = bMaybe
          floor = fMaybe
          number = parts[2]
          capacity = Number(parts[3] || '1')
          priceCents = parts[4] ? Number(parts[4]) : 0
          type = parts[5]
        }
      }
      if (floor === undefined) {
        // Fallback to format without block
        const floorS = parts[0];
        number = parts[1]
        const capacityS = parts[2]
        const priceS = parts[3]
        type = parts[4]
        floor = Number(floorS)
        capacity = Number(capacityS || '1')
        priceCents = priceS ? Number(priceS) : 0
      }
      if (!number || !Number.isInteger(floor) || !Number.isInteger(capacity) || capacity < 1) continue;
      incoming.push({ block, floor, number, capacity, priceCents, type });
    }
  } else {
    incoming = parsed.data.rooms;
  }
  const created = [];
  for (const r of incoming) {
    const exists = db.data.rooms.find(x => (x.block||1) === (r.block||1) && x.floor === r.floor && x.number === r.number);
    if (exists) continue;
    const id = uuidv4();
    db.data.rooms.push({ id, block: r.block ?? 1, floor: r.floor, number: r.number, capacity: r.capacity, price_cents: r.priceCents ?? 0, type: r.type ?? null });
    created.push({ id, block: r.block ?? 1, floor: r.floor, number: r.number, capacity: r.capacity, priceCents: r.priceCents ?? 0, type: r.type ?? null });
  }
  db.write();
  res.status(201).json({ createdCount: created.length, created });
});

// Booking logic: first-paid-first-served, unique pending/paid per room enforced by UNIQUE constraint
app.post('/api/bookings', authMiddleware('student'), (req, res) => {
  const schema = z.object({ roomId: z.string(), amountCents: z.number().int().positive().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { roomId } = parsed.data;
  cleanupExpiredPendings();
  const room = db.data.rooms.find(r => r.id === roomId)
  if (!room) return res.status(400).json({ error: 'Invalid room' })
  // one paid booking per student
  const hasPaid = db.data.bookings.find(b => b.user_id === req.user.id && b.status === 'paid');
  if (hasPaid) return res.status(400).json({ error: 'You already have a booked room' })
  // capacity check based on active bookings
  const activeCount = db.data.bookings.filter(b => b.room_id === roomId && (b.status === 'pending' || b.status === 'paid')).length;
  if (activeCount >= (room.capacity || 1)) return res.status(409).json({ error: 'No slots available' })
  const amount_cents = Number.isInteger(room.price_cents) ? room.price_cents : (parsed.data.amountCents ?? 0)
  const id = uuidv4();
  const expires_at = new Date(Date.now() + PENDING_HOLD_MINUTES * 60 * 1000).toISOString();
  db.data.bookings.push({ id, room_id: roomId, user_id: req.user.id, status: 'pending', amount_cents, created_at: new Date().toISOString(), paid_at: null, expires_at })
  db.write();
  // notify admins
  try {
    const user = db.data.users.find(u=>u.id===req.user.id)
    const msg = `New booking (pending) by ${user?.name||user?.email}: Block ${room.block||1}, Floor ${room.floor}, Room ${room.number}`
    db.data.notifications.push({ id: uuidv4(), type: 'booking_pending', message: msg, created_at: new Date().toISOString(), read: false })
    db.write()
  } catch {}
  res.status(201).json({ bookingId: id, status: 'pending' });
});

app.post('/api/bookings/:id/pay', authMiddleware('student'), (req, res) => {
  const { id } = req.params;
  cleanupExpiredPendings();
  const booking = db.data.bookings.find(b => b.id === id && b.user_id === req.user.id)
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status === 'paid') return res.json({ status: 'paid' });
  // Atomic transition: ensure no other paid/pending exists for this room
  const room = db.data.rooms.find(r => r.id === booking.room_id)
  const paidCount = db.data.bookings.filter(b => b.room_id === booking.room_id && b.status === 'paid').length;
  if (paidCount >= (room?.capacity || 1)) return res.status(409).json({ error: 'Room full' });
  if (booking.status !== 'pending') return res.status(409).json({ error: 'Payment race lost' })
  booking.status = 'paid';
  booking.paid_at = new Date().toISOString();
  db.write();
  // notify admins
  try {
    const user = db.data.users.find(u=>u.id===req.user.id)
    const msg = `Booking PAID by ${user?.name||user?.email}: Block ${room?.block||1}, Floor ${room?.floor}, Room ${room?.number} — ${booking.amount_cents} cents`
    db.data.notifications.push({ id: uuidv4(), type: 'booking_paid', message: msg, created_at: new Date().toISOString(), read: false })
    db.write()
  } catch {}
  res.json({ status: 'paid', receipt: { bookingId: id, amountCents: booking.amount_cents, paidAt: booking.paid_at } });
});

app.get('/api/my/bookings', authMiddleware('student'), (req, res) => {
  const rows = db.data.bookings
    .filter(b => b.user_id === req.user.id)
    .map(b => {
      const room = db.data.rooms.find(r => r.id === b.room_id) || {}
      return { ...b, block: room.block || 1, floor: room.floor, number: room.number }
    })
    .sort((a,b)=> b.created_at.localeCompare(a.created_at))
  res.json(rows);
});

app.delete('/api/bookings/:id', authMiddleware('student'), (req, res) => {
  const { id } = req.params;
  const booking = db.data.bookings.find(b => b.id === id && b.user_id === req.user.id)
  if (!booking) return res.status(404).json({ error: 'Not found' });
  if (booking.status === 'paid') return res.status(400).json({ error: 'Cannot cancel a paid booking' });
  booking.status = 'cancelled';
  db.write();
  res.json({ status: 'cancelled' });
});

// Passes
app.post('/api/passes', authMiddleware('student'), (req, res) => {
  const schema = z.object({ type: z.enum(['outpass','latepass']), reason: z.string().optional(), fromDate: z.string(), toDate: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { type, reason, fromDate, toDate } = parsed.data;
  const id = uuidv4();
  db.data.passes.push({ id, user_id: req.user.id, type, reason: reason ?? null, from_date: fromDate, to_date: toDate, status: 'requested', created_at: new Date().toISOString(), decided_at: null })
  db.write();
  res.status(201).json({ id, status: 'requested' });
});

app.get('/api/my/passes', authMiddleware('student'), (req, res) => {
  const rows = db.data.passes
    .filter(p => p.user_id === req.user.id)
    .sort((a,b)=> b.created_at.localeCompare(a.created_at))
  res.json(rows);
});

app.get('/api/passes', authMiddleware('admin'), (req, res) => {
  const { type, status, from, to } = req.query || {}
  let rows = db.data.passes
    .map(p => ({
      ...p,
      name: (db.data.users.find(u=>u.id===p.user_id)||{}).name,
      email: (db.data.users.find(u=>u.id===p.user_id)||{}).email
    }))
  if (type) rows = rows.filter(r => r.type === type)
  if (status) rows = rows.filter(r => r.status === status)
  if (from) rows = rows.filter(r => r.from_date >= from)
  if (to) rows = rows.filter(r => r.to_date <= to)
  rows.sort((a,b)=> b.created_at.localeCompare(a.created_at))
  res.json(rows);
});

app.post('/api/passes/:id/decision', authMiddleware('admin'), (req, res) => {
  const schema = z.object({ decision: z.enum(['approved','rejected']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { id } = req.params;
  const { decision } = parsed.data;
  const pass = db.data.passes.find(p => p.id === id)
  if (!pass || pass.status !== 'requested') return res.status(400).json({ error: 'Cannot decide this pass' });
  pass.status = decision;
  pass.decided_at = new Date().toISOString();
  db.write();
  res.json({ id, status: decision });
});

// Notices
app.get('/api/notices', (req, res) => {
  const nowIso = new Date().toISOString()
  const rows = db.data.notices
    .filter(n => !n.publish_at || n.publish_at <= nowIso)
    .map(n => ({ ...n, author_name: (db.data.users.find(u=>u.id===n.created_by)||{}).name }))
    .sort((a,b)=> {
      if ((b.pinned?1:0) !== (a.pinned?1:0)) return (b.pinned?1:0) - (a.pinned?1:0);
      return b.created_at.localeCompare(a.created_at)
    })
  res.json(rows);
});

app.post('/api/notices', authMiddleware('admin'), (req, res) => {
  const schema = z.object({ title: z.string().min(3), body: z.string().min(3), pinned: z.boolean().optional(), publishAt: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { title, body, pinned, publishAt } = parsed.data;
  const id = uuidv4();
  db.data.notices.push({ id, title, body, created_at: new Date().toISOString(), created_by: req.user.id, pinned: !!pinned, publish_at: publishAt ?? null })
  db.write();
  res.status(201).json({ id });
});

// Complaints: students submit complaints which are visible only to admins
app.post('/api/complaints', authMiddleware('student'), (req, res) => {
  // Allow empty or very short body; only title is required for ease of submission
  const schema = z.object({ title: z.string().min(3), body: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { title, body } = parsed.data;
  const id = uuidv4();
  const complaint = { id, user_id: req.user.id, title, body: body ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: 'pending', resolved: false, resolved_at: null }
  db.data.complaints.push(complaint)
  // notify admins
  try {
    const user = db.data.users.find(u=>u.id===req.user.id)
    const msg = `New complaint by ${user?.name||user?.email}: ${title}`
    db.data.notifications.push({ id: uuidv4(), type: 'complaint', message: msg, created_at: new Date().toISOString(), read: false })
    db.write()
  } catch {}
  db.write()
  res.status(201).json({ id, status: complaint.status })
})

app.get('/api/my/complaints', authMiddleware('student'), (req, res) => {
  const rows = (db.data.complaints||[]).filter(c => c.user_id === req.user.id).sort((a,b)=> b.created_at.localeCompare(a.created_at))
  res.json(rows)
})

// Admin: list, resolve, delete complaints
app.get('/api/admin/complaints', authMiddleware('admin'), (req, res) => {
  const rows = (db.data.complaints||[]).map(c => ({ ...c, user: (db.data.users||[]).find(u=>u.id===c.user_id) })).sort((a,b)=> b.created_at.localeCompare(a.created_at))
  res.json(rows)
})

app.post('/api/admin/complaints/:id/resolve', authMiddleware('admin'), (req, res) => {
  const note = (db.data.complaints||[]).find(c => c.id === req.params.id)
  if (!note) return res.status(404).json({ error: 'Not found' })
  note.resolved = true
  note.status = 'completed'
  note.resolved_at = new Date().toISOString()
  note.updated_at = new Date().toISOString()
  db.write()
  res.json({ ok: true })
})

// Admin: set complaint status explicitly
app.post('/api/admin/complaints/:id/status', authMiddleware('admin'), (req, res) => {
  const schema = z.object({ status: z.enum(['pending','rejected','completed']) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const note = (db.data.complaints||[]).find(c => c.id === req.params.id)
  if (!note) return res.status(404).json({ error: 'Not found' })
  note.status = parsed.data.status
  note.updated_at = new Date().toISOString()
  if (note.status === 'completed') { note.resolved = true; note.resolved_at = new Date().toISOString() }
  if (note.status !== 'completed') { note.resolved = false; note.resolved_at = null }
  db.write()
  res.json({ ok: true })
})

app.delete('/api/admin/complaints/:id', authMiddleware('admin'), (req, res) => {
  const exists = (db.data.complaints||[]).some(c => c.id === req.params.id)
  if (!exists) return res.status(404).json({ error: 'Not found' })
  db.data.complaints = (db.data.complaints||[]).filter(c => c.id !== req.params.id)
  db.write()
  res.json({ ok: true })
})

// Reports: bookings CSV
app.get('/api/reports/bookings.csv', authMiddleware('admin'), (req, res) => {
  const headers = ['booking_id','status','amount_cents','created_at','paid_at','room_block','room_floor','room_number','room_type','user_name','user_email','user_roll']
  const lines = [headers.join(',')]
  for (const b of db.data.bookings) {
    const room = db.data.rooms.find(r=>r.id===b.room_id)
    const user = db.data.users.find(u=>u.id===b.user_id)
    const row = [
      b.id,
      b.status,
      String(b.amount_cents ?? 0),
      b.created_at,
      b.paid_at ?? '',
      room?.block ?? '',
      room?.floor ?? '',
      room?.number ?? '',
      room?.type ?? '',
      user?.name ?? '',
      user?.email ?? '',
      user?.roll_number ?? ''
    ]
    lines.push(row.map(v => String(v).replace(/\r|\n|,/g,' ')).join(','))
  }
  const csv = lines.join('\n')
  res.setHeader('Content-Type','text/csv; charset=utf-8')
  res.setHeader('Content-Disposition','attachment; filename="bookings.csv"')
  res.send(csv)
})

// Admin metrics for dashboard
app.get('/api/admin/metrics', authMiddleware('admin'), (req, res) => {
  cleanupExpiredPendings();
  const rooms = db.data.rooms || []
  const bookings = db.data.bookings || []
  const passes = db.data.passes || []

  const totalRooms = rooms.length
  const totalBeds = rooms.reduce((a,r)=>a + (Number(r.capacity)||0), 0)
  const activePending = bookings.filter(b => b.status === 'pending').length
  const activePaid = bookings.filter(b => b.status === 'paid').length
  const availableBeds = Math.max(0, totalBeds - activePending - activePaid)

  const bookingsByStatus = bookings.reduce((acc,b)=>{ acc[b.status]=(acc[b.status]||0)+1; return acc }, { pending:0, paid:0, cancelled:0 })
  const passesByStatus = passes.reduce((acc,p)=>{ acc[p.status]=(acc[p.status]||0)+1; return acc }, { requested:0, approved:0, rejected:0 })

  // occupancy by floor
  const floorMap = new Map()
  for (const r of rooms) {
    const f = r.floor
    if (!floorMap.has(f)) floorMap.set(f, { floor: f, beds: 0, used: 0 })
    const ent = floorMap.get(f)
    ent.beds += Number(r.capacity)||0
  }
  for (const b of bookings) {
    if (b.status === 'pending' || b.status === 'paid') {
      const room = rooms.find(r=>r.id===b.room_id)
      if (room && floorMap.has(room.floor)) floorMap.get(room.floor).used += 1
    }
  }
  const occupancyByFloor = Array.from(floorMap.values()).sort((a,b)=>a.floor-b.floor)

  const recentPayments = bookings
    .filter(b=>b.status==='paid')
    .sort((a,b)=> (b.paid_at||'').localeCompare(a.paid_at||''))
    .slice(0,5)
    .map(b=>{
      const room = rooms.find(r=>r.id===b.room_id)
      const user = (db.data.users||[]).find(u=>u.id===b.user_id)
      return {
        id: b.id,
        amount_cents: b.amount_cents,
        paid_at: b.paid_at,
        room: room ? { floor: room.floor, number: room.number, type: room.type||null } : null,
        user: user ? { name: user.name, email: user.email } : null
      }
    })

  res.json({
    totals: { totalRooms, totalBeds, activePaid, activePending, availableBeds },
    bookingsByStatus,
    passesByStatus,
    occupancyByFloor,
    recentPayments
  })
})

// Admin: list users
app.get('/api/admin/users', authMiddleware('admin'), (req, res) => {
  const rows = (db.data.users||[]).map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at, last_login: u.last_login || null, roll_number: u.roll_number||null, department: u.department||null, year: u.year||null }))
  res.json(rows)
})

// Admin: notifications list and mark as read
app.get('/api/admin/notifications', authMiddleware('admin'), (req, res) => {
  const { unreadOnly } = req.query || {}
  let rows = (db.data.notifications||[])
    .slice()
    .sort((a,b)=> (b.created_at||'').localeCompare(a.created_at||''))
  if (String(unreadOnly) === 'true') rows = rows.filter(n => !n.read)
  res.json(rows)
})

app.post('/api/admin/notifications/:id/read', authMiddleware('admin'), (req, res) => {
  const note = (db.data.notifications||[]).find(n => n.id === req.params.id)
  if (!note) return res.status(404).json({ error: 'Not found' })
  note.read = true
  db.write()
  res.json({ ok: true })
})

app.post('/api/admin/notifications/read-all', authMiddleware('admin'), (req, res) => {
  for (const n of (db.data.notifications||[])) n.read = true
  db.write()
  res.json({ ok: true })
})

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`HAMS server running on http://localhost:${PORT}`));
