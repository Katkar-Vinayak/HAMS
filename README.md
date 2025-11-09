# HAMS (Hostel Automation & Management System)

Web app for hostel room booking, passes, and notices.

- Backend: Node.js + Express + lowdb (JSON file store)
- Frontend: React + Vite

## Quick start

1. Create server env file

Copy `server/.env.example` to `server/.env` and adjust if needed.

2. Install deps and run

In two terminals:

Server:
```
cd server
npm install
npm run dev
```

Client:
```
cd client
npm install
npm run dev
```

Open http://localhost:5173

Admin seed user: `admin@hams.local` / `admin123`

Data is stored in `server/data/hams.json`.

## Notes
- First-paid-first-served booking enforced by DB constraint.
- Replace payment simulation with real gateway later.
- Add floors/rooms data using Admin page.
