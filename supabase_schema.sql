-- ==============================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR DOCTOR ENQUIRY, AI CHAT & APPOINTMENT SYSTEM
-- ==============================================================================
-- Run this in the Supabase SQL Editor to configure all tables, RLS policies,
-- and Realtime publications.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Table A: visitors
CREATE TABLE IF NOT EXISTS public.visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    age INTEGER NOT NULL CHECK (age > 0 AND age <= 120),
    phone TEXT,
    visitor_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Table B: conversations
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'open', 'resolved')),
    admin_notes TEXT DEFAULT '',
    last_message_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Table C: messages
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'admin', 'AI')),
    sender_name TEXT DEFAULT '',
    message_text TEXT NOT NULL,
    delivery_status TEXT DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read')),
    created_at TIMESTAMPTZ DEFAULT now(),
    read_at TIMESTAMPTZ
);

-- 4. Table D: appointments
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    patient_name TEXT NOT NULL,
    patient_age INTEGER,
    phone TEXT NOT NULL,
    appointment_date DATE NOT NULL,
    preferred_time TEXT NOT NULL,
    reason_for_visit TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for maximum query performance
CREATE INDEX IF NOT EXISTS idx_visitors_token ON public.visitors(visitor_token);
CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON public.conversations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON public.conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_appointments_visitor ON public.appointments(visitor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date);

-- Enable Row Level Security (RLS)
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins full access to visitors" ON public.visitors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins full access to conversations" ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins full access to messages" ON public.messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins full access to appointments" ON public.appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Visitors isolated access via secret token in header
CREATE POLICY "Visitors read own profile" ON public.visitors FOR SELECT TO anon
    USING (visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token');

CREATE POLICY "Visitors read own conversations" ON public.conversations FOR SELECT TO anon
    USING (EXISTS (
        SELECT 1 FROM public.visitors v
        WHERE v.id = visitor_id AND v.visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token'
    ));

CREATE POLICY "Visitors read own messages" ON public.messages FOR SELECT TO anon
    USING (EXISTS (
        SELECT 1 FROM public.conversations c
        JOIN public.visitors v ON v.id = c.visitor_id
        WHERE c.id = conversation_id AND v.visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token'
    ));

CREATE POLICY "Visitors insert own messages" ON public.messages FOR INSERT TO anon
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.conversations c
        JOIN public.visitors v ON v.id = c.visitor_id
        WHERE c.id = conversation_id AND v.visitor_token = current_setting('request.headers', true)::json->>'x-visitor-token'
    ));

-- Enable Realtime publication for tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.visitors;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
