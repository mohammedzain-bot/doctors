# Dr. John Smith · Cardiologist Portfolio & Real-Time Patient Enquiry Portal

A premium, modern, mobile-first website for an internationally respected cardiologist, featuring an animated holographic heart background, medical luxury glassmorphism UI, direct WhatsApp appointment booking, and a complete **real-time enquiry and WhatsApp-style admin messaging system**.

---

## 🌟 Key Features

1. **Mobile-First UX & Luxury Medical Aesthetic**:
   - Built specifically for mobile viewports (320px–430px) with responsive scaling for tablet and desktop.
   - Midnight Navy (`#07131F`), Medical Cyan (`#72D6E8`), frosted glass cards (`backdrop-filter: blur(24px)`), and thin luminous borders.
   - Fixed mobile bottom bar with quick Call and Appointment actions.
   - Fullscreen animated holographic background with gentle Ken Burns motion and breathing luminosity.

2. **Real-Time Visitor Enquiry Chat**:
   - Minimalist floating chat button with pulsing availability ring positioned above the fixed bottom bar on mobile.
   - Polished messaging interface inspired by WhatsApp / Instagram DMs matching the dark medical luxury aesthetic.
   - Any message (e.g. "Hi", "I want to book an appointment", questions about clinic hours) automatically creates or appends to the visitor's enquiry.
   - Optional name and phone intake drawer.
   - Real-time bidirectional WebSocket message updates and typing indicator.
   - Row-level visitor token isolation ensuring patient privacy.
   - Medical confidentiality notice: *"Confidential Enquiry · Not for emergencies"*.

3. **Admin Messaging Panel (`/admin`)**:
   - WhatsApp Web / Instagram DM-inspired 3-pane layout:
     - **Left Sidebar**: Conversation inbox, real-time unread badges, status filters (`All`, `Unread`, `Open`, `Resolved`), and instant visitor/message search.
     - **Center Panel**: Active conversation stream with message bubbles, timestamps, read receipts (`✓✓`), typing indicator, quick clinical response templates, and auto-expanding message composer.
     - **Right Sidebar**: Patient contact info, direct `Call` and `WhatsApp` links, status manager, metadata timeline, and private internal notes.
   - Protected by 256-bit JWT authentication and bcrypt password hashing.
   - Responsive design adapting into a clean single-view on mobile with one-tap back navigation.

4. **Persistent Real-Time Backend & Database**:
   - Zero-dependency native SQLite database (`node:sqlite` in Node 24) with persistent storage across server restarts.
   - Native WebSockets (`/ws`) for instant real-time push without page refresh.
   - Fully turnkey Supabase migration script (`supabase_schema.sql`) with PostgreSQL tables, Row Level Security (RLS) policies, and Realtime publications.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will start at:
- **Public Patient Website**: [http://localhost:3000](http://localhost:3000)
- **Admin Messaging Inbox**: [http://localhost:3000/admin](http://localhost:3000/admin)

### 3. Default Admin Login Credentials
- **Email**: `admin@doctor.com`
- **Password**: `DoctorCare@2026`

*(You can customize these credentials in your environment variables, e.g., `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `JWT_SECRET`).*

---

## 🧪 Testing the Complete Flow

You can run the automated verification test suite covering all 22 functional requirements:
```bash
npm test
```

### Manual Testing Walkthrough:
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Tap the cyan chat icon in the bottom-right corner.
3. Type `"Hi"` or select `"Book Appointment"` and press Send.
4. Open [http://localhost:3000/admin](http://localhost:3000/admin) in a separate tab or device.
5. Log in with `admin@doctor.com` / `DoctorCare@2026`.
6. See the enquiry appear instantly in the inbox with a notification chime and unread counter!
7. Reply to the visitor — watch the reply immediately appear on the visitor's screen in real time!

---

## 🗄️ Database Architecture (`enquiries.db` & `supabase_schema.sql`)

### `conversations` Table
| Column | Type | Description |
|---|---|---|
| `id` | TEXT / UUID | Primary Key (`conv_...`) |
| `visitor_id` | TEXT | Unique visitor device identifier |
| `visitor_token` | TEXT | Secret session token for visitor data isolation |
| `visitor_name` | TEXT | Optional patient name |
| `visitor_phone` | TEXT | Optional patient mobile number |
| `status` | TEXT | `new`, `open`, or `resolved` |
| `admin_notes` | TEXT | Private clinical notes visible only to staff |
| `created_at` | DATETIME | Conversation creation timestamp |
| `last_message_at`| DATETIME | Timestamp of most recent activity |

### `messages` Table
| Column | Type | Description |
|---|---|---|
| `id` | TEXT / UUID | Primary Key (`msg_...`) |
| `conversation_id`| TEXT | Foreign key to `conversations.id` |
| `sender_type` | TEXT | `visitor`, `admin`, or `system` |
| `sender_name` | TEXT | Display name |
| `message_text` | TEXT | Message body |
| `delivery_status`| TEXT | `sent`, `delivered`, `read` |
| `created_at` | DATETIME | Message timestamp |
| `read_at` | DATETIME | Timestamp when recipient read the message |

---

## 🔒 Security & Privacy Implementation
- **Visitor Isolation**: Every visitor session generates a cryptographic token. API routes (`/api/chat/messages`) enforce token matching, ensuring visitors can never view other patients' enquiries.
- **Admin Route Protection**: All `/api/admin/*` routes require a valid JSON Web Token signed with `JWT_SECRET`.
- **Medical Disclaimer**: Clear notice displayed advising patients that the chat is for non-emergency enquiries.
